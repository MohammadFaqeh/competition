-- حسابان مستقلان لكل لجنة: رئيس وعضو، ومسودة رصد مستقلة لكل واحد.
-- شغّل هذا الملف كاملاً بعد committee-live-draw.sql.

create extension if not exists pgcrypto;

alter table public.committees add column if not exists member_login_code text;
alter table public.committees add column if not exists member_pin_hash text;
alter table public.committee_login_sessions add column if not exists examiner_role text not null default 'chairman';

alter table public.committee_login_sessions drop constraint if exists committee_login_sessions_examiner_role_check;
alter table public.committee_login_sessions add constraint committee_login_sessions_examiner_role_check
  check (examiner_role in ('chairman','member'));

create unique index if not exists committees_member_login_code_unique
  on public.committees(lower(member_login_code)) where member_login_code is not null;

create or replace function public.committee_role_from_token(p_token text)
returns text language sql security definer set search_path=public,extensions
as $$
  select s.examiner_role from public.committee_login_sessions s
  join public.committees c on c.id=s.committee_id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and c.active=true
  limit 1
$$;

create or replace function public.admin_save_committee_v2(
  p_id uuid,p_name text,p_chairman_code text,p_chairman_pin text,
  p_member_code text,p_member_pin text,p_levels smallint[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم اللجنة مطلوب'; end if;
  if trim(p_chairman_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز الرئيس يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and trim(p_member_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز العضو يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and lower(trim(p_chairman_code))=lower(trim(p_member_code)) then raise exception 'يجب أن يختلف رمز الرئيس عن رمز العضو'; end if;
  if p_id is null and length(coalesce(p_chairman_pin,''))<4 then raise exception 'PIN الرئيس يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is null and length(coalesce(p_member_pin,''))<4 then raise exception 'PIN العضو يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is not null and length(coalesce(p_member_pin,''))<4
    and not exists(select 1 from public.committees where id=p_id and member_pin_hash is not null) then
    raise exception 'أدخل PIN للعضو عند تفعيل حسابه لأول مرة';
  end if;
  if coalesce(array_length(p_levels,1),0)=0 or not (p_levels<@array[5,10,15,20,25,30]::smallint[]) then
    raise exception 'اختر مستوى صالحاً واحداً على الأقل';
  end if;
  if exists(select 1 from public.committees c where c.id is distinct from p_id and
    (lower(trim(p_chairman_code)) in (lower(c.login_code),lower(c.member_login_code)) or
     (nullif(trim(p_member_code),'') is not null and lower(trim(p_member_code)) in (lower(c.login_code),lower(c.member_login_code))))) then
    raise exception 'أحد رموز الدخول مستخدم مسبقاً';
  end if;
  if p_id is null then
    insert into public.committees(name,login_code,pin_hash,member_login_code,member_pin_hash,levels,active)
    values(trim(p_name),upper(trim(p_chairman_code)),crypt(p_chairman_pin,gen_salt('bf')),
      upper(nullif(trim(p_member_code),'')),case when nullif(trim(p_member_code),'') is not null then crypt(p_member_pin,gen_salt('bf')) end,p_levels,p_active) returning id into v_id;
  else
    update public.committees set name=trim(p_name),login_code=upper(trim(p_chairman_code)),
      pin_hash=case when length(coalesce(p_chairman_pin,''))>=4 then crypt(p_chairman_pin,gen_salt('bf')) else pin_hash end,
      member_login_code=upper(nullif(trim(p_member_code),'')),
      member_pin_hash=case when nullif(trim(p_member_code),'') is null then null when length(coalesce(p_member_pin,''))>=4 then crypt(p_member_pin,gen_salt('bf')) else member_pin_hash end,
      levels=p_levels,active=p_active where id=p_id returning id into v_id;
    if v_id is null then raise exception 'اللجنة غير موجودة'; end if;
  end if;
  delete from public.committee_login_sessions where committee_id=v_id and (examiner_role='member' or p_id is null);
  return v_id;
end $$;

create or replace function public.committee_login(p_login_code text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_token text; v_role text;
begin
  select * into v_committee from public.committees where active=true and
    (lower(login_code)=lower(trim(p_login_code)) or lower(member_login_code)=lower(trim(p_login_code))) limit 1;
  if v_committee.id is null then raise exception 'رمز اللجنة أو PIN غير صحيح'; end if;
  if lower(v_committee.login_code)=lower(trim(p_login_code)) and crypt(p_pin,v_committee.pin_hash)=v_committee.pin_hash then v_role='chairman';
  elsif lower(v_committee.member_login_code)=lower(trim(p_login_code)) and crypt(p_pin,v_committee.member_pin_hash)=v_committee.member_pin_hash then v_role='member';
  else raise exception 'رمز اللجنة أو PIN غير صحيح'; end if;
  delete from public.committee_login_sessions where expires_at<=now();
  v_token=encode(gen_random_bytes(32),'hex');
  insert into public.committee_login_sessions(committee_id,token_hash,expires_at,examiner_role)
    values(v_committee.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '16 hours',v_role);
  return jsonb_build_object('token',v_token,'committee',jsonb_build_object(
    'id',v_committee.id,'name',v_committee.name,'levels',v_committee.levels,'active',v_committee.active,
    'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),'examiner_role',v_role));
end $$;

create or replace function public.committee_resume(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_role text;
begin
  v_committee=public.committee_from_token(p_token);v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  update public.committee_login_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
  return jsonb_build_object('id',v_committee.id,'name',v_committee.name,'levels',v_committee.levels,
    'active',v_committee.active,'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),'examiner_role',v_role);
end $$;

create or replace function public.committee_save_session(
  p_token text,p_session_id uuid,p_assessment jsonb,p_status text,p_score numeric
) returns public.exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees;v_session public.exam_sessions;v_role text;v_saved jsonb;v_old_status text;v_was_revision boolean;
begin
  v_committee=public.committee_from_token(p_token);v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_status not in ('in_progress','final') then raise exception 'حالة التقييم غير صالحة'; end if;
  select * into v_session from public.exam_sessions where id=p_session_id and committee_id=v_committee.id for update;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة أو ألغتها الإدارة'; end if;
  v_old_status=v_session.status;v_was_revision=v_session.is_final_revision;
  if p_status='final' and v_role<>'chairman' then raise exception 'اعتماد النتيجة متاح لرئيس اللجنة فقط'; end if;
  if v_session.status='final' and p_status='in_progress' and v_role<>'chairman' then raise exception 'إعادة فتح النتيجة متاحة لرئيس اللجنة فقط'; end if;
  if (v_session.status='final' or v_session.is_final_revision) and not v_committee.can_edit_final then raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة'; end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then raise exception 'العلامة النهائية غير صالحة'; end if;
  if p_status='in_progress' then
    v_saved=jsonb_set(jsonb_set(coalesce(v_session.assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb),true),array['examinerDrafts',v_role],p_assessment,true);
  else
    v_saved=p_assessment||jsonb_build_object('examinerDrafts',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb));
  end if;
  update public.exam_sessions set assessment=v_saved,status=p_status,
    score=case when p_status='final' then p_score else null end,updated_at=now(),
    finalized_at=case when p_status='final' then now() else finalized_at end,
    is_final_revision=case when v_session.status='final' and p_status='in_progress' then true when p_status='final' then false else v_session.is_final_revision end
    where id=p_session_id returning * into v_session;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
    case when v_old_status='final' and p_status='in_progress' then 'reopen_final_result'
      when v_was_revision and p_status='final' then 'revise_final_result'
      when p_status='final' then 'finalize' else 'save_examiner_draft' end,
    'participant',v_session.participant_id,jsonb_build_object('committee_id',v_committee.id,
      'committee_name',v_committee.name,'examiner_role',v_role,'session_id',v_session.id,
      'new_score',p_score,'assessment',p_assessment));
  return v_session;
end $$;

grant execute on function public.admin_save_committee_v2(uuid,text,text,text,text,text,smallint[],boolean) to authenticated;
grant execute on function public.committee_role_from_token(text) to anon,authenticated;
grant execute on function public.committee_login(text,text) to anon,authenticated;
grant execute on function public.committee_resume(text) to anon,authenticated;
grant execute on function public.committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;

-- ملاحظة أمنية: أضف فحص الرئيس إلى عمليتي السحب وتغيير الموضع المنشورتين.
-- النسخة المرفقة من committee-live-draw.sql تحتوي الفحص، لذلك شغّلها بعد هذا الملف أيضاً.
