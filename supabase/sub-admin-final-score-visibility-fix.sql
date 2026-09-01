-- خلل: مسؤولة الفرعي كانت تشوف زر "طلب DR" لمتسابقة خلّصت اختبارها فعليًا واعتُمدت نتيجتها
-- إلكترونيًا من اللجنة، بدل ما تظهر علامتها الحقيقية. السبب: علامة الاختبار الإلكتروني
-- المعتمد تُخزَّن ابتداءً بجدول exam_sessions فقط، وnقلها لحقل participants[].score المشترك
-- (الذي تقرأ منه مسؤولة الفرعي مباشرة عبر sub_admin_load_state) كان يحصل حصريًا من جهة
-- المتصفح — دالة mergeFinalSessionsIntoState بـ app.js، تُستدعى فقط عند دخول/تحديث حساب
-- الإدارة الرئيسية أو المشرف (enterCloudContext وrefreshAdminChanges). مسؤولة الفرعي لا
-- تستدعيها إطلاقًا. فلو لم يكن أي حساب إدارة/إشراف مسجّلاً دخوله بتلك اللحظة بالذات ليُجري
-- هذا الدمج ويحفظه، تبقى نتيجة المتسابقة "غير محفوظة" بنظر مسؤولة الفرعي رغم اعتمادها
-- فعليًا من اللجنة، فيظهر لها زر طلب DR بالغلط.
--
-- الحل الصحيح: نقل الدمج ليصير من جهة السيرفر مباشرة داخل sub_admin_load_state نفسها، بحيث
-- لا تعتمد دقة ما تراه مسؤولة الفرعي على وجود جلسة إدارة نشطة إطلاقًا.
--
-- المصدر الوحيد الحالي لـ sub_admin_load_state: committee-load-state-performance-fix.sql
-- (يحتوي إصلاح أداء سابق اليوم). الجسم أدناه نفسه + دمج exam_sessions('final') فقط، مضاف
-- كخطوة واحدة إضافية قبل إرجاع participants — بلا حذف أي حقل أو منطق موجود.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.sub_admin_load_state(p_token text)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participants jsonb; v_draws jsonb; v_committees jsonb; v_participant_ids text[];
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(item),'[]') into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item where item->>'gender'=v_admin.gender;

  -- دمج نتائج الجلسات المعتمدة نهائيًا مباشرة، بدل الانتظار حتى يُجري حساب إدارة الدمج
  -- ويحفظه بالخلفية المشتركة.
  select coalesce(jsonb_agg(
    case when s.id is not null then
      item||jsonb_build_object('score',s.score,'gradedAt',s.finalized_at,'scoreSource','electronic')
    else item end
  ),'[]') into v_participants
  from jsonb_array_elements(v_participants) item
  left join public.exam_sessions s on s.participant_id=item->>'id' and s.status='final';

  select coalesce(array_agg(p->>'id'),'{}') into v_participant_ids from jsonb_array_elements(v_participants) p;
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where (item->>'participantId')=any(v_participant_ids);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'levelNames',level_names,
      'extraParticipantIds',extra_participant_ids,'active',active,
      'chairman_name',chairman_name,'member_name',member_name,'responsible_gender',responsible_gender,
      'level_names',level_names,'levels',levels)),'[]') into v_committees
  from public.committees where responsible_gender is null or responsible_gender=v_admin.gender;
  return jsonb_build_object('config',v_payload->'config','participants',v_participants,'draws',v_draws,'committees',v_committees);
end $$;
grant execute on function public.sub_admin_load_state(text) to anon,authenticated;
