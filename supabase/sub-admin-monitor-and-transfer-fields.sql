-- (أ) يضيف حقول اللجان الناقصة (اسم الرئيس/العضو، الجنس المسؤولة عنه، أسماء وأرقام المستويات
-- snake_case) لما يراه المسؤول الفرعي عبر sub_admin_load_state، حتى تعمل نافذة "نقل" له
-- تمامًا كالإدارة (openAssignCommitteeModal في app.js تقرأ هذه الحقول بالضبط)، وتُستخدم
-- أيضًا لتغذية شاشة "مراقبة حية" له. الحقول الحالية (levelNames الكاميل، extraParticipantIds،
-- active) تبقى كما هي بلا أي حذف — إضافة فقط.
-- (ب) يضيف دالة sub_admin_list_sessions لتمكين المراقبة الحية للمسؤول الفرعي (نفس نمط
-- committee_list_sessions في committee-pin-migration.sql)، مُقيَّدة بجنس حسابه عبر ربط
-- اللجنة المسؤولة عن كل جلسة.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

-- نسخة كاملة (النسخة الأحدث كانت في sub-admin-committee-assignment-visibility.sql) مع
-- إضافة الحقول الجديدة فقط داخل جسم بناء اللجان.
create or replace function public.sub_admin_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participants jsonb; v_draws jsonb; v_committees jsonb;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(item),'[]') into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item where item->>'gender'=v_admin.gender;
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where exists(select 1 from jsonb_array_elements(v_participants) p where p->>'id'=item->>'participantId');
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'levelNames',level_names,
      'extraParticipantIds',extra_participant_ids,'active',active,
      'chairman_name',chairman_name,'member_name',member_name,'responsible_gender',responsible_gender,
      'level_names',level_names,'levels',levels)),'[]') into v_committees
  from public.committees where responsible_gender is null or responsible_gender=v_admin.gender;
  return jsonb_build_object('config',v_payload->'config','participants',v_participants,'draws',v_draws,'committees',v_committees);
end $$;

-- جلسات الاختبار الجارية/المكتملة للجان ضمن جنس حساب المسؤول الفرعي فقط.
create or replace function public.sub_admin_list_sessions(p_token text)
returns setof public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  return query select es.* from public.exam_sessions es
    join public.committees c on c.id=es.committee_id
    where c.responsible_gender is null or c.responsible_gender=v_admin.gender
    order by es.updated_at desc;
end $$;
grant execute on function public.sub_admin_list_sessions(text) to anon,authenticated;
