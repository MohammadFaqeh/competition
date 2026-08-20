-- ترقية اللجان (اسم الرئيس/العضو، الجنس المسؤولة عنه، المستويات التسعة بالاسم)
-- + حسابات أدمن فرعي (ذكور/إناث) بصلاحيات محدودة داخل جنسهم فقط.
-- شغّل هذا الملف كاملاً بعد two-examiners.sql.

create extension if not exists pgcrypto;

-- ==========================================================================
-- 1) كتالوج المستويات التسعة — نفس الأسماء والترتيب المعتمد بالواجهة (app.js: LEVEL_CATALOG)
-- ==========================================================================
create or replace function public.level_name_parts(p_name text)
returns smallint language sql immutable as $$
  select case trim(p_name)
    when 'المستوى الاول (حفظ القرآن كاملاً بغير رواية حفص عن عاصم)' then 30
    when 'المستوى الثاني (حفظ القرآن كاملا برواية حفص عن عاصم)' then 30
    when 'المستوى الثالث (حفظ 25 جزء)' then 25
    when 'المستوى الرابع (حفظ 20 جزء)' then 20
    when 'المستوى الخامس (حفظ 15 جزء)' then 15
    when 'المستوى السادس - أ (حفظ 10 أجزاء للأقل من 20 سنة)' then 10
    when 'المستوى السادس - ب (حفظ 10 أجزاء للأكبر من 20 سنة)' then 10
    when 'المستوى السابع - أ (حفظ 5 أجزاء للأقل من 15 سنة)' then 5
    when 'المستوى السابع - ب (حفظ 5 أجزاء للأكبر من 15 سنة)' then 5
    else null
  end
$$;

create or replace function public.level_names_to_parts(p_names text[])
returns smallint[] language sql immutable as $$
  select coalesce(array_agg(distinct x.p order by x.p) filter (where x.p is not null), '{}'::smallint[])
  from unnest(coalesce(p_names,'{}'::text[])) n, lateral (select public.level_name_parts(n) as p) x
$$;

-- ==========================================================================
-- 2) ترقية جدول اللجان: اسم الرئيس/العضو، الجنس المسؤولة عنه، المستويات بالاسم،
--    وقائمة استثناء لطلاب منقولين لهذه اللجنة رغم عدم مطابقة مستواهم (بند "النقل").
-- ==========================================================================
alter table public.committees add column if not exists chairman_name text;
alter table public.committees add column if not exists member_name text;
alter table public.committees add column if not exists responsible_gender text;
alter table public.committees add column if not exists level_names text[] not null default '{}';
alter table public.committees add column if not exists extra_participant_ids text[] not null default '{}';

alter table public.committees drop constraint if exists committees_responsible_gender_check;
alter table public.committees add constraint committees_responsible_gender_check
  check (responsible_gender is null or responsible_gender in ('ذكر','أنثى'));

alter table public.exam_sessions add column if not exists level_name text;

