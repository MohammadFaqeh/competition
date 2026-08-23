-- حذف كامل ونهائي للجنة تجريبية: يتيح للإدارة حذف لجنة حتى لو لديها اختبارات مسجلة
-- (بيانات تجريبية قبل بدء الاستخدام الفعلي)، مع خيار صريح لتنظيف سجل النشاط المرتبط بها
-- أيضًا. الدالة القديمة كانت تمنع الحذف كليًا في هذه الحالة (حماية للنتائج الحقيقية)،
-- والسلوك الافتراضي هنا يبقى نفس الحماية — الحذف الكامل مطلوب بشكل صريح عبر p_purge_history.
--
-- ملاحظة توقيع الدالة: نغيّر عدد معاملات admin_delete_committee (uuid) -> (uuid, boolean)،
-- و create or replace لا يستبدل دالة بتوقيع مختلف، بل يضيف نسخة موازية قد تسبب غموضًا
-- بالاستدعاء (ambiguous function call) من PostgREST. لذلك نحذف النسخة القديمة صراحة أولاً.
drop function if exists public.admin_delete_committee(uuid);

create or replace function public.admin_delete_committee(p_committee_id uuid,p_purge_history boolean default false)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select name into v_name from public.committees where id=p_committee_id for update;
  if v_name is null then raise exception 'اللجنة غير موجودة أو حُذفت مسبقاً'; end if;
  if exists(select 1 from public.exam_sessions where committee_id=p_committee_id) then
    if not p_purge_history then
      raise exception 'لا يمكن حذف لجنة لديها اختبارات مسجلة؛ استخدم تعطيل اللجنة لحماية النتائج وسجل النشاط، أو فعّل خيار الحذف الكامل إن كانت بيانات تجريبية';
    end if;
    delete from public.exam_sessions where committee_id=p_committee_id;
  end if;
  if p_purge_history then
    delete from public.audit_log
    where (entity_type='committee' and entity_id=p_committee_id::text)
       or (details->>'committee_id'=p_committee_id::text);
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'delete_committee','committee',p_committee_id::text,
      jsonb_build_object('committee_name',v_name,'purged_history',p_purge_history));
  delete from public.committees where id=p_committee_id;
  return true;
end $$;
grant execute on function public.admin_delete_committee(uuid,boolean) to authenticated;
