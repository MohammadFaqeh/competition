-- منصة المسابقة السنوية - قاعدة البيانات المشتركة
-- نفّذ هذا الملف مرة واحدة داخل SQL Editor في مشروع Supabase الخاص بالفرع.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','committee')),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  levels smallint[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint valid_committee_levels check (levels <@ array[5,10,15,20,25,30]::smallint[])
);

create table if not exists public.competition_state (
  id smallint primary key default 1 check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null unique,
  draw_id text not null,
  committee_id uuid not null references public.committees(id),
  level smallint not null check (level in (5,10,15,20,25,30)),
  status text not null default 'in_progress' check (status in ('in_progress','final')),
  assessment jsonb not null default '{}'::jsonb,
  score numeric(5,2) check (score between 0 and 100),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

create or replace function public.current_committee_id()
returns uuid language sql stable security definer set search_path=public
as $$ select id from public.committees where auth_user_id=auth.uid() and active=true $$;

create or replace function public.current_committee_levels()
returns smallint[] language sql stable security definer set search_path=public
as $$ select coalesce(levels,'{}'::smallint[]) from public.committees where auth_user_id=auth.uid() and active=true $$;

alter table public.profiles enable row level security;
alter table public.committees enable row level security;
alter table public.competition_state enable row level security;
alter table public.exam_sessions enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id=auth.uid() or public.current_user_role()='admin');

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
using (public.current_user_role()='admin') with check (public.current_user_role()='admin');

drop policy if exists committees_read on public.committees;
create policy committees_read on public.committees for select to authenticated
using (auth_user_id=auth.uid() or public.current_user_role()='admin');

drop policy if exists committees_admin_write on public.committees;
create policy committees_admin_write on public.committees for all to authenticated
using (public.current_user_role()='admin') with check (public.current_user_role()='admin');

drop policy if exists state_read on public.competition_state;
create policy state_read on public.competition_state for select to authenticated using (true);

drop policy if exists state_admin_write on public.competition_state;
create policy state_admin_write on public.competition_state for all to authenticated
using (public.current_user_role()='admin') with check (public.current_user_role()='admin');

drop policy if exists sessions_read on public.exam_sessions;
create policy sessions_read on public.exam_sessions for select to authenticated
using (public.current_user_role()='admin' or committee_id=public.current_committee_id());

drop policy if exists sessions_committee_insert on public.exam_sessions;
create policy sessions_committee_insert on public.exam_sessions for insert to authenticated
with check (
  committee_id=public.current_committee_id()
  and level=any(public.current_committee_levels())
);

drop policy if exists sessions_committee_update on public.exam_sessions;
create policy sessions_committee_update on public.exam_sessions for update to authenticated
using (public.current_user_role()='admin' or committee_id=public.current_committee_id())
with check (public.current_user_role()='admin' or committee_id=public.current_committee_id());

drop policy if exists audit_read_admin on public.audit_log;
create policy audit_read_admin on public.audit_log for select to authenticated
using (public.current_user_role()='admin');

drop policy if exists audit_insert_authenticated on public.audit_log;
create policy audit_insert_authenticated on public.audit_log for insert to authenticated
with check (actor_id=auth.uid());

create or replace function public.claim_student(
  p_participant_id text,
  p_draw_id text,
  p_level smallint
) returns public.exam_sessions
language plpgsql security definer set search_path=public
as $$
declare
  v_committee public.committees;
  v_session public.exam_sessions;
begin
  select * into v_committee from public.committees
  where auth_user_id=auth.uid() and active=true;
  if v_committee.id is null then raise exception 'لا يوجد حساب لجنة فعال'; end if;
  if not (p_level=any(v_committee.levels)) then raise exception 'هذا المستوى غير مخصص للجنة'; end if;

  insert into public.exam_sessions(participant_id,draw_id,committee_id,level)
  values(p_participant_id,p_draw_id,v_committee.id,p_level)
  on conflict(participant_id) do nothing
  returning * into v_session;

  if v_session.id is null then
    select * into v_session from public.exam_sessions where participant_id=p_participant_id;
    if v_session.committee_id<>v_committee.id then raise exception 'المتسابق محجوز لدى لجنة أخرى'; end if;
  end if;
  return v_session;
end $$;

grant execute on function public.claim_student(text,text,smallint) to authenticated;

create or replace function public.link_committee_account(
  p_user_id uuid,
  p_name text,
  p_levels smallint[]
) returns public.committees
language plpgsql security definer set search_path=public
as $$
declare v_committee public.committees;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if not (p_levels <@ array[5,10,15,20,25,30]::smallint[]) or cardinality(p_levels)=0 then
    raise exception 'اختر مستوى واحداً على الأقل';
  end if;
  insert into public.profiles(id,role,display_name) values(p_user_id,'committee',p_name)
  on conflict(id) do update set role='committee',display_name=excluded.display_name;
  insert into public.committees(name,auth_user_id,levels) values(p_name,p_user_id,p_levels)
  on conflict(auth_user_id) do update set name=excluded.name,levels=excluded.levels,active=true
  returning * into v_committee;
  return v_committee;
end $$;

grant execute on function public.link_committee_account(uuid,text,smallint[]) to authenticated;

insert into public.competition_state(id,payload) values(1,'{}'::jsonb)
on conflict(id) do nothing;
