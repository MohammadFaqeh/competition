-- تحسينات جاهزية يوم المسابقة
-- شغّل الملف كاملاً مرة واحدة في Supabase SQL Editor.

alter table public.committees
add column if not exists can_edit_final boolean not null default false;

alter table public.exam_sessions
add column if not exists is_final_revision boolean not null default false;

create or replace function public.committee_load_state(p_token text)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_committee public.committees;
  v_payload jsonb;
  v_participants jsonb;
  v_draws jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]'::jsonb)) item
  where (item->>'level')::smallint=any(v_committee.levels);

  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]'::jsonb)) item
  where (item->>'level')::smallint=any(v_committee.levels);

  return jsonb_set(jsonb_set(v_payload,'{participants}',v_participants,true),'{draws}',v_draws,true)
    - 'deletions' - 'resets';
end $$;

create or replace function public.committee_claim_student(
  p_token text,p_participant_id text,p_draw_id text,p_level smallint
) returns public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if not (p_level=any(v_committee.levels)) then
    raise exception 'هذا المستوى غير مخصص لهذه اللجنة';
  end if;

  insert into public.exam_sessions(participant_id,draw_id,committee_id,level)
  values(p_participant_id,p_draw_id,v_committee.id,p_level)
  on conflict(participant_id) do nothing
  returning * into v_session;

  if v_session.id is null then
    select * into v_session from public.exam_sessions
    where participant_id=p_participant_id;
    if v_session.committee_id<>v_committee.id then
      raise exception 'هذا المتسابق قيد الاختبار لدى لجنة أخرى';
    end if;
    if v_session.draw_id<>p_draw_id then
      raise exception 'تم تغيير سحب المتسابق؛ حدّث القائمة قبل المتابعة';
    end if;
  end if;
  return v_session;
end $$;

create or replace function public.committee_save_session(
  p_token text,p_session_id uuid,p_assessment jsonb,p_status text,p_score numeric
) returns public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_status not in ('in_progress','final') then raise exception 'حالة التقييم غير صالحة'; end if;

  select * into v_session from public.exam_sessions
  where id=p_session_id and committee_id=v_committee.id for update;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة أو ألغتها الإدارة'; end if;
  if (v_session.status='final' or v_session.is_final_revision) and not v_committee.can_edit_final then
    raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة';
  end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then
    raise exception 'العلامة النهائية غير صالحة';
  end if;

  if v_session.status='final' and p_status='in_progress' then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'reopen_final_result','participant',v_session.participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
        'old_score',v_session.score,'old_assessment',v_session.assessment,'session_id',v_session.id));
  elsif v_session.is_final_revision and p_status='final' then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'revise_final_result','participant',v_session.participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
        'new_score',p_score,'new_assessment',p_assessment,'session_id',v_session.id));
  end if;

  update public.exam_sessions set
    assessment=p_assessment,
    status=p_status,
    score=case when p_status='final' then p_score else null end,
    updated_at=now(),
    finalized_at=case when p_status='final' then now() else finalized_at end,
    is_final_revision=case
      when v_session.status='final' and p_status='in_progress' then true
      when p_status='final' then false
      else v_session.is_final_revision
    end
  where id=p_session_id
  returning * into v_session;
  return v_session;
end $$;

grant execute on function public.committee_load_state(text) to anon,authenticated;
grant execute on function public.committee_claim_student(text,text,text,smallint) to anon,authenticated;
grant execute on function public.committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;

create or replace function public.admin_set_committee_final_edit(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.committees set can_edit_final=p_enabled where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),case when p_enabled then 'grant_final_edit' else 'revoke_final_edit' end,
    'committee',p_committee_id::text,jsonb_build_object('committee_name',v_name,'enabled',p_enabled));
  return p_enabled;
end $$;

grant execute on function public.admin_set_committee_final_edit(uuid,boolean) to authenticated;

-- يسمح بإسناد المستوى نفسه لأكثر من لجنة عند كثرة الطلاب.
-- حجز الطالب الذري في committee_claim_student يمنع امتحانه لدى لجنتين معاً.
drop trigger if exists committees_no_level_overlap on public.committees;
drop function if exists public.prevent_overlapping_committee_levels();

create or replace function public.committee_login(p_login_code text,p_pin text)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_token text;
begin
  select * into v_committee from public.committees
  where lower(login_code)=lower(trim(p_login_code)) and active=true;
  if v_committee.id is null or v_committee.pin_hash is null or crypt(p_pin,v_committee.pin_hash)<>v_committee.pin_hash then
    raise exception 'رمز اللجنة أو PIN غير صحيح';
  end if;
  delete from public.committee_login_sessions where expires_at<=now();
  v_token=encode(gen_random_bytes(32),'hex');
  insert into public.committee_login_sessions(committee_id,token_hash,expires_at)
  values(v_committee.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '16 hours');
  return jsonb_build_object('token',v_token,'committee',jsonb_build_object(
    'id',v_committee.id,'name',v_committee.name,'levels',v_committee.levels,
    'active',v_committee.active,'can_edit_final',v_committee.can_edit_final));
end $$;

create or replace function public.committee_resume(p_token text)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  update public.committee_login_sessions set last_seen_at=now()
  where token_hash=encode(digest(p_token,'sha256'),'hex');
  return jsonb_build_object('id',v_committee.id,'name',v_committee.name,
    'levels',v_committee.levels,'active',v_committee.active,
    'can_edit_final',v_committee.can_edit_final);
end $$;

grant execute on function public.committee_login(text,text) to anon,authenticated;
grant execute on function public.committee_resume(text) to anon,authenticated;
