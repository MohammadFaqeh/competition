-- إصلاح أمني عاجل: كل دوال "admin_..." كانت تتحقق من الصلاحية بالشكل
--   if public.current_user_role()<>'admin' then raise exception ...
-- لكن current_user_role() ترجع NULL لأي متصل غير مسجّل دخول (anon) لأنه لا يملك صفاً في profiles.
-- وفي PL/pgSQL: IF NULL THEN ... يُعامَل كأنه FALSE فلا يُرفع الاستثناء، فتُنفَّذ العملية فعلياً
-- لأي شخص يملك anon key العام فقط (وهو مضمّن أصلاً بكود الموقع)، دون أي تسجيل دخول admin.
-- هذا الملف يعيد تعريف كل هذه الدوال بنفس المنطق تماماً، مع استبدال الفحص بصيغة آمنة لـNULL
-- (is distinct from) لا تُنفَّذ العملية إلا مع current_user_role() = 'admin' فعلياً.
-- شغّل هذا الملف فوراً بعد أي من الملفات الأخرى (بما فيها sub-admins-and-committee-upgrade.sql).

create or replace function public.link_committee_account(
  p_user_id uuid,
  p_name text,
  p_levels smallint[]
) returns public.committees
language plpgsql security definer set search_path=public
as $$
declare v_committee public.committees;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
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
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
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

create or replace function public.admin_delete_participant_session(p_participant_id text)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.exam_sessions where participant_id=p_participant_id;
end $$;

create or replace function public.admin_set_committee_final_edit(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.committees set can_edit_final=p_enabled where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),case when p_enabled then 'grant_final_edit' else 'revoke_final_edit' end,
    'committee',p_committee_id::text,jsonb_build_object('committee_name',v_name,'enabled',p_enabled));
  return p_enabled;
end $$;

create or replace function public.admin_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payload jsonb; v_existing jsonb; v_owner text; v_sequence integer;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
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

create or replace function public.admin_delete_committee(p_committee_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
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

create or replace function public.admin_save_committee_v2(
  p_id uuid,p_name text,p_chairman_code text,p_chairman_pin text,
  p_member_code text,p_member_pin text,p_levels smallint[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
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

create or replace function public.admin_save_committee_v3(
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

create or replace function public.admin_assign_participant_to_committee(p_committee_id uuid,p_participant_id text,p_assign boolean default true)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
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

create or replace function public.admin_save_sub_admin(
  p_id uuid,p_name text,p_login_code text,p_pin text,p_gender text,p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
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

create or replace function public.admin_delete_sub_admin(p_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.sub_admins where id=p_id returning name into v_name;
  if v_name is null then raise exception 'الحساب غير موجود'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'delete_sub_admin','sub_admin',p_id::text,jsonb_build_object('name',v_name));
  return true;
end $$;
