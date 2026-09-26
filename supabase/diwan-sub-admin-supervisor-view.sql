-- ديوان الحفاظ: عرض المتسابقين للمسؤول الفرعي (مسؤولة الإناث/مسؤول الذكور) ولمشرف المسابقة.
-- كانت diwan_state/diwan_exam_sessions مقروءة للإدارة الرئيسية فقط، فتظهر صفحة ديوان الحفاظ فارغة
-- لبقية حسابات الإدارة. العرض هنا للقراءة فقط — كل عمليات الكتابة تبقى للإدارة الرئيسية كما هي.
-- المسؤول الفرعي يرى جنس حسابه فقط؛ والمتسابق بلا جنس محدد يُحسب على الإناث (نفس قاعدة
-- توزيع لجان الإناث بالواجهة: gender!=='ذكر'). نفّذ هذا الملف بعد diwan-al-hifadh-core.sql.

-- مشرف المسابقة: حساب Supabase Auth عادي (profiles.role='supervisor') → توسعة سياسة القراءة فقط.
drop policy if exists diwan_state_read on public.diwan_state;
create policy diwan_state_read on public.diwan_state for select to authenticated
using (public.current_user_role() in ('admin','supervisor'));

drop policy if exists diwan_sessions_read on public.diwan_exam_sessions;
create policy diwan_sessions_read on public.diwan_exam_sessions for select to authenticated
using (public.current_user_role() in ('admin','supervisor'));

-- المسؤول الفرعي: جلسة برمز (sub_admin_from_token) لا حساب Auth، فيحتاج دوالاً خاصة به.
create or replace function public.diwan_sub_admin_participant_visible(p_participant jsonb,p_gender text)
returns boolean language sql immutable
as $$ select case when p_gender='أنثى' then coalesce(p_participant->>'gender','') is distinct from 'ذكر'
                  else p_participant->>'gender'=p_gender end $$;

create or replace function public.diwan_sub_admin_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participants jsonb; v_draws jsonb;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.diwan_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(item),'[]') into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where public.diwan_sub_admin_participant_visible(item,v_admin.gender);
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where exists(select 1 from jsonb_array_elements(v_participants) p where p->>'id'=item->>'participantId');
  return jsonb_build_object('config',v_payload->'config','participants',v_participants,'draws',v_draws);
end $$;
grant execute on function public.diwan_sub_admin_load_state(text) to anon,authenticated;

create or replace function public.diwan_sub_admin_list_sessions(p_token text)
returns setof public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_ids text[];
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select coalesce(array_agg(item->>'id'),'{}') into v_ids
  from jsonb_array_elements(coalesce((select payload->'participants' from public.diwan_state where id=1),'[]')) item
  where public.diwan_sub_admin_participant_visible(item,v_admin.gender);
  return query select * from public.diwan_exam_sessions where participant_id=any(v_ids) order by updated_at desc;
end $$;
grant execute on function public.diwan_sub_admin_list_sessions(text) to anon,authenticated;
