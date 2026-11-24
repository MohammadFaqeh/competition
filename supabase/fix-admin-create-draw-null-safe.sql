-- ==========================================================================
-- إصلاح أمني (2026-11-24): admin_create_draw على الخادم الحي كانت بالنسخة القديمة من committee-live-draw.sql
-- (`current_user_role()<>'admin'`) — هذا الفحص لا يرفض حين لا يكون للطالب دور (null)، فقد يمر طالب بلا حساب إدارة.
-- اكتُشف بفحص account_sections_role_check_audit() بعد تشغيل account-sections.sql (يبدو أن committee-live-draw.sql
-- أُعيد تشغيله بعد security-fix-null-safe-admin-checks.sql فأرجع النسخة القديمة).
-- الإصلاح: نفس الدالة حرفياً كما هي بالخادم الآن، والفرق الوحيد فحص آمن مع null (is distinct from) — مطابق لنسخة
-- security-fix-null-safe-admin-checks.sql — مع حصر التنفيذ بالحسابات المسجّلة (لا العموم ولا anon).
-- ملاحظة: لا تُعِد تشغيل committee-live-draw.sql مستقبلاً — فهو يُرجع النسخة غير الآمنة.
-- ==========================================================================
create or replace function public.admin_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payload jsonb; v_existing jsonb; v_owner text; v_sequence integer;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  if nullif(p_draw->>'participantId','') is not null then
    select item into v_existing from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
      where item->>'participantId'=p_draw->>'participantId' limit 1;
    if v_existing is not null then
      select c.name into v_owner from public.exam_sessions s join public.committees c on c.id=s.committee_id
        where s.participant_id=p_draw->>'participantId';
      raise exception 'تم السحب لهذا المتسابق مسبقاً بواسطة %',coalesce(v_owner,'الإدارة');
    end if;
  end if;
  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]')||jsonb_build_array(p_draw),true);
  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'admin_draw','participant',coalesce(p_draw->>'participantId',p_draw->>'id'),jsonb_build_object('draw_id',p_draw->>'id'));
  return p_draw;
end $$;
revoke execute on function public.admin_create_draw(jsonb) from public, anon;
grant execute on function public.admin_create_draw(jsonb) to authenticated;
