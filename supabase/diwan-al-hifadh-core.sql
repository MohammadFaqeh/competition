-- "اختبارات ديوان الحفاظ - فرع الكورة": مسار اختبار مستقل تماماً عن المسابقة القرآنية السنوية —
-- جداول ودوال جديدة بالكامل، بادئتها diwan_، بلا أي لمس لجداول/دوال السنوية (competition_state،
-- committees، exam_sessions، إلخ). نفس حساب الإدارة الرئيسي (profiles.role='admin') يدير كلا
-- المسارين معاً؛ current_user_role() الموجودة أصلاً تُستخدم كما هي بلا تعديل.
--
-- نسخة أساسية مقصودة (بموافقة صريحة): تغطي التسجيل، السحب (فردي/جماعي)، تصدير Excel (من
-- الواجهة مباشرة، لا حاجة لدالة SQL خاصة به)، لجان بحساب رئيس+عضو، تقييم إلكتروني بمُصحّحين،
-- اعتماد نتيجة. بلا الطبقات المتقدمة التي تراكمت بالسنوية عبر شهور استخدام فعلي (قفل حساب بعد
-- محاولات فاشلة، دوال SQL خفيفة للرصد الحي متعدد الطبقات، سحب ذاتي للجنة، سجل نشاط منفصل،
-- استعادة دخول ذاتية) — تُضاف لاحقاً فقط لو فعلاً احتاجها ديوان الحفاظ بنفس الطريقة التي تطوّرت
-- فيها السنوية، لا مسبقاً. نفّذ هذا الملف كاملاً مرة واحدة من SQL Editor بعد كل ملفات supabase/*.sql الحالية.

create extension if not exists pgcrypto;

-- ==========================================================================
-- الجداول
-- ==========================================================================

create table if not exists public.diwan_state (
  id smallint primary key default 1 check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.diwan_state(id,payload) values(1,'{}'::jsonb) on conflict(id) do nothing;

create table if not exists public.diwan_committees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  chairman_name text,
  login_code text,
  pin_hash text,
  member_name text,
  member_login_code text,
  member_pin_hash text,
  responsible_gender text check (responsible_gender in ('ذكر','أنثى')),
  level_names text[] not null default '{}',
  levels smallint[] not null default '{}',
  active boolean not null default true,
  can_edit_final boolean not null default false,
  show_score boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists diwan_committees_login_code_unique
  on public.diwan_committees(lower(login_code)) where login_code is not null;
create unique index if not exists diwan_committees_member_login_code_unique
  on public.diwan_committees(lower(member_login_code)) where member_login_code is not null;

create table if not exists public.diwan_committee_login_sessions (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.diwan_committees(id) on delete cascade,
  token_hash text not null unique,
  examiner_role text not null default 'chairman' check (examiner_role in ('chairman','member')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.diwan_exam_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null unique,
  draw_id text not null,
  committee_id uuid not null references public.diwan_committees(id),
  level smallint,
  level_name text,
  status text not null default 'in_progress' check (status in ('in_progress','final')),
  assessment jsonb not null default '{}'::jsonb,
  score numeric(5,2) check (score between 0 and 100),
  is_final_revision boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz
);

alter table public.diwan_state enable row level security;
alter table public.diwan_committees enable row level security;
alter table public.diwan_committee_login_sessions enable row level security;
alter table public.diwan_exam_sessions enable row level security;
revoke all on public.diwan_committee_login_sessions from anon, authenticated;

-- كل كتابة على اللجان تمر حصراً عبر دوال diwan_admin_* أعلاه (security definer) — لا منح
-- تحديث مباشر على الجدول من العميل، فقط قراءة للإدارة عبر RLS.
grant usage on schema public to anon,authenticated;
grant select on public.diwan_state to authenticated;
grant select on public.diwan_committees to authenticated;
grant select on public.diwan_exam_sessions to authenticated;

drop policy if exists diwan_state_read on public.diwan_state;
create policy diwan_state_read on public.diwan_state for select to authenticated
using (public.current_user_role()='admin');

drop policy if exists diwan_committees_read on public.diwan_committees;
create policy diwan_committees_read on public.diwan_committees for select to authenticated
using (public.current_user_role()='admin');

drop policy if exists diwan_sessions_read on public.diwan_exam_sessions;
create policy diwan_sessions_read on public.diwan_exam_sessions for select to authenticated
using (public.current_user_role()='admin');

-- ==========================================================================
-- مساعدات اللجنة (جلسة الدخول بالتوكن — نفس نمط committee_from_token/committee_role_from_token)
-- ==========================================================================

create or replace function public.diwan_committee_from_token(p_token text)
returns public.diwan_committees language sql security definer set search_path=public,extensions
as $$
  select c from public.diwan_committees c join public.diwan_committee_login_sessions s on s.committee_id=c.id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and c.active=true
  limit 1
$$;

create or replace function public.diwan_committee_role_from_token(p_token text)
returns text language sql security definer set search_path=public,extensions
as $$
  select s.examiner_role from public.diwan_committee_login_sessions s
  join public.diwan_committees c on c.id=s.committee_id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and c.active=true
  limit 1
$$;

-- ==========================================================================
-- دخول/جلسة اللجنة (رئيس أو عضو، بنفس رمز اللجنة الواحد مع PIN مختلف لكل دور)
-- ==========================================================================

create or replace function public.diwan_committee_login(p_login_code text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.diwan_committees; v_token text; v_role text;
begin
  select * into v_committee from public.diwan_committees where active=true and
    (lower(login_code)=lower(trim(p_login_code)) or lower(member_login_code)=lower(trim(p_login_code))) limit 1;
  if v_committee.id is null then raise exception 'رمز اللجنة أو PIN غير صحيح'; end if;
  if lower(v_committee.login_code)=lower(trim(p_login_code)) and crypt(p_pin,v_committee.pin_hash)=v_committee.pin_hash then v_role='chairman';
  elsif lower(v_committee.member_login_code)=lower(trim(p_login_code)) and crypt(p_pin,v_committee.member_pin_hash)=v_committee.member_pin_hash then v_role='member';
  else raise exception 'رمز اللجنة أو PIN غير صحيح'; end if;
  delete from public.diwan_committee_login_sessions where expires_at<=now();
  v_token=encode(gen_random_bytes(32),'hex');
  insert into public.diwan_committee_login_sessions(committee_id,token_hash,expires_at,examiner_role)
    values(v_committee.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '16 hours',v_role);
  return jsonb_build_object('token',v_token,'committee',jsonb_build_object(
    'id',v_committee.id,'name',v_committee.name,'levelNames',v_committee.level_names,'levels',v_committee.levels,
    'active',v_committee.active,'chairmanName',v_committee.chairman_name,'memberName',v_committee.member_name,
    'responsibleGender',v_committee.responsible_gender,'showScore',v_committee.show_score,
    'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),'examiner_role',v_role));
end $$;

create or replace function public.diwan_committee_resume(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.diwan_committees; v_role text;
begin
  v_committee=public.diwan_committee_from_token(p_token);v_role=public.diwan_committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  update public.diwan_committee_login_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
  return jsonb_build_object('id',v_committee.id,'name',v_committee.name,'levelNames',v_committee.level_names,
    'levels',v_committee.levels,'active',v_committee.active,'chairmanName',v_committee.chairman_name,
    'memberName',v_committee.member_name,'responsibleGender',v_committee.responsible_gender,
    'showScore',v_committee.show_score,'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),'examiner_role',v_role);
end $$;

create or replace function public.diwan_committee_logout(p_token text)
returns void language sql security definer set search_path=public,extensions
as $$ delete from public.diwan_committee_login_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') $$;

create or replace function public.diwan_committee_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.diwan_committees; v_payload jsonb;
begin
  v_committee=public.diwan_committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.diwan_state where id=1;
  return coalesce(v_payload,'{}'::jsonb);
end $$;

create or replace function public.diwan_committee_list_sessions(p_token text)
returns setof public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.diwan_committees;
begin
  v_committee=public.diwan_committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  return query select * from public.diwan_exam_sessions where committee_id=v_committee.id order by updated_at desc;
end $$;

-- بدء اختبار متسابق (أول دخول للجنة على موضعه) — يمنع لجنة ثانية تبدأ نفس المتسابق لو سبق وبدأته لجنة أخرى.
create or replace function public.diwan_committee_claim_student(p_token text,p_participant_id text,p_draw_id text,p_level smallint,p_level_name text default null)
returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.diwan_committees; v_session public.diwan_exam_sessions;
begin
  v_committee=public.diwan_committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select * into v_session from public.diwan_exam_sessions where participant_id=p_participant_id;
  if v_session.id is not null and v_session.committee_id<>v_committee.id then raise exception 'بدأت لجنة أخرى امتحان هذا المتسابق'; end if;
  if v_session.id is null then
    insert into public.diwan_exam_sessions(participant_id,draw_id,committee_id,level,level_name)
    values(p_participant_id,p_draw_id,v_committee.id,p_level,p_level_name) returning * into v_session;
  end if;
  return v_session;
end $$;

-- حفظ مسودة/اعتماد تقييم بمُصحّحين (رئيس/عضو) — نفس منطق committee_save_session بالسنوية بالضبط.
create or replace function public.diwan_committee_save_session(
  p_token text,p_session_id uuid,p_assessment jsonb,p_status text,p_score numeric
) returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.diwan_committees; v_session public.diwan_exam_sessions; v_role text; v_saved jsonb;
begin
  v_committee=public.diwan_committee_from_token(p_token);v_role=public.diwan_committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_status not in ('in_progress','final') then raise exception 'حالة التقييم غير صالحة'; end if;
  select * into v_session from public.diwan_exam_sessions where id=p_session_id and committee_id=v_committee.id for update;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة أو ألغتها الإدارة'; end if;
  if p_status='final' and v_role<>'chairman' then raise exception 'اعتماد النتيجة متاح لرئيس اللجنة فقط'; end if;
  if v_session.status='final' and p_status='in_progress' and v_role<>'chairman' then raise exception 'إعادة فتح النتيجة متاحة لرئيس اللجنة فقط'; end if;
  if (v_session.status='final' or v_session.is_final_revision) and not v_committee.can_edit_final then raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة'; end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then raise exception 'العلامة النهائية غير صالحة'; end if;
  if p_status='in_progress' then
    v_saved=jsonb_set(jsonb_set(coalesce(v_session.assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb),true),array['examinerDrafts',v_role],p_assessment,true);
  else
    v_saved=p_assessment||jsonb_build_object('examinerDrafts',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb));
  end if;
  update public.diwan_exam_sessions set assessment=v_saved,status=p_status,
    score=case when p_status='final' then p_score else null end,updated_at=now(),
    finalized_at=case when p_status='final' then now() else finalized_at end,
    is_final_revision=case when v_session.status='final' and p_status='in_progress' then true when p_status='final' then false else v_session.is_final_revision end
    where id=p_session_id returning * into v_session;
  return v_session;
end $$;

grant execute on function public.diwan_committee_login(text,text) to anon,authenticated;
grant execute on function public.diwan_committee_resume(text) to anon,authenticated;
grant execute on function public.diwan_committee_logout(text) to anon,authenticated;
grant execute on function public.diwan_committee_load_state(text) to anon,authenticated;
grant execute on function public.diwan_committee_list_sessions(text) to anon,authenticated;
grant execute on function public.diwan_committee_claim_student(text,text,text,smallint,text) to anon,authenticated;
grant execute on function public.diwan_committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;

-- ==========================================================================
-- الإدارة: حفظ الحالة (متسابقين+سحوبات) — يرسل فقط الفروقات (راجع cloud.js)، يحافظ على أي
-- id غائب عن الدفعة وغير مُدرَج بالمحذوفين كما هو (نفس منطق admin_save_state بالسنوية).
-- ==========================================================================

create or replace function public.diwan_admin_save_state(
  p_config jsonb,p_participants jsonb,p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',p_deleted_draw_ids text[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_others_participants jsonb; v_others_draws jsonb; v_final_participants jsonb; v_final_draws jsonb;
  v_incoming_participant_ids text[]; v_incoming_draw_ids text[];
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;

  select payload into v_payload from public.diwan_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_draw_ids from jsonb_array_elements(p_draws) n;

  select coalesce(jsonb_agg(item),'[]') into v_others_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where not (item->>'id'=any(p_deleted_participant_ids))
    and not (item->>'id'=any(v_incoming_participant_ids));
  v_final_participants=v_others_participants||p_participants;

  select coalesce(jsonb_agg(item),'[]') into v_others_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where not (item->>'id'=any(p_deleted_draw_ids))
    and not (item->>'id'=any(v_incoming_draw_ids));
  v_final_draws=v_others_draws||p_draws;

  v_payload=jsonb_set(v_payload,'{config}',p_config,true);
  v_payload=jsonb_set(v_payload,'{participants}',v_final_participants,true);
  v_payload=jsonb_set(v_payload,'{draws}',v_final_draws,true);

  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return v_payload;
end $$;
grant execute on function public.diwan_admin_save_state(jsonb,jsonb,jsonb,text[],text[]) to authenticated;

-- فحص خفيف جداً (توقيت فقط) قبل أي تنزيل كامل، لنفس سبب competition_state_version بالسنوية.
create or replace function public.diwan_state_version()
returns timestamptz language sql stable security definer set search_path=public
as $$ select updated_at from public.diwan_state where id=1 $$;
grant execute on function public.diwan_state_version() to authenticated;

create or replace function public.diwan_admin_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payload jsonb; v_existing jsonb; v_owner text; v_sequence integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select payload into v_payload from public.diwan_state where id=1 for update;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  if nullif(p_draw->>'participantId','') is not null then
    select item into v_existing from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
      where item->>'participantId'=p_draw->>'participantId' limit 1;
    if v_existing is not null then
      select c.name into v_owner from public.diwan_exam_sessions s join public.diwan_committees c on c.id=s.committee_id
        where s.participant_id=p_draw->>'participantId';
      raise exception 'تم السحب لهذا المتسابق مسبقاً بواسطة %',coalesce(v_owner,'الإدارة');
    end if;
  end if;
  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]')||jsonb_build_array(p_draw),true);
  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return p_draw;
end $$;
grant execute on function public.diwan_admin_create_draw(jsonb) to authenticated;

create or replace function public.diwan_admin_delete_participant_session(p_participant_id text)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.diwan_exam_sessions where participant_id=p_participant_id;
end $$;
grant execute on function public.diwan_admin_delete_participant_session(text) to authenticated;

-- ==========================================================================
-- الإدارة: إدارة اللجان (رئيس+عضو، نفس نمط admin_save_committee_v3 بالسنوية)
-- level_name_parts/level_names_to_parts دوال عامة موجودة أصلاً (سنوية) ومُعاد استخدامها هنا حرفياً.
-- ==========================================================================

create or replace function public.diwan_admin_save_committee(
  p_id uuid,p_name text,
  p_chairman_name text,p_chairman_code text,p_chairman_pin text,
  p_member_name text,p_member_code text,p_member_pin text,
  p_responsible_gender text,p_level_names text[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_levels smallint[];
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم اللجنة مطلوب'; end if;
  if nullif(trim(p_chairman_name),'') is null then raise exception 'اسم رئيس اللجنة مطلوب'; end if;
  if trim(p_chairman_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز الرئيس يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and trim(p_member_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز العضو يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and lower(trim(p_chairman_code))=lower(trim(p_member_code)) then raise exception 'يجب أن يختلف رمز الرئيس عن رمز العضو'; end if;
  if p_id is null and length(coalesce(p_chairman_pin,''))<4 then raise exception 'PIN الرئيس يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is null and length(coalesce(p_member_pin,''))<4 then raise exception 'PIN العضو يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is not null and length(coalesce(p_member_pin,''))<4
    and not exists(select 1 from public.diwan_committees where id=p_id and member_pin_hash is not null) then
    raise exception 'أدخل PIN للعضو عند تفعيل حسابه لأول مرة';
  end if;
  if p_responsible_gender not in ('ذكر','أنثى') then raise exception 'اختر الجنس المسؤولة عنه اللجنة'; end if;
  if coalesce(array_length(p_level_names,1),0)=0 then raise exception 'اختر مستوى واحداً على الأقل'; end if;
  if exists(select 1 from unnest(p_level_names) n where public.level_name_parts(n) is null) then
    raise exception 'أحد أسماء المستويات غير معروف';
  end if;
  if exists(select 1 from public.diwan_committees c where c.id is distinct from p_id and
    (lower(trim(p_chairman_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,''))) or
     (nullif(trim(p_member_code),'') is not null and lower(trim(p_member_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,'')))))) then
    raise exception 'أحد رموز الدخول مستخدم مسبقاً';
  end if;

  v_levels=public.level_names_to_parts(p_level_names);

  if p_id is null then
    insert into public.diwan_committees(name,chairman_name,login_code,pin_hash,member_name,member_login_code,member_pin_hash,
      responsible_gender,level_names,levels,active)
    values(trim(p_name),trim(p_chairman_name),upper(trim(p_chairman_code)),crypt(p_chairman_pin,gen_salt('bf')),
      nullif(trim(p_member_name),''),upper(nullif(trim(p_member_code),'')),
      case when nullif(trim(p_member_code),'') is not null then crypt(p_member_pin,gen_salt('bf')) end,
      p_responsible_gender,p_level_names,v_levels,p_active) returning id into v_id;
  else
    update public.diwan_committees set name=trim(p_name),chairman_name=trim(p_chairman_name),
      login_code=upper(trim(p_chairman_code)),
      pin_hash=case when length(coalesce(p_chairman_pin,''))>=4 then crypt(p_chairman_pin,gen_salt('bf')) else pin_hash end,
      member_name=nullif(trim(p_member_name),''),
      member_login_code=upper(nullif(trim(p_member_code),'')),
      member_pin_hash=case when nullif(trim(p_member_code),'') is null then null when length(coalesce(p_member_pin,''))>=4 then crypt(p_member_pin,gen_salt('bf')) else member_pin_hash end,
      responsible_gender=p_responsible_gender,level_names=p_level_names,levels=v_levels,active=p_active
    where id=p_id returning id into v_id;
    if v_id is null then raise exception 'اللجنة غير موجودة'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'أحد رموز الدخول مستخدم مسبقاً';
end $$;
grant execute on function public.diwan_admin_save_committee(uuid,text,text,text,text,text,text,text,text,text[],boolean) to authenticated;

create or replace function public.diwan_admin_set_committee_final_edit(p_committee_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.diwan_committees set can_edit_final=p_enabled where id=p_committee_id;
end $$;
grant execute on function public.diwan_admin_set_committee_final_edit(uuid,boolean) to authenticated;

create or replace function public.diwan_admin_set_committee_show_score(p_committee_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.diwan_committees set show_score=p_enabled where id=p_committee_id;
end $$;
grant execute on function public.diwan_admin_set_committee_show_score(uuid,boolean) to authenticated;

create or replace function public.diwan_admin_set_committee_active(p_committee_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.diwan_committees set active=p_active where id=p_committee_id;
end $$;
grant execute on function public.diwan_admin_set_committee_active(uuid,boolean) to authenticated;

-- حذف لجنة: يمنع الحذف لو لديها اختبارات مسجَّلة إلا بطلب صريح (p_purge_history)، لحماية نتائج حقيقية.
create or replace function public.diwan_admin_delete_committee(p_committee_id uuid,p_purge_history boolean default false)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select name into v_name from public.diwan_committees where id=p_committee_id for update;
  if v_name is null then raise exception 'اللجنة غير موجودة أو حُذفت مسبقاً'; end if;
  if exists(select 1 from public.diwan_exam_sessions where committee_id=p_committee_id) then
    if not p_purge_history then
      raise exception 'لا يمكن حذف لجنة لديها اختبارات مسجلة؛ استخدم تعطيل اللجنة، أو فعّل خيار الحذف الكامل إن كانت بيانات تجريبية';
    end if;
    delete from public.diwan_exam_sessions where committee_id=p_committee_id;
  end if;
  delete from public.diwan_committees where id=p_committee_id;
  return true;
end $$;
grant execute on function public.diwan_admin_delete_committee(uuid,boolean) to authenticated;