-- ==========================================================================
-- 3) حفظ لجنة بالحقول الجديدة (اسم الرئيس/العضو، الجنس، المستويات بالاسم)
--    يشتق levels (الرقمية) تلقائياً من level_names فلا يتأثر منطق السحب/الامتحان القديم إطلاقاً.
-- ==========================================================================
create or replace function public.admin_save_committee_v3(
  p_id uuid,p_name text,
  p_chairman_name text,p_chairman_code text,p_chairman_pin text,
  p_member_name text,p_member_code text,p_member_pin text,
  p_responsible_gender text,p_level_names text[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_levels smallint[];
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم اللجنة مطلوب'; end if;
  if nullif(trim(p_chairman_name),'') is null then raise exception 'اسم رئيس اللجنة مطلوب'; end if;
  if trim(p_chairman_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز الرئيس يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and trim(p_member_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز العضو يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and lower(trim(p_chairman_code))=lower(trim(p_member_code)) then raise exception 'يجب أن يختلف رمز الرئيس عن رمز العضو'; end if;
  if p_id is null and length(coalesce(p_chairman_pin,''))<4 then raise exception 'PIN الرئيس يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is null and length(coalesce(p_member_pin,''))<4 then raise exception 'PIN العضو يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is not null and length(coalesce(p_member_pin,''))<4
    and not exists(select 1 from public.committees where id=p_id and member_pin_hash is not null) then
    raise exception 'أدخل PIN للعضو عند تفعيل حسابه لأول مرة';
  end if;
  if p_responsible_gender not in ('ذكر','أنثى') then raise exception 'اختر الجنس المسؤولة عنه اللجنة'; end if;
  if coalesce(array_length(p_level_names,1),0)=0 then raise exception 'اختر مستوى واحداً على الأقل'; end if;
  if exists(select 1 from unnest(p_level_names) n where public.level_name_parts(n) is null) then
    raise exception 'أحد أسماء المستويات غير معروف';
  end if;
  if exists(select 1 from public.committees c where c.id is distinct from p_id and
    (lower(trim(p_chairman_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,''))) or
     (nullif(trim(p_member_code),'') is not null and lower(trim(p_member_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,'')))))) then
    raise exception 'أحد رموز الدخول مستخدم مسبقاً';
  end if;

  v_levels=public.level_names_to_parts(p_level_names);

  if p_id is null then
    insert into public.committees(name,chairman_name,login_code,pin_hash,member_name,member_login_code,member_pin_hash,
      responsible_gender,level_names,levels,active)
    values(trim(p_name),trim(p_chairman_name),upper(trim(p_chairman_code)),crypt(p_chairman_pin,gen_salt('bf')),
      nullif(trim(p_member_name),''),upper(nullif(trim(p_member_code),'')),
      case when nullif(trim(p_member_code),'') is not null then crypt(p_member_pin,gen_salt('bf')) end,
      p_responsible_gender,p_level_names,v_levels,p_active) returning id into v_id;
  else
    update public.committees set name=trim(p_name),chairman_name=trim(p_chairman_name),login_code=upper(trim(p_chairman_code)),
      pin_hash=case when length(coalesce(p_chairman_pin,''))>=4 then crypt(p_chairman_pin,gen_salt('bf')) else pin_hash end,
      member_name=nullif(trim(p_member_name),''),
      member_login_code=upper(nullif(trim(p_member_code),'')),
      member_pin_hash=case when nullif(trim(p_member_code),'') is null then null when length(coalesce(p_member_pin,''))>=4 then crypt(p_member_pin,gen_salt('bf')) else member_pin_hash end,
      responsible_gender=p_responsible_gender,level_names=p_level_names,levels=v_levels,active=p_active
    where id=p_id returning id into v_id;
    if v_id is null then raise exception 'اللجنة غير موجودة'; end if;
  end if;
  delete from public.committee_login_sessions where committee_id=v_id and (examiner_role='member' or p_id is null);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_id is null then 'create_committee' else 'update_committee' end,
      'committee',v_id::text,jsonb_build_object('name',trim(p_name),'responsible_gender',p_responsible_gender,'level_names',p_level_names));
  return v_id;
exception when unique_violation then
  raise exception 'رمز اللجنة مستخدم من لجنة أخرى';
end $$;

grant execute on function public.admin_save_committee_v3(uuid,text,text,text,text,text,text,text,text,text[],boolean) to authenticated;

-- إسناد/نقل طالب استثنائي للجنة دون تغيير مستواه أو المس بأي طالب آخر — يظهر عندها فقط.
create or replace function public.admin_assign_participant_to_committee(p_committee_id uuid,p_participant_id text,p_assign boolean default true)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.committees set extra_participant_ids=case when p_assign
      then array(select distinct unnest(extra_participant_ids||array[p_participant_id]))
      else array_remove(extra_participant_ids,p_participant_id) end
    where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_assign then 'assign_participant_to_committee' else 'unassign_participant_from_committee' end,
      'participant',p_participant_id,jsonb_build_object('committee_id',p_committee_id,'committee_name',v_name));
  return true;
end $$;
grant execute on function public.admin_assign_participant_to_committee(uuid,text,boolean) to authenticated;

