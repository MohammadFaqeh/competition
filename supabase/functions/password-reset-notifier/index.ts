// إشعار "نسيت كلمة السر" — تشتغل بجدولة Cron (كل بضع دقائق)، تقرأ أي طلبات جديدة من
// public.password_reset_requests وتبعت إيميل واحد للإداري الرئيسي فيه كل الطلبات الجديدة
// دفعة واحدة، ثم تعلّمها notified=true. لا تصفّر أي كلمة سر — فقط تُعلم الإداري ليتصرف يدوياً
// من لوحة Supabase (Authentication → Users).
//
// تستخدم نفس سرّ RESEND_API_KEY المستخدم بدالة auto-backup — لا حاجة لإضافة سرّ جديد.

import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY=Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL=Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function jsonResponse(body:Record<string,unknown>,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

Deno.serve(async ()=>{
  if(!RESEND_API_KEY||!SUPABASE_URL||!SERVICE_ROLE_KEY)
    return jsonResponse({ok:false,reason:"missing-secrets"},500);

  const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY);

  const {data:pending,error:pendingError}=await supabase
    .from("password_reset_requests").select("*").eq("notified",false).order("requested_at");
  if(pendingError)return jsonResponse({ok:false,reason:"read-failed",error:pendingError.message},500);
  if(!pending?.length)return jsonResponse({ok:true,skipped:"no-pending-requests"});

  const {data:settings}=await supabase.from("backup_settings").select("notify_email").eq("id",1).single();
  const notifyEmail=settings?.notify_email||"mohammadalfaqeeh73@gmail.com";

  const rowsHtml=pending.map(row=>`<li>${row.identifier} — ${new Date(row.requested_at).toLocaleString("ar-JO")}</li>`).join("");
  try{
    const emailResponse=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        from:"تنبيهات المسابقة <onboarding@resend.dev>",
        to:[notifyEmail],
        subject:`طلب${pending.length>1?"ات":""} نسيان كلمة سر (${pending.length}) — المسابقة القرآنية`,
        html:`<p>الحسابات التالية طلبت استعادة كلمة السر:</p><ul>${rowsHtml}</ul><p>صفّرها يدوياً من لوحة Supabase (Authentication → Users) ثم أرسل الكلمة الجديدة للشخص مباشرة.</p>`,
      }),
    });
    if(!emailResponse.ok)throw new Error(`Resend: ${emailResponse.status} ${await emailResponse.text()}`);

    const ids=pending.map(row=>row.id);
    await supabase.from("password_reset_requests")
      .update({notified:true,notified_at:new Date().toISOString()}).in("id",ids);
    return jsonResponse({ok:true,notified:ids.length});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return jsonResponse({ok:false,reason:"send-failed",error:message},500);
  }
});
