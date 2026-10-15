// "نسيت كلمة السر / نسيت الرمز" — تدفق ذاتي كامل بالرمز، لكل أنواع الحسابات:
//   - إدارة/مشرف (إيميل + كلمة سر، حساب Supabase Auth حقيقي) → auth.admin.updateUserById
//   - رئيس/عضو لجنة أو مسؤول فرعي (رمز دخول + PIN، بلا حساب Auth) → public.reset_login_code_pin
// التمييز تلقائي: identifier فيه "@" → إيميل (إدارة/مشرف)، غير هيك → رمز دخول (لجنة/مسؤول فرعي).
//
// action:"request" {identifier} — لو الـidentifier يعود لحساب حقيقي، يولّد رمز 6 أرقام صالح
//   10 دقائق ويبعته بريدياً لإيميل الإدارة فقط (notify_email بـ backup_settings) — أبداً لصاحب
//   الحساب نفسه — مع بيانات من طلب: نوع الحساب، اسمه، ما كُتب بخانة الدخول، ووقت الطلب.
//   يرجّع نجاح دائماً (حتى لو الحساب غير موجود) عشان ما نكشف أي حساب موجود.
//
// action:"reset" {identifier, code, newValue} — لو الرمز صحيح وغير منتهٍ ولا محاولات كثيرة،
//   يحدّث كلمة السر/الـPIN مباشرة على نفس الحساب — نفس الحساب بالضبط، دخول فوري بعدها.
//
// الأسرار (Edge Function Secrets): RESEND_API_KEY (نفسه المستخدم بدالة auto-backup).
// اختياري: ALLOWED_ORIGINS — مواقع مسموح لها استدعاء الدالة من المتصفح، مفصولة بفواصل
//   (الافتراضي موقع المنصة على GitHub Pages فقط — لا "*").
// SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY متوفّرتان تلقائياً داخل كل Edge Function من Supabase نفسها.
// لا يوجد أي إيميل مكتوب بالكود: الوجهة الوحيدة notify_email المخزّن بقاعدة البيانات (جدول محمي).

import {createClient} from "https://esm.sh/@supabase/supabase-js@2.49.4";

const RESEND_API_KEY=Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL=Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ALLOWED_ORIGINS=(Deno.env.get("ALLOWED_ORIGINS")||"https://mohammadfaqeh.github.io").split(",").map(origin=>origin.trim()).filter(Boolean);
const CODE_TTL_MS=10*60*1000;
const MAX_ATTEMPTS=5;
// نفس صيغة رموز الدخول المسموحة عند إنشائها (supervisor_save_sub_admin) — أي شيء آخر يُرفض قبل أي بحث.
const LOGIN_CODE_PATTERN=/^[A-Za-z0-9_-]{2,20}$/;
const EMAIL_PATTERN=/^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/;

// CORS: يُسمح فقط لموقع المنصة (لا "*")، وطلب الاستئذان (OPTIONS) يُجاب قبل أي معالجة.
function corsHeaders(req:Request):Record<string,string>{
  const origin=req.headers.get("origin")||"";
  if(!ALLOWED_ORIGINS.includes(origin))return {};
  return {
    "Access-Control-Allow-Origin":origin,
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Vary":"Origin",
  };
}
function json(req:Request,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json",...corsHeaders(req)}});
}

async function hashCode(code:string){
  const bytes=new TextEncoder().encode(code);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
// رمز 6 أرقام بمولّد عشوائي آمن (لا Math.random) وبلا انحياز modulo.
function secureSixDigitCode(){
  const range=900000,limit=Math.floor(0x100000000/range)*range,buffer=new Uint32Array(1);
  let value=0;
  do{crypto.getRandomValues(buffer);value=buffer[0]}while(value>=limit);
  return String(100000+(value%range));
}
function escapeHtml(value:unknown){
  return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char] as string));
}
// يمنع % و_ من العمل كأحرف بحث شاملة داخل ilike (كانت تسمح بمطابقة أي رمز).
function escapeLike(value:string){return value.replace(/[\\%_]/g,char=>`\\${char}`)}

