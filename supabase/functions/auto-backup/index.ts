// نسخ احتياطي تلقائي دوري — يشتغل من سيرفرات Supabase نفسها بجدولة Cron، لا علاقة له
// بمتصفح المستخدم إطلاقاً: يشتغل حتى لو كان الجهاز/المتصفح مغلقاً بالكامل.
//
// كل تشغيلة (كل بضع دقائق حسب جدولة الـ Cron):
//  1) يقرأ public.backup_settings — لو enabled=false يتوقف فوراً.
//  2) لو ما مرّ الوقت الكافي (interval_minutes) منذ آخر إرسال، يتوقف بدون إرسال.
//  3) يجمع نسخة كاملة من حالة المسابقة (config/participants/draws من competition_state،
//     زائد committees وsub_admins وexam_sessions) ويرسلها كمرفق JSON عبر Resend للإيميل
//     المسجَّل بـ notify_email.
//
// السرّان المطلوبان كـ Secrets على مستوى الدالة نفسها (Edge Function Secrets):
//   RESEND_API_KEY        — من https://resend.com (الخطة المجانية كافية).
// أما SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY فمتوفّرتان تلقائياً داخل كل Edge Function من
// Supabase نفسها، لا حاجة لإضافتهما يدوياً ولا لصقهما بأي مكان.

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

  const {data:settings,error:settingsError}=await supabase
    .from("backup_settings").select("*").eq("id",1).single();
  if(settingsError)return jsonResponse({ok:false,reason:"settings-read-failed",error:settingsError.message},500);
  if(!settings.enabled)return jsonResponse({ok:true,skipped:"disabled"});

  const intervalMs=Math.max(5,Number(settings.interval_minutes)||30)*60*1000;
  const lastSent=settings.last_sent_at?new Date(settings.last_sent_at).getTime():0;
  if(Date.now()-lastSent<intervalMs)return jsonResponse({ok:true,skipped:"not-due-yet"});

  try{
    const [state,committees,subAdmins,sessions]=await Promise.all([
      supabase.from("competition_state").select("payload,updated_at").eq("id",1).single(),
      supabase.from("committees").select("*"),
      supabase.from("sub_admins").select("*"),
      supabase.from("exam_sessions").select("*"),
    ]);
    if(state.error)throw new Error(`competition_state: ${state.error.message}`);
    if(committees.error)throw new Error(`committees: ${committees.error.message}`);
    if(subAdmins.error)throw new Error(`sub_admins: ${subAdmins.error.message}`);
    if(sessions.error)throw new Error(`exam_sessions: ${sessions.error.message}`);

    const backup={
      schema:1,
      exportedAt:new Date().toISOString(),
      competitionState:state.data?.payload||null,
      committees:committees.data||[],
      subAdmins:subAdmins.data||[],
      examSessions:sessions.data||[],
    };
    const stamp=new Date().toISOString().slice(0,16).replace(/[-:T]/g,"");
    const base64Content=btoa(unescape(encodeURIComponent(JSON.stringify(backup))));

    const emailResponse=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        from:"نسخ احتياطي المسابقة <onboarding@resend.dev>",
        to:[settings.notify_email||"mohammadalfaqeeh73@gmail.com"],
        subject:`نسخة احتياطية تلقائية — المسابقة القرآنية — ${new Date().toLocaleString("ar-JO")}`,
        text:`نسخة احتياطية تلقائية بحالة المسابقة الحالية.\nعدد المتسابقين: ${backup.competitionState?.participants?.length||0}\nعدد اللجان: ${backup.committees.length}\nعدد جلسات الاختبار: ${backup.examSessions.length}`,
        attachments:[{filename:`نسخة-احتياطية-${stamp}.json`,content:base64Content}],
      }),
    });
    if(!emailResponse.ok)throw new Error(`Resend: ${emailResponse.status} ${await emailResponse.text()}`);

    await supabase.from("backup_settings").update({
      last_sent_at:new Date().toISOString(),
      last_success_at:new Date().toISOString(),
      last_error:null,
    }).eq("id",1);
    return jsonResponse({ok:true,sent:true});
  }catch(error){
    // لا نحدّث last_sent_at هنا عمداً — عشان أي فشل مؤقت (شبكة/Resend) يُعاد تجربته بأقرب
    // تشغيلة Cron تالية بدل ما ننتظر دورة كاملة (interval_minutes) قبل إعادة المحاولة.
    const message=error instanceof Error?error.message:String(error);
    await supabase.from("backup_settings").update({last_error:message}).eq("id",1);
    return jsonResponse({ok:false,reason:"send-failed",error:message},500);
  }
});
