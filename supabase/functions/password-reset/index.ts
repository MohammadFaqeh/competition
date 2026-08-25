// "نسيت كلمة السر" — تدفق ذاتي كامل بالرمز، لحسابات الإدارة/المشرف (Supabase Auth حقيقية) فقط.
//
// action:"request" {email} — لو الإيميل يعود لحساب حقيقي، يولّد رمز 6 أرقام صالح 10 دقائق
//   ويبعته بريدياً للإداري الرئيسي (notify_email بـ backup_settings) — أبداً لصاحب الحساب نفسه.
//   يرجّع نجاح دائماً (حتى لو الإيميل غير موجود) عشان ما نكشف أي حساب موجود من عدمه.
//
// action:"reset" {email, code, newPassword} — لو الرمز صحيح وغير منتهٍ ولا محاولات كثيرة،
//   يحدّث كلمة السر مباشرة على نفس حساب Supabase Auth عبر auth.admin.updateUserById — نفس
//   الحساب بالضبط، فصاحبه يقدر يسجّل دخول فوراً بكلمة السر الجديدة.
//
// السرّ المطلوب: RESEND_API_KEY (نفسه المستخدم بدالة auto-backup). SUPABASE_URL و
// SUPABASE_SERVICE_ROLE_KEY متوفّرتان تلقائياً داخل كل Edge Function من Supabase نفسها.

import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY=Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL=Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FALLBACK_OWNER_EMAIL="mohammadalfaqeeh73@gmail.com";
const CODE_TTL_MS=10*60*1000;
const MAX_ATTEMPTS=5;

function json(body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
}

async function hashCode(code:string){
  const bytes=new TextEncoder().encode(code);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function findAuthUserByEmail(supabase:ReturnType<typeof createClient>,email:string){
  const {data,error}=await supabase.auth.admin.listUsers({page:1,perPage:1000});
  if(error)throw error;
  return data.users.find(user=>(user.email||"").toLowerCase()===email)||null;
}

Deno.serve(async (req)=>{
  if(!RESEND_API_KEY||!SUPABASE_URL||!SERVICE_ROLE_KEY)return json({ok:false,error:"الخدمة غير مُعدّة بعد"});
  let body:Record<string,unknown>;
  try{body=await req.json()}catch{return json({ok:false,error:"طلب غير صالح"})}

  const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY);
  const action=String(body.action||"");
  const email=String(body.email||"").trim().toLowerCase();
  if(!email)return json({ok:false,error:"أدخل الإيميل"});

  if(action==="request"){
    try{
      const {data:recent}=await supabase.from("password_reset_codes")
        .select("created_at").eq("email",email).order("created_at",{ascending:false}).limit(1).maybeSingle();
      const justSent=recent&&Date.now()-new Date(recent.created_at).getTime()<30*1000;
      const user=justSent?null:await findAuthUserByEmail(supabase,email);
      if(user){
        const code=String(Math.floor(100000+Math.random()*900000));
        const codeHash=await hashCode(code);
        await supabase.from("password_reset_codes").insert({
          email,code_hash:codeHash,expires_at:new Date(Date.now()+CODE_TTL_MS).toISOString(),
        });
        const {data:settings}=await supabase.from("backup_settings").select("notify_email").eq("id",1).single();
        const notifyEmail=settings?.notify_email||FALLBACK_OWNER_EMAIL;
        await fetch("https://api.resend.com/emails",{
          method:"POST",
          headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},
          body:JSON.stringify({
            from:"تنبيهات المسابقة <onboarding@resend.dev>",
            to:[notifyEmail],
            subject:`رمز استعادة كلمة سر — ${email}`,
            html:`<p>طلب استعادة كلمة سر للحساب: <b>${email}</b></p><p style="font-size:26px;font-weight:800;letter-spacing:4px">${code}</p><p>صالح لمدة 10 دقائق. أعطِ هذا الرمز لصاحب الحساب هاتفياً فقط بعد التأكد من هويته — لا ترسله كتابةً بأي وسيلة غير آمنة.</p>`,
          }),
        });
      }
    }catch(error){console.error("password-reset request failed",error)}
    return json({ok:true}); // نفس الرد دائماً — لا نكشف وجود الحساب من عدمه
  }

  if(action==="reset"){
    const code=String(body.code||"").trim();
    const newPassword=String(body.newPassword||"");
    if(!code||!newPassword)return json({ok:false,error:"أدخل الرمز وكلمة السر الجديدة"});
    if(newPassword.length<6)return json({ok:false,error:"كلمة السر يجب أن تكون 6 خانات على الأقل"});

    const {data:row,error:rowError}=await supabase.from("password_reset_codes")
      .select("*").eq("email",email).eq("used",false).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(rowError)return json({ok:false,error:"تعذر التحقق من الرمز"});
    if(!row)return json({ok:false,error:"لا يوجد طلب استعادة صالح لهذا الإيميل، اطلب رمزاً جديداً"});
    if(new Date(row.expires_at).getTime()<Date.now())return json({ok:false,error:"انتهت صلاحية الرمز، اطلب رمزاً جديداً"});
    if(row.attempts>=MAX_ATTEMPTS)return json({ok:false,error:"محاولات كثيرة خاطئة، اطلب رمزاً جديداً"});

    const codeHash=await hashCode(code);
    if(codeHash!==row.code_hash){
      await supabase.from("password_reset_codes").update({attempts:row.attempts+1}).eq("id",row.id);
      return json({ok:false,error:"الرمز غير صحيح"});
    }

    try{
      const user=await findAuthUserByEmail(supabase,email);
      if(!user)return json({ok:false,error:"لا يوجد حساب بهذا الإيميل"});
      const {error:updateError}=await supabase.auth.admin.updateUserById(user.id,{password:newPassword});
      if(updateError)return json({ok:false,error:"تعذر تحديث كلمة السر: "+updateError.message});
      await supabase.from("password_reset_codes").update({used:true}).eq("id",row.id);
      return json({ok:true});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      return json({ok:false,error:"تعذر تحديث كلمة السر: "+message});
    }
  }

  return json({ok:false,error:"إجراء غير معروف"});
});