-- ==========================================================================
-- 4) تحديث تسجيل الدخول/الاستعادة لإرجاع الحقول الجديدة، وتحديث فلترة الحالة
--    لتكون بالاسم بدل الرقم (مع تراجع تلقائي للرقم إن كان الطالب قديماً بلا اسم مستوى)،
--    وفلترة إضافية حسب الجنس المسؤولة عنه اللجنة (بلا تأثير على لجنة لم تُحدَّد لها بعد).
-- ==========================================================================
create or replace function public.committee_login(p_login_code text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_token text; v_role text;
begin
  select * into v_committee from public.committees where active=true and
    (lower(login_code)=lower(trim(p_login_code)) or lower(coalesce(member_login_code,''))=lower(trim(p_login_code))) limit 1;
  if v_committee.id is null then raise exception 'رمز اللجنة أو PIN غير صحيح'; end if;
  if lower(v_committee.login_code)=lower(trim(p_login_code)) and crypt(p_pin,v_committee.pin_hash)=v_committee.pin_hash then v_role='chairman';
  elsif lower(coalesce(v_committee.member_login_code,''))=lower(trim(p_login_code)) and crypt(p_pin,v_committee.member_pin_hash)=v_committee.member_pin_hash then v_role='member';
  else raise exception 'رمز اللجنة أو PIN غير صحيح'; end if;
  delete from public.committee_login_sessions where expires_at<=now();
  v_token=encode(gen_random_bytes(32),'hex');
  insert into public.committee_login_sessions(committee_id,token_hash,expires_at,examiner_role)
    values(v_committee.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '16 hours',v_role);
  return jsonb_build_object('token',v_token,'committee',jsonb_build_object(
    'id',v_committee.id,'name',v_committee.name,'chairmanName',v_committee.chairman_name,'memberName',v_committee.member_name,
    'responsibleGender',v_committee.responsible_gender,'levelNames',v_committee.level_names,'levels',v_committee.levels,
    'active',v_committee.active,'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),'examiner_role',v_role));
end $$;

create or replace function public.committee_resume(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_role text;
begin
  v_committee=public.committee_from_token(p_token);v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  update public.committee_login_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
  return jsonb_build_object('id',v_committee.id,'name',v_committee.name,'chairmanName',v_committee.chairman_name,
    'memberName',v_committee.member_name,'responsibleGender',v_committee.responsible_gender,
    'levelNames',v_committee.level_names,'levels',v_committee.levels,
    'active',v_committee.active,'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),'examiner_role',v_role);
end $$;

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
  where (v_committee.responsible_gender is null or item->>'gender'=v_committee.responsible_gender)
    and (
      (item->>'id')=any(v_committee.extra_participant_ids)
      or (nullif(item->>'levelName','') is not null and (item->>'levelName')=any(v_committee.level_names))
      or (nullif(item->>'levelName','') is null and (item->>'level')::smallint=any(v_committee.levels))
    )
    and not exists(select 1 from public.exam_sessions s where s.participant_id=item->>'id' and s.committee_id<>v_committee.id);
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where exists(select 1 from jsonb_array_elements(v_participants) participant where participant->>'id'=item->>'participantId');
  return jsonb_set(jsonb_set(v_payload,'{participants}',v_participants,true),'{draws}',v_draws,true)-'deletions'-'resets';
end $$;

grant execute on function public.committee_login(text,text) to anon,authenticated;
grant execute on function public.committee_resume(text) to anon,authenticated;
grant execute on function public.committee_load_state(text) to anon,authenticated;

-- ==========================================================================
-- 5) حسابات أدمن فرعي (ذكور/إناث) — نفس أسلوب دخول اللجان تماماً (رمز + PIN + جلسة).
-- ==========================================================================
create table if not exists public.sub_admins (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  login_code text,
  pin_hash text,
  gender text not null check (gender in ('ذكر','أنثى')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists sub_admins_login_code_unique
  on public.sub_admins(lower(login_code)) where login_code is not null;

create table if not exists public.sub_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  sub_admin_id uuid not null references public.sub_admins(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.sub_admins enable row level security;
alter table public.sub_admin_sessions enable row level security;
revoke all on public.sub_admins from anon;
revoke all on public.sub_admin_sessions from anon, authenticated;
grant select,insert,update,delete on public.sub_admins to authenticated;

drop policy if exists sub_admins_admin_all on public.sub_admins;
create policy sub_admins_admin_all on public.sub_admins for all to authenticated
  using (public.current_user_role()='admin') with check (public.current_user_role()='admin');

create or replace function public.sub_admin_from_token(p_token text)
returns public.sub_admins language sql security definer set search_path=public,extensions
as $$
  select a.* from public.sub_admins a join public.sub_admin_sessions s on s.sub_admin_id=a.id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and a.active=true
  limit 1
$$;

create or replace function public.admin_save_sub_admin(
  p_id uuid,p_name text,p_login_code text,p_pin text,p_gender text,p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم الحساب مطلوب'; end if;
  if trim(p_login_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز الدخول يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if p_id is null and length(coalesce(p_pin,''))<4 then raise exception 'PIN يجب أن يكون 4 خانات على الأقل'; end if;
  if p_gender not in ('ذكر','أنثى') then raise exception 'اختر جنس الحساب'; end if;
  if p_id is null then
    insert into public.sub_admins(name,login_code,pin_hash,gender,active)
    values(trim(p_name),upper(trim(p_login_code)),crypt(p_pin,gen_salt('bf')),p_gender,p_active) returning id into v_id;
  else
    update public.sub_admins set name=trim(p_name),login_code=upper(trim(p_login_code)),gender=p_gender,active=p_active,
      pin_hash=case when length(coalesce(p_pin,''))>=4 then crypt(p_pin,gen_salt('bf')) else pin_hash end
    where id=p_id returning id into v_id;
    if v_id is null then raise exception 'الحساب غير موجود'; end if;
  end if;
  delete from public.sub_admin_sessions where sub_admin_id=v_id and p_id is null;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_id is null then 'create_sub_admin' else 'update_sub_admin' end,
      'sub_admin',v_id::text,jsonb_build_object('name',trim(p_name),'gender',p_gender,'active',p_active));
  return v_id;
exception when unique_violation then
  raise exception 'رمز الدخول مستخدم من حساب آخر';
end $$;
grant execute on function public.admin_save_sub_admin(uuid,text,text,text,text,boolean) to authenticated;

create or replace function public.admin_delete_sub_admin(p_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.sub_admins where id=p_id returning name into v_name;
  if v_name is null then raise exception 'الحساب غير موجود'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'delete_sub_admin','sub_admin',p_id::text,jsonb_build_object('name',v_name));
  return true;
end $$;
grant execute on function public.admin_delete_sub_admin(uuid) to authenticated;

create or replace function public.sub_admin_login(p_login_code text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_token text;
begin
  select * into v_admin from public.sub_admins where lower(login_code)=lower(trim(p_login_code)) and active=true;
  if v_admin.id is null or v_admin.pin_hash is null or crypt(p_pin,v_admin.pin_hash)<>v_admin.pin_hash then
    raise exception 'رمز الدخول أو PIN غير صحيح';
  end if;
  delete from public.sub_admin_sessions where expires_at<=now();
  v_token=encode(gen_random_bytes(32),'hex');
  insert into public.sub_admin_sessions(sub_admin_id,token_hash,expires_at)
    values(v_admin.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '16 hours');
  return jsonb_build_object('token',v_token,'admin',jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender));
end $$;

create or replace function public.sub_admin_resume(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  update public.sub_admin_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
  return jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender);
end $$;

create or replace function public.sub_admin_logout(p_token text)
returns void language sql security definer set search_path=public,extensions
as $$ delete from public.sub_admin_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') $$;

-- قراءة الحالة مقتصرة على جنس الحساب فقط، بالإضافة لأسماء اللجان (بلا أكواد دخولها) لغرض الإسناد.
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
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'levelNames',level_names,'active',active)),'[]') into v_committees
  from public.committees where responsible_gender is null or responsible_gender=v_admin.gender;
  return jsonb_build_object('config',v_payload->'config','participants',v_participants,'draws',v_draws,'committees',v_committees);
end $$;

-- حفظ دفعة من المتسابقين (إضافة/تعديل/علامة يدوية) ضمن جنس الحساب فقط — لا يمكنها المساس بالجنس الآخر إطلاقاً
-- لأن باقي المصفوفة تُبنى من المخزَّن فعلياً وليس مما يرسله المتصفح.
create or replace function public.sub_admin_save_participants(p_token text,p_participants jsonb,p_deleted_ids text[] default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_others jsonb; v_final jsonb; v_draws jsonb;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) item where item->>'gender'<>v_admin.gender) then
    raise exception 'لا يمكن إضافة أو تعديل متسابق من جنس مختلف عن صلاحية هذا الحساب';
  end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  -- كل ما ليس من جنس الحساب، أو من جنسه لكن لم يُرسَل ضمن الدفعة ولا ضمن المحذوفين، يبقى كما هو
  select coalesce(jsonb_agg(item),'[]') into v_others
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where item->>'gender'<>v_admin.gender
     or (not (item->>'id'=any(p_deleted_ids)) and not exists(select 1 from jsonb_array_elements(p_participants) n where n->>'id'=item->>'id'));
  v_final=v_others||p_participants;
  v_payload=jsonb_set(v_payload,'{participants}',v_final,true);
  if cardinality(p_deleted_ids)>0 then
    select coalesce(jsonb_agg(item),'[]') into v_draws
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where not (item->>'participantId'=any(p_deleted_ids));
    v_payload=jsonb_set(v_payload,'{draws}',v_draws,true);
  end if;
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'sub_admin_save_participants','participant','batch',
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,'gender',v_admin.gender,
        'count',jsonb_array_length(p_participants),'deleted_count',cardinality(p_deleted_ids)));
  return v_payload;
end $$;
grant execute on function public.sub_admin_save_participants(text,jsonb,text[]) to anon,authenticated;

create or replace function public.sub_admin_create_draw(p_token text,p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participant jsonb; v_existing jsonb; v_owner text; v_sequence integer;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_draw->>'participantId' limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if v_participant->>'gender'<>v_admin.gender then raise exception 'هذا المتسابق خارج صلاحية هذا الحساب'; end if;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  select item into v_existing from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where item->>'participantId'=p_draw->>'participantId' limit 1;
  if v_existing is not null then
    select c.name into v_owner from public.exam_sessions s join public.committees c on c.id=s.committee_id
      where s.participant_id=p_draw->>'participantId';
    raise exception 'تم السحب لهذا المتسابق مسبقاً بواسطة %',coalesce(v_owner,'الإدارة');
  end if;
  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]')||jsonb_build_array(p_draw),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'sub_admin_draw','participant',p_draw->>'participantId',
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,'draw_id',p_draw->>'id'));
  return p_draw;
