-- يرفع صلاحية المسؤول الفرعي لتقارب صلاحية الإدارة الرئيسية في تعديل بيانات المتسابق:
-- عند تعديل الأجزاء أو المستوى بعد وجود سحب سابق، كانت الإدارة/المشرف يلغيان السحب القديم
-- بأمان (عبر admin_save_state/supervisor_save_state ثم admin_delete_participant_session/
-- supervisor_delete_participant_session)، بينما المسؤول الفرعي يفشل بالكامل لأن admin_save_state
-- يرفض أي دور غير 'admin'. هذا الملف يضيف مسارًا مكافئًا للمسؤول الفرعي (بلا حاجة لصلاحية
-- admin_save_state، عبر تعديل مباشر لِـ payload.draws) + يضيف تنبيهًا للجنة المتأثرة في
-- الحالات الثلاث (إدارة/مشرف/مسؤول فرعي)، بنفس آلية committee_notifications المستخدمة أصلاً
-- للنقل (committee-transfer-notifications.sql). نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

-- دالة مساعدة: تنبيه لجنة بإلغاء سحب متسابقها بسبب تعديل بياناته (أجزاء/مستوى).
create or replace function public.record_participant_edit_notification(
  p_committee_id uuid, p_participant_id text, p_participant_name text
) returns void language plpgsql security definer set search_path=public,extensions as $$
begin
  if p_committee_id is null then return; end if;
  insert into public.committee_notifications(committee_id,participant_id,message) values(
    p_committee_id,p_participant_id,
    'تم تعديل بيانات المتسابق '||coalesce(p_participant_name,'')||' (الأجزاء أو المستوى) من الإدارة، وأُلغي السحب السابق له — بانتظار إعادة السحب.'
  );
end $$;
grant execute on function public.record_participant_edit_notification(uuid,text,text) to authenticated;

-- توسعة إضافية فقط (نفس الجسم الأصلي من security-fix-null-safe-admin-checks.sql بلا أي حذف)
-- + التقاط اللجنة المتأثرة قبل الحذف وإرسال التنبيه.
create or replace function public.admin_delete_participant_session(p_participant_id text)
returns void
language plpgsql security definer set search_path=public
as $$
declare v_committee_id uuid; v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  select committee_id into v_committee_id from public.exam_sessions where participant_id=p_participant_id;
  select item->>'name' into v_name from jsonb_array_elements(
    coalesce((select payload->'participants' from public.competition_state where id=1),'[]'::jsonb)) item
    where item->>'id'=p_participant_id limit 1;
  delete from public.exam_sessions where participant_id=p_participant_id;
  perform public.record_participant_edit_notification(v_committee_id,p_participant_id,v_name);
end $$;

-- نفس التوسعة لنسخة المشرف (الجسم الأصلي من supervisor-role.sql بلا أي حذف).
create or replace function public.supervisor_delete_participant_session(p_participant_id text)
returns void language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee_id uuid; v_name text;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select committee_id into v_committee_id from public.exam_sessions where participant_id=p_participant_id;
  select item->>'name' into v_name from jsonb_array_elements(
    coalesce((select payload->'participants' from public.competition_state where id=1),'[]'::jsonb)) item
    where item->>'id'=p_participant_id limit 1;
  delete from public.exam_sessions where participant_id=p_participant_id;
  perform public.record_participant_edit_notification(v_committee_id,p_participant_id,v_name);
end $$;

-- دالة جديدة للمسؤول الفرعي: تحذف جلسة الاختبار + سحب المتسابق من payload.draws مباشرة
-- (لأن المسؤول الفرعي لا يملك صلاحية admin_save_state)، ضمن جنس حسابه فقط، مع نفس تنبيه اللجنة.
create or replace function public.sub_admin_delete_participant_session(p_token text,p_participant_id text)
returns void language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participant jsonb; v_committee_id uuid; v_name text;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is not null and v_participant->>'gender'<>v_admin.gender then
    raise exception 'هذا المتسابق خارج صلاحية هذا الحساب';
  end if;
  v_name=v_participant->>'name';
  select committee_id into v_committee_id from public.exam_sessions where participant_id=p_participant_id;
  delete from public.exam_sessions where participant_id=p_participant_id;
  v_payload=jsonb_set(v_payload,'{draws}',(
    select coalesce(jsonb_agg(item),'[]') from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where item->>'participantId' is distinct from p_participant_id),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  perform public.record_participant_edit_notification(v_committee_id,p_participant_id,v_name);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'sub_admin_reset_draw','participant',p_participant_id,
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name));
end $$;
grant execute on function public.sub_admin_delete_participant_session(text,text) to anon,authenticated;
