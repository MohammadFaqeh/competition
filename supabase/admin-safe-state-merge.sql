-- إصلاح تعارض حفظ متزامن: الإدارة كانت تحفظ حالة المسابقة كاملة بالكتابة فوق الصف مباشرة
-- (upsert بلا قفل ولا دمج)، فلو حفظت الإدارة بينما نسختها المحلية لم تلتقط بعد إضافة حديثة
-- من مسؤولة الإناث (متسابقة جديدة أو سحب جديد أضافته قبل لحظات)، كانت الكتابة تمحو تلك
-- الإضافة بصمت دون أي خطأ يظهر لأي طرف. نفس مبدأ الحماية المطبَّق أصلاً على حفظ المسؤول
-- الفرعي (sub_admin_save_participants) — قفل + دمج بدل استبدال أعمى — يُطبَّق هنا لجانب
-- الإدارة أيضاً، على المتسابقين والسحوبات معاً (الإعدادات تبقى استبدالاً مباشراً لأن
-- الإدارة هي الكاتب الوحيد لها).
create or replace function public.admin_save_state(
  p_config jsonb,
  p_participants jsonb,
  p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',
  p_deleted_draw_ids text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_others_participants jsonb; v_others_draws jsonb; v_final_participants jsonb; v_final_draws jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  -- أي متسابق موجود بالخادم ولم يصل ضمن دفعة الإدارة ولا ضمن المحذوفين يبقى كما هو
  -- (أضافه طرف آخر — مثل مسؤولة الإناث — بعد آخر مزامنة محلية للإدارة).
  select coalesce(jsonb_agg(item),'[]') into v_others_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where not (item->>'id'=any(p_deleted_participant_ids))
    and not exists(select 1 from jsonb_array_elements(p_participants) n where n->>'id'=item->>'id');
  v_final_participants=v_others_participants||p_participants;

  select coalesce(jsonb_agg(item),'[]') into v_others_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where not (item->>'id'=any(p_deleted_draw_ids))
    and not exists(select 1 from jsonb_array_elements(p_draws) n where n->>'id'=item->>'id');
  v_final_draws=v_others_draws||p_draws;

  v_payload=jsonb_set(v_payload,'{config}',p_config,true);
  v_payload=jsonb_set(v_payload,'{participants}',v_final_participants,true);
  v_payload=jsonb_set(v_payload,'{draws}',v_final_draws,true);

  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return v_payload;
end $$;

grant execute on function public.admin_save_state(jsonb,jsonb,jsonb,text[],text[]) to authenticated;
