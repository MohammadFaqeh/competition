-- ==========================================================================
-- إصلاحان أمنيان (2026-11-24) — ملف واحد يُشغَّل مرة واحدة في SQL Editor بعد account-sections.sql. آمن لإعادة التشغيل.
--
-- (١) admin_create_draw: على الخادم الحي كانت بالنسخة القديمة من committee-live-draw.sql بفحص
--     `current_user_role()<>'admin'`، وهو لا يرفض حين لا يكون للطالب دور (null). الإصلاح: نفس الدالة حرفياً بفحص
--     `is distinct from` (مطابق لـsecurity-fix-null-safe-admin-checks.sql) مع حصر التنفيذ بالحسابات المسجّلة.
--     لا تُعِد تشغيل committee-live-draw.sql مستقبلاً — فهو يُرجع النسخة غير الآمنة.
-- (٢) committee_create_draw كانت ترجّع للجنة صف اللجنة كاملاً (to_jsonb(v_committee)) ومنه رموز PIN المشفّرة للرئيس
--     والعضو. الواجهة لا تستعمل هذا الجزء أصلاً (تقرأ draw وsession فقط). الإصلاح يعدّل النسخة الموجودة فعلاً على
--     الخادم (أياً كانت) في السطر المرتجِع وحده، فيبقى منطقها كما هو تماماً، ويُرجع صف اللجنة بلا الحقول الحساسة.
-- بعد التشغيل: security_fixes_selftest() (للمدير) يجب أن ترجع {"admin_create_draw_safe": true, "committee_draw_sanitized": true}.
-- ==========================================================================

-- (١)
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

-- (٢) صف اللجنة كما يُرسل لحساب اللجنة: بلا رموز PIN المشفّرة ولا عدّادات القفل ولا حساب Auth القديم.
create or replace function public.committee_public_json(p_committee public.committees)
returns jsonb language sql immutable set search_path=public
as $$ select to_jsonb(p_committee)-'pin_hash'-'member_pin_hash'-'failed_login_count'-'locked_until'-'auth_user_id' $$;
revoke execute on function public.committee_public_json(public.committees) from public, anon, authenticated;

do $$
declare v_fn record; v_def text; v_new text; v_count int:=0;
begin
  for v_fn in select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='committee_create_draw' loop
    v_def := pg_get_functiondef(v_fn.oid);
    v_new := replace(v_def, '''committee'',to_jsonb(v_committee)', '''committee'',public.committee_public_json(v_committee)');
    if v_new <> v_def then execute v_new; v_count := v_count + 1; end if;
  end loop;
  raise notice 'committee_create_draw: % نسخة عُدِّلت', v_count;
end $$;

-- فحص ذاتي للمدير بعد التشغيل.
create or replace function public.security_fixes_selftest()
returns jsonb language plpgsql stable security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  return jsonb_build_object(
    'admin_create_draw_safe', not exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='admin_create_draw'
      and pg_get_functiondef(p.oid) ~ 'current_user_role\(\)\s*(<>|!=|not in)'),
    'committee_draw_sanitized', not exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='committee_create_draw'
      and pg_get_functiondef(p.oid) like '%to_jsonb(v_committee)%'));
end $$;
revoke execute on function public.security_fixes_selftest() from public, anon;
grant execute on function public.security_fixes_selftest() to authenticated;