end $$;
grant execute on function public.sub_admin_create_draw(text,jsonb) to anon,authenticated;

-- إسناد/نقل طالب من جنس الحساب نفسه للجنة — بنفس منطق الإدارة، بلا حذف ولا تعديل مستوى.
create or replace function public.sub_admin_assign_participant_to_committee(p_token text,p_committee_id uuid,p_participant_id text,p_assign boolean default true)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_admin public.sub_admins; v_gender text; v_committee_name text;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select item->>'gender' into v_gender from jsonb_array_elements(
    coalesce((select payload->'participants' from public.competition_state where id=1),'[]'::jsonb)) item
    where item->>'id'=p_participant_id limit 1;
  if v_gender is null then raise exception 'المتسابق غير موجود'; end if;
  if v_gender<>v_admin.gender then raise exception 'هذا المتسابق خارج صلاحية هذا الحساب'; end if;
  update public.committees set extra_participant_ids=case when p_assign
      then array(select distinct unnest(extra_participant_ids||array[p_participant_id]))
      else array_remove(extra_participant_ids,p_participant_id) end
    where id=p_committee_id returning name into v_committee_name;
  if v_committee_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,case when p_assign then 'assign_participant_to_committee' else 'unassign_participant_from_committee' end,
      'participant',p_participant_id,jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,
        'committee_id',p_committee_id,'committee_name',v_committee_name));
  return true;
end $$;
grant execute on function public.sub_admin_assign_participant_to_committee(text,uuid,text,boolean) to anon,authenticated;

grant execute on function public.sub_admin_login(text,text) to anon,authenticated;
grant execute on function public.sub_admin_resume(text) to anon,authenticated;
grant execute on function public.sub_admin_logout(text) to anon,authenticated;
grant execute on function public.sub_admin_load_state(text) to anon,authenticated;

-- ==========================================================================
-- 6) سجل النشاط: عرضه للإدارة فقط أصلاً (سياسة موجودة)، هذا الملف يضيف له
--    أفعال الأدمن الفرعي (create/update/delete sub_admin, sub_admin_save_participants, sub_admin_draw, assign/unassign)
--    وأفعال اللجان الجديدة (create/update committee) — كلها بالإدراج أعلاه، بلا حاجة لأي تعديل إضافي على audit_log نفسه.
-- ==========================================================================