async function findAuthUserByEmail(supabase:ReturnType<typeof createClient>,email:string){
  const {data,error}=await supabase.auth.admin.listUsers({page:1,perPage:1000});
  if(error)throw error;
  return data.users.find(user=>(user.email||"").toLowerCase()===email)||null;
}
// من يملك هذا الإيميل/الرمز — لعرضه بإيميل الإدارة (نوع الحساب واسمه). null = لا يوجد حساب.
async function describeAccount(supabase:ReturnType<typeof createClient>,identifier:string,isEmail:boolean){
  if(isEmail){
    const user=await findAuthUserByEmail(supabase,identifier);
    if(!user)return null;
    const {data:profile}=await supabase.from("profiles").select("role,display_name").eq("id",user.id).maybeSingle();
    const role=profile?.role==="admin"?"المدير الرئيسي":profile?.role==="supervisor"?"مشرف المسابقة":"حساب إدارة";
    return {type:role,name:profile?.display_name||"—"};
  }
  const pattern=escapeLike(identifier);
  const [chairman,member,subAdmin]=await Promise.all([
    supabase.from("committees").select("name,chairman_name").ilike("login_code",pattern).maybeSingle(),
    supabase.from("committees").select("name,member_name").ilike("member_login_code",pattern).maybeSingle(),
    supabase.from("sub_admins").select("name").ilike("login_code",pattern).maybeSingle(),
  ]);
  if(chairman.data)return {type:`رئيس ${chairman.data.name}`,name:chairman.data.chairman_name||"—"};
  if(member.data)return {type:`عضو ${member.data.name}`,name:member.data.member_name||"—"};
  if(subAdmin.data)return {type:"مسؤول فرعي",name:subAdmin.data.name||"—"};
  return null;
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(req)});
  if(!RESEND_API_KEY||!SUPABASE_URL||!SERVICE_ROLE_KEY)return json(req,{ok:false,error:"الخدمة غير مُعدّة بعد"});
  let body:Record<string,unknown>;
  try{body=await req.json()}catch{return json(req,{ok:false,error:"طلب غير صالح"})}

  const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY);
  const action=String(body.action||"");
  const identifierRaw=String(body.identifier||"").trim();
  const isEmail=identifierRaw.includes("@");
  const identifier=isEmail?identifierRaw.toLowerCase():identifierRaw.toUpperCase();
  if(!identifier)return json(req,{ok:false,error:"أدخل البيانات المطلوبة"});
  if(isEmail?!EMAIL_PATTERN.test(identifier):!LOGIN_CODE_PATTERN.test(identifier))return json(req,{ok:false,error:"صيغة البيانات غير صحيحة"});

  if(action==="request"){
    try{
      const {data:recent}=await supabase.from("password_reset_codes")
        .select("created_at").eq("email",identifier).order("created_at",{ascending:false}).limit(1).maybeSingle();
      const justSent=recent&&Date.now()-new Date(recent.created_at).getTime()<30*1000;
      const account=justSent?null:await describeAccount(supabase,identifier,isEmail);
      if(account){
        const {data:settings}=await supabase.from("backup_settings").select("notify_email").eq("id",1).maybeSingle();
        const notifyEmail=String(settings?.notify_email||"").trim();
        if(!notifyEmail){console.error("password-reset: notify_email is not set in backup_settings — no email sent");return json(req,{ok:true})}
        const code=secureSixDigitCode();
        await supabase.from("password_reset_codes").insert({
          email:identifier,code_hash:await hashCode(code),expires_at:new Date(Date.now()+CODE_TTL_MS).toISOString(),
        });
        const requestedAt=new Date().toLocaleString("ar-JO",{timeZone:"Asia/Amman",dateStyle:"full",timeStyle:"short"});
        const response=await fetch("https://api.resend.com/emails",{
          method:"POST",
          headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},
          body:JSON.stringify({
            from:"تنبيهات المسابقة <onboarding@resend.dev>",
            to:[notifyEmail],
            subject:`طلب استعادة دخول — ${account.type}: ${account.name}`,
            html:`<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9">
<p><b>طلب استعادة دخول جديد</b></p>
<p>نوع الحساب: <b>${escapeHtml(account.type)}</b><br>الاسم: <b>${escapeHtml(account.name)}</b><br>ما كُتب بخانة الدخول: <b dir="ltr">${escapeHtml(identifier)}</b><br>وقت الطلب: ${escapeHtml(requestedAt)}</p>
<p style="font-size:26px;font-weight:800;letter-spacing:4px">${code}</p>
<p>صالح لمدة 10 دقائق. أعطِ هذا الرمز لصاحب الحساب هاتفياً فقط بعد التأكد من هويته — لا ترسله كتابةً بأي وسيلة غير آمنة. إذا لم يطلبه صاحب الحساب فتجاهله.</p></div>`,
          }),
        });
        if(!response.ok)console.error("password-reset: email send failed",response.status);
      }
    }catch(error){console.error("password-reset request failed",error instanceof Error?error.message:String(error))}
    return json(req,{ok:true}); // نفس الرد دائماً — لا نكشف وجود الحساب من عدمه
  }

  if(action==="reset"){
    const code=String(body.code||"").trim();
    const newValue=String(body.newValue||"");
    if(!/^\d{6}$/.test(code)||!newValue)return json(req,{ok:false,error:"أدخل الرمز (6 أرقام) والقيمة الجديدة"});
    if(newValue.length<(isEmail?6:4)||newValue.length>72)return json(req,{ok:false,error:isEmail?"كلمة السر يجب أن تكون بين 6 و72 خانة":"PIN يجب أن يكون بين 4 و72 خانة"});

    const {data:row,error:rowError}=await supabase.from("password_reset_codes")
      .select("*").eq("email",identifier).eq("used",false).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(rowError)return json(req,{ok:false,error:"تعذر التحقق من الرمز"});
    if(!row)return json(req,{ok:false,error:"لا يوجد طلب استعادة صالح، اطلب رمزاً جديداً"});
    if(new Date(row.expires_at).getTime()<Date.now())return json(req,{ok:false,error:"انتهت صلاحية الرمز، اطلب رمزاً جديداً"});
    if(row.attempts>=MAX_ATTEMPTS)return json(req,{ok:false,error:"محاولات كثيرة خاطئة، اطلب رمزاً جديداً"});

    if(await hashCode(code)!==row.code_hash){
      await supabase.from("password_reset_codes").update({attempts:row.attempts+1}).eq("id",row.id);
      return json(req,{ok:false,error:"الرمز غير صحيح"});
    }

    // تفاصيل الأخطاء الداخلية تُسجَّل بسجل الدالة فقط — المستخدم يرى رسالة عامة.
    try{
      if(isEmail){
        const user=await findAuthUserByEmail(supabase,identifier);
        if(!user)return json(req,{ok:false,error:"لا يوجد حساب بهذا الإيميل"});
        const {error:updateError}=await supabase.auth.admin.updateUserById(user.id,{password:newValue});
        if(updateError){console.error("password-reset: updateUserById failed",updateError.message);return json(req,{ok:false,error:"تعذر تحديث كلمة السر، حاول مجدداً"})}
      }else{
        const {data:updated,error:rpcErrorObj}=await supabase.rpc("reset_login_code_pin",{p_login_code:identifier,p_new_pin:newValue});
        if(rpcErrorObj){console.error("password-reset: reset_login_code_pin failed",rpcErrorObj.message);return json(req,{ok:false,error:"تعذر تحديث الرمز السري، حاول مجدداً"})}
        if(!updated)return json(req,{ok:false,error:"لا يوجد حساب بهذا الرمز"});
      }
      await supabase.from("password_reset_codes").update({used:true}).eq("id",row.id);
      return json(req,{ok:true});
    }catch(error){
      console.error("password-reset: reset failed",error instanceof Error?error.message:String(error));
      return json(req,{ok:false,error:"تعذر التحديث، حاول مجدداً"});
    }
  }

  return json(req,{ok:false,error:"إجراء غير معروف"});
});
