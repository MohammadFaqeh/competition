-- دخول اللجان برمز وPIN بدون بريد إلكتروني
-- شغّل الملف كاملاً مرة واحدة من Supabase SQL Editor.

create extension if not exists pgcrypto;

alter table public.committees alter column auth_user_id drop not null;
alter table public.committees add column if not exists login_code text;
alter table public.committees add column if not exists pin_hash text;

create unique index if not exists committees_login_code_unique
on public.committees (lower(login_code)) where login_code is not null;

create table if not exists public.committee_login_sessions (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.committee_login_sessions enable row level security;
revoke all on public.committee_login_sessions from anon, authenticated;

create or replace function public.admin_save_committee(
  p_id uuid,
  p_name text,
  p_login_code text,
  p_pin text,
  p_levels smallint[],
  p_active boolean default true
) returns uuid
language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid;
begin
  if public.current_user_role() <> 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم اللجنة مطلوب'; end if;
  if trim(p_login_code) !~ '^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز اللجنة يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if p_id is null and length(coalesce(p_pin,'')) < 4 then raise exception 'PIN يجب أن يكون 4 خانات على الأقل'; end if;
  if coalesce(array_length(p_levels,1),0)=0 then raise exception 'اختر مستوى واحداً على الأقل'; end if;
  if not (p_levels <@ array[5,10,15,20,25,30]::smallint[]) then raise exception 'المستويات غير صالحة'; end if;

  if p_id is null then
    insert into public.committees(name,login_code,pin_hash,levels,active)
    values(trim(p_name),upper(trim(p_login_code)),crypt(p_pin,gen_salt('bf')),p_levels,p_active)
    returning id into v_id;
  else
    update public.committees set
      name=trim(p_name), login_code=upper(trim(p_login_code)), levels=p_levels, active=p_active,
      pin_hash=case when length(coalesce(p_pin,''))>=4 then crypt(p_pin,gen_salt('bf')) else pin_hash end
    where id=p_id returning id into v_id;
    if v_id is null then raise exception 'اللجنة غير موجودة'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'رمز اللجنة مستخدم من لجنة أخرى';
end $$;

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
    'id',v_committee.id,'name',v_committee.name,'levels',v_committee.levels,'active',v_committee.active));
end $$;

create or replace function public.committee_from_token(p_token text)
returns public.committees
language sql security definer set search_path=public,extensions
as $$
  select c from public.committees c join public.committee_login_sessions s on s.committee_id=c.id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and c.active=true
  limit 1
$$;

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
  return jsonb_build_object('id',v_committee.id,'name',v_committee.name,'levels',v_committee.levels,'active',v_committee.active);
end $$;

create or replace function public.committee_logout(p_token text)
returns void language sql security definer set search_path=public,extensions
as $$ delete from public.committee_login_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') $$;

create or replace function public.committee_load_state(p_token text)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  return coalesce(v_payload,'{}'::jsonb);
end $$;

create or replace function public.committee_list_sessions(p_token text)
returns setof public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  return query select * from public.exam_sessions where committee_id=v_committee.id order by updated_at desc;
end $$;

create or replace function public.committee_claim_student(p_token text,p_participant_id text,p_draw_id text,p_level smallint)
returns public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if not (p_level=any(v_committee.levels)) then raise exception 'هذا المستوى غير مخصص لهذه اللجنة'; end if;
  select * into v_session from public.exam_sessions where participant_id=p_participant_id;
  if v_session.id is not null and v_session.committee_id<>v_committee.id then raise exception 'بدأت لجنة أخرى امتحان هذا المتسابق'; end if;
  if v_session.id is null then
    insert into public.exam_sessions(participant_id,draw_id,committee_id,level)
    values(p_participant_id,p_draw_id,v_committee.id,p_level) returning * into v_session;
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
  update public.exam_sessions set assessment=p_assessment,status=p_status,score=p_score,updated_at=now(),
    finalized_at=case when p_status='final' then now() else finalized_at end
  where id=p_session_id and committee_id=v_committee.id returning * into v_session;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة'; end if;
  return v_session;
end $$;

grant execute on function public.committee_login(text,text) to anon,authenticated;
grant execute on function public.committee_resume(text) to anon,authenticated;
grant execute on function public.committee_logout(text) to anon,authenticated;
grant execute on function public.committee_load_state(text) to anon,authenticated;
grant execute on function public.committee_list_sessions(text) to anon,authenticated;
grant execute on function public.committee_claim_student(text,text,text,smallint) to anon,authenticated;
grant execute on function public.committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;
grant execute on function public.admin_save_committee(uuid,text,text,text,smallint[],boolean) to authenticated;

