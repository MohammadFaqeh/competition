-- تعديل صغير: يضيف extra_participant_ids (قائمة الطلاب المنقولين استثنائياً) إلى قائمة
-- اللجان التي يراها الأدمن الفرعي، حتى تقدر واجهة "نقل" تعرض حالة الإسناد الحالية بدقة.
-- شغّل هذا الملف بعد sub-admins-and-committee-upgrade.sql.

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
      'extraParticipantIds',extra_participant_ids,'active',active)),'[]') into v_committees
  from public.committees where responsible_gender is null or responsible_gender=v_admin.gender;
  return jsonb_build_object('config',v_payload->'config','participants',v_participants,'draws',v_draws,'committees',v_committees);
end $$;
