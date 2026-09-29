-- إصلاح أمني: public.diwan_admin_create_draw(jsonb) كانت تتحقق من الصلاحية بالشكل
--   if public.current_user_role()<>'admin' then raise exception ...
-- لكن current_user_role() ترجع NULL لأي متصل مصادَق (authenticated) لا يملك صفاً بجدول profiles،
-- وفي PL/pgSQL: IF NULL THEN ... يُعامَل كأنه FALSE فلا يُرفع الاستثناء، فتُنفَّذ العملية فعلياً
-- دون التحقق الفعلي من current_user_role() = 'admin'. الدالة SECURITY DEFINER وممنوحة لـ
-- authenticated، وهذا الفحص هو الحاجز الوحيد لصلاحيتها (نفس الثغرة التي أصلحها
-- security-fix-null-safe-admin-checks.sql لدوال المسابقة السنوية، لكن هذه الدالة أُضيفت لاحقاً
-- بملف diwan-al-hifadh-core.sql ولم يشملها ذلك الإصلاح).
-- هذا الملف يعيد تعريف هذه الدالة بنفس المنطق والجسم تماماً كما بـdiwan-al-hifadh-core.sql،
-- مع استبدال فحص الصلاحية فقط بصيغة آمنة لـNULL (is distinct from)، مطابقةً للدالتين المجاورتين
-- لها بنفس الملف (diwan_admin_delete_participant_draw، diwan_admin_transfer_participant).
-- شغّل هذا الملف بعد diwan-al-hifadh-core.sql.

create or replace function public.diwan_admin_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payload jsonb; v_sequence integer;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select payload into v_payload from public.diwan_state where id=1 for update;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]')||jsonb_build_array(p_draw),true);
  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return p_draw;
end $$;
grant execute on function public.diwan_admin_create_draw(jsonb) to authenticated;
