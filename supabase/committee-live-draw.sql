-- السحب الذري من حساب اللجنة وتبديل موضع أثناء الامتحان.
-- شغّل الملف كاملاً مرة واحدة بعد exam-readiness-hardening.sql.
-- تحديث: السحب من اللجان (رئيساً أو عضواً) أُلغي نهائياً؛ السحب أصبح صلاحية إدارة/مسؤول فرعي فقط.
-- إن كنت تحدّث قاعدة بيانات قائمة، أعد تشغيل هذا الملف كاملاً لتطبيق منع السحب من اللجان.

create or replace function public.committee_create_draw(
  p_token text,
  p_participant_id text,
  p_level smallint,
  p_parts smallint[],
  p_draw jsonb,
  p_change_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_committee public.committees;
  v_payload jsonb;
  v_participant jsonb;
  v_existing jsonb;
  v_owner text;
  v_session public.exam_sessions;
  v_sequence integer;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  raise exception 'إجراء السحب لم يعد متاحاً للجان؛ يقوم به الإدارة أو المسؤول الفرعي فقط';
  if not (p_level=any(v_committee.levels)) then raise exception 'هذا المستوى غير مخصص لهذه اللجنة'; end if;
  if cardinality(p_parts)<>p_level or exists(select 1 from unnest(p_parts) n where n<1 or n>30) then
    raise exception 'الأجزاء المشاركة غير مكتملة أو غير صالحة';
  end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if (v_participant->>'level')::smallint<>p_level then
    raise exception 'مستوى المتسابق تغيّر؛ حدّث قائمة اللجنة ثم أعد المحاولة';
  end if;
  select item into v_existing from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where item->>'participantId'=p_participant_id limit 1;
  if v_existing is not null then
    select c.name into v_owner from public.exam_sessions s join public.committees c on c.id=s.committee_id
      where s.participant_id=p_participant_id;
    raise exception 'تم السحب لهذا المتسابق مسبقاً بواسطة %',coalesce(v_owner,'الإدارة');
  end if;

  if coalesce((v_participant->'parts')::text,'[]')<>to_jsonb(p_parts)::text then
    v_payload=jsonb_set(v_payload,'{participants}',(
      select jsonb_agg(case when item->>'id'=p_participant_id then jsonb_set(item,'{parts}',to_jsonb(p_parts),true) else item end)
      from jsonb_array_elements(v_payload->'participants') item),true);
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
      values(null,'committee_change_parts','participant',p_participant_id,
        jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
          'old_parts',v_participant->'parts','new_parts',to_jsonb(p_parts),'reason',p_change_reason));
  end if;

  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]'::jsonb)||jsonb_build_array(p_draw),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.exam_sessions(participant_id,draw_id,committee_id,level)
    values(p_participant_id,p_draw->>'id',v_committee.id,p_level) returning * into v_session;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'committee_draw','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,'draw_id',p_draw->>'id'));
  return jsonb_build_object('draw',p_draw,'session',to_jsonb(v_session),'committee',to_jsonb(v_committee));
exception when unique_violation then
  select c.name into v_owner from public.exam_sessions s join public.committees c on c.id=s.committee_id
    where s.participant_id=p_participant_id;
  raise exception 'يتم اختبار هذا المتسابق الآن بواسطة لجنة %',coalesce(v_owner,'أخرى');
end $$;

create or replace function public.committee_replace_position(
  p_token text,p_participant_id text,p_draw_id text,p_position_index integer,p_position jsonb,p_assessment jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_draw jsonb; v_old jsonb; v_positions jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if public.committee_role_from_token(p_token)<>'chairman' then raise exception 'تغيير الموضع متاح لرئيس اللجنة فقط'; end if;
  perform 1 from public.exam_sessions where participant_id=p_participant_id and draw_id=p_draw_id
    and committee_id=v_committee.id and status='in_progress' for update;
  if not found then raise exception 'لا يمكن تعديل هذا السحب من هذه اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  select item into v_draw from jsonb_array_elements(v_payload->'draws') item where item->>'id'=p_draw_id limit 1;
  if v_draw is null then raise exception 'السحب غير موجود'; end if;
  v_old=v_draw->'positions'->p_position_index;
  v_positions=jsonb_set(v_draw->'positions',array[p_position_index::text],p_position,false);
  v_draw=jsonb_set(v_draw,'{positions}',v_positions,true);
  v_payload=jsonb_set(v_payload,'{draws}',(
    select jsonb_agg(case when item->>'id'=p_draw_id then v_draw else item end) from jsonb_array_elements(v_payload->'draws') item),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  update public.exam_sessions set assessment=jsonb_set(jsonb_set(coalesce(assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(assessment->'examinerDrafts','{}'::jsonb),true),'{examinerDrafts,chairman}',p_assessment,true),updated_at=now()
    where participant_id=p_participant_id and committee_id=v_committee.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'replace_exam_position','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,'draw_id',p_draw_id,
        'position_index',p_position_index,'old_position',v_old,'new_position',p_position));
  return jsonb_build_object('draw',v_draw,'assessment',p_assessment);
end $$;

grant execute on function public.committee_create_draw(text,text,smallint,smallint[],jsonb,text) to anon,authenticated;
grant execute on function public.committee_replace_position(text,text,text,integer,jsonb,jsonb) to anon,authenticated;

create or replace function public.admin_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payload jsonb; v_existing jsonb; v_owner text; v_sequence integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
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
grant execute on function public.admin_create_draw(jsonb) to authenticated;

-- حذف لجنة لم تبدأ أي امتحان. اللجان المرتبطة بنتائج تُعطّل بدلاً من حذفها لحماية السجل.
create or replace function public.admin_delete_committee(p_committee_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select name into v_name from public.committees where id=p_committee_id for update;
  if v_name is null then raise exception 'اللجنة غير موجودة أو حُذفت مسبقاً'; end if;
  if exists(select 1 from public.exam_sessions where committee_id=p_committee_id) then
    raise exception 'لا يمكن حذف لجنة لديها اختبارات مسجلة؛ استخدم تعطيل اللجنة لحماية النتائج وسجل النشاط';
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'delete_committee','committee',p_committee_id::text,jsonb_build_object('committee_name',v_name));
  delete from public.committees where id=p_committee_id;
  return true;
end $$;
grant execute on function public.admin_delete_committee(uuid) to authenticated;

-- عند وجود لجنتين للمستوى نفسه: يظهر الطالب للجميع قبل الحجز، ثم يبقى للجنة التي بدأت به فقط.
create or replace function public.committee_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_participants jsonb; v_draws jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(item),'[]') into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where (item->>'level')::smallint=any(v_committee.levels)
    and not exists(select 1 from public.exam_sessions s where s.participant_id=item->>'id' and s.committee_id<>v_committee.id);
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where exists(select 1 from jsonb_array_elements(v_participants) participant where participant->>'id'=item->>'participantId');
  return jsonb_set(jsonb_set(v_payload,'{participants}',v_participants,true),'{draws}',v_draws,true)-'deletions'-'resets';
end $$;
grant execute on function public.committee_load_state(text) to anon,authenticated;
