-- دور "مشرف المسابقة" (Supervisor) — بين الإداري الرئيسي (admin) والأدمن الفرعي (sub_admin).
-- بخلاف الأدمن الفرعي/اللجان (رمز دخول + PIN مخصص)، القرار هنا هو حساب Supabase Auth حقيقي
-- يدخل من نفس شاشة "دخول إدارة المسابقة" (إيميل + كلمة سر) بالضبط مثل الإداري الرئيسي —
-- طلب صريح من الإدارة لتقليل عدد شاشات الدخول المنفصلة.
--
-- الأثر العملي (لا يوجد مفتاح service_role بالمشروع، فلا يقدر التطبيق ينشئ مستخدم Supabase
-- Auth جديد ذاتيًا): لإضافة مشرف جديد، الإداري يضيف مستخدماً يدويًا من "Authentication" في
-- لوحة تحكم Supabase (إيميل + كلمة سر)، ثم ينسخ الـ UID الخاص به ويلصقه هنا بالتطبيق مرة
-- واحدة فقط (لوحة "حسابات مشرف المسابقة") — تمامًا نفس أسلوب link_committee_account القديم
-- الموجود أصلًا بالمشروع (security-fix-null-safe-admin-checks.sql).
--
-- صلاحيتان خاصتان قابلتان للمنح لكل مشرف على حدة، مخزّنتان مباشرة على profiles:
--   can_edit_final   — تعديل علامة متسابق نتيجته معتمدة إلكترونيًا (scoreSource='electronic').
--   can_delete_data  — حذف متسابقين/سحوبات (بيانات أساسية حساسة).
-- افتراضيًا false لكلتيهما؛ الإداري الرئيسي وحده يقدر يفعّلهما.
--
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

-- توسيع قيد الدور على profiles ليشمل supervisor (كان مقيدًا بـ admin/committee فقط).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','committee','supervisor'));
alter table public.profiles add column if not exists can_edit_final boolean not null default false;
alter table public.profiles add column if not exists can_delete_data boolean not null default false;

-- توسيع سياسات القراءة (RLS) فقط — الكتابة تبقى محصورة بالإداري الرئيسي عبر سياساتها
-- الأصلية دون أي تعديل؛ كل كتابة يحتاجها المشرف تمر عبر دوال supervisor_* أدناه (تتجاوز RLS
-- بصفتها security definer، بعد تحقق صريح من الدور داخل كل دالة).
drop policy if exists committees_read on public.committees;
create policy committees_read on public.committees for select to authenticated
using (auth_user_id=auth.uid() or public.current_user_role() in ('admin','supervisor'));

drop policy if exists sessions_read on public.exam_sessions;
create policy sessions_read on public.exam_sessions for select to authenticated
using (public.current_user_role() in ('admin','supervisor') or committee_id=public.current_committee_id());

drop policy if exists audit_read_admin on public.audit_log;
create policy audit_read_admin on public.audit_log for select to authenticated
using (public.current_user_role() in ('admin','supervisor'));

-- sub_admins له سياسة واحدة شاملة (قراءة+كتابة) للإداري فقط (sub_admins_admin_all) — لا
-- نوسّعها (تفتح كتابة مباشرة للمشرف بتجاوز RPCs)، بل نضيف سياسة قراءة منفصلة له فقط.
drop policy if exists sub_admins_supervisor_read on public.sub_admins;
create policy sub_admins_supervisor_read on public.sub_admins for select to authenticated
using (public.current_user_role()='supervisor');

-- ==========================================================================
-- ربط/إدارة حسابات المشرفين — للإداري الرئيسي فقط.
-- ==========================================================================
create or replace function public.admin_link_supervisor(
  p_user_id uuid,p_name text,p_can_edit_final boolean default false,p_can_delete_data boolean default false
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if p_user_id is null then raise exception 'أدخل معرّف المستخدم (UID) من لوحة Supabase'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم المشرف مطلوب'; end if;
  insert into public.profiles(id,role,display_name,can_edit_final,can_delete_data)
  values(p_user_id,'supervisor',trim(p_name),p_can_edit_final,p_can_delete_data)
  on conflict(id) do update set role='supervisor',display_name=excluded.display_name,
    can_edit_final=excluded.can_edit_final,can_delete_data=excluded.can_delete_data;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'link_supervisor','supervisor',p_user_id::text,
      jsonb_build_object('name',trim(p_name),'can_edit_final',p_can_edit_final,'can_delete_data',p_can_delete_data));
  return p_user_id;
end $$;
grant execute on function public.admin_link_supervisor(uuid,text,boolean,boolean) to authenticated;

create or replace function public.admin_list_supervisors()
returns table(id uuid,display_name text,can_edit_final boolean,can_delete_data boolean,created_at timestamptz)
language plpgsql security definer set search_path=public,extensions
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  return query select p.id,p.display_name,p.can_edit_final,p.can_delete_data,p.created_at
    from public.profiles p where p.role='supervisor' order by p.created_at;
end $$;
grant execute on function public.admin_list_supervisors() to authenticated;

create or replace function public.admin_delete_supervisor(p_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.profiles where id=p_id and role='supervisor' returning display_name into v_name;
  if v_name is null then raise exception 'الحساب غير موجود'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'unlink_supervisor','supervisor',p_id::text,jsonb_build_object('name',v_name));
  return true;
end $$;
grant execute on function public.admin_delete_supervisor(uuid) to authenticated;

-- ==========================================================================
-- ما يستخدمه حساب المشرف نفسه — كله يتحقق من current_user_role()='supervisor' عبر
-- auth.uid() (جلسة Supabase Auth حقيقية، بلا أي توكن مخصص).
-- ==========================================================================
create or replace function public.supervisor_load_state()
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select payload into v_payload from public.competition_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  return jsonb_build_object(
    'config',jsonb_build_object('competitionName',v_payload->'config'->>'competitionName'),
    'participants',coalesce(v_payload->'participants','[]'),'draws',coalesce(v_payload->'draws','[]'));
end $$;
grant execute on function public.supervisor_load_state() to authenticated;

-- حفظ دفعة متسابقين/سحوبات (بدمج، لا استبدال أعمى — نفس نمط admin_save_state) بلا لمس config
-- إطلاقًا، ومع حماية: لا يعدّل علامة نتيجة معتمدة إلكترونيًا إلا بصلاحية can_edit_final، ولا
-- يحذف متسابقين/سحوبات إلا بصلاحية can_delete_data.
create or replace function public.supervisor_save_state(
  p_participants jsonb,p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',p_deleted_draw_ids text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_can_edit_final boolean; v_can_delete_data boolean; v_payload jsonb; v_others_participants jsonb; v_others_draws jsonb; v_final_participants jsonb; v_final_draws jsonb;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select can_edit_final,can_delete_data into v_can_edit_final,v_can_delete_data from public.profiles where id=auth.uid();

  if not v_can_delete_data and (cardinality(p_deleted_participant_ids)>0 or cardinality(p_deleted_draw_ids)>0) then
    raise exception 'حذف بيانات المتسابقين أو السحوبات يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب';
  end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  if not v_can_edit_final and exists(
    select 1 from jsonb_array_elements(p_participants) n
    join jsonb_array_elements(coalesce(v_payload->'participants','[]')) old on old->>'id'=n->>'id'
    where old->>'scoreSource'='electronic' and coalesce(old->>'score','')<>coalesce(n->>'score','')
  ) then
    raise exception 'تعديل علامة معتمدة إلكترونيًا يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب';
  end if;

  select coalesce(jsonb_agg(item),'[]') into v_others_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where not (item->>'id'=any(p_deleted_participant_ids))
    and not exists(select 1 from jsonb_array_elements(p_participants) n where n->>'id'=item->>'id');
  v_final_participants=v_others_participants||p_participants;

  select coalesce(jsonb_agg(item),'[]') into v_others_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where not (item->>'id'=any(p_deleted_draw_ids))
    and not exists(select 1 from jsonb_array_elements(p_draws) n where n->>'id'=item->>'id');
  v_final_draws=v_others_draws||p_draws;

  v_payload=jsonb_set(v_payload,'{participants}',v_final_participants,true);
  v_payload=jsonb_set(v_payload,'{draws}',v_final_draws,true);

  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return jsonb_build_object('participants',v_final_participants,'draws',v_final_draws);
end $$;
grant execute on function public.supervisor_save_state(jsonb,jsonb,text[],text[]) to authenticated;

-- حفظ لجنة (إنشاء/تعديل) — نفس منطق admin_save_committee_v3 بالضبط.
create or replace function public.supervisor_save_committee(
  p_id uuid,p_name text,
  p_chairman_name text,p_chairman_code text,p_chairman_pin text,
  p_member_name text,p_member_code text,p_member_pin text,
  p_responsible_gender text,p_level_names text[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_levels smallint[]; v_name text;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_name from public.profiles where id=auth.uid();
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
      'committee',v_id::text,jsonb_build_object('name',trim(p_name),'responsible_gender',p_responsible_gender,'level_names',p_level_names,'supervisor_name',v_name));
  return v_id;
exception when unique_violation then
  raise exception 'رمز اللجنة مستخدم من لجنة أخرى';
end $$;
grant execute on function public.supervisor_save_committee(uuid,text,text,text,text,text,text,text,text,text[],boolean) to authenticated;

create or replace function public.supervisor_set_committee_active(p_committee_id uuid,p_active boolean)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
declare v_name text; v_supervisor_name text;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();
  update public.committees set active=p_active where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_active then 'activate_committee' else 'deactivate_committee' end,
      'committee',p_committee_id::text,jsonb_build_object('committee_name',v_name,'supervisor_name',v_supervisor_name));
  return p_active;
end $$;
grant execute on function public.supervisor_set_committee_active(uuid,boolean) to authenticated;

create or replace function public.supervisor_set_committee_final_edit(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
declare v_name text; v_supervisor_name text;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();
  update public.committees set can_edit_final=p_enabled where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_enabled then 'grant_final_edit' else 'revoke_final_edit' end,
      'committee',p_committee_id::text,jsonb_build_object('committee_name',v_name,'enabled',p_enabled,'supervisor_name',v_supervisor_name));
  return p_enabled;
end $$;
grant execute on function public.supervisor_set_committee_final_edit(uuid,boolean) to authenticated;

-- نقل متسابق — نفس منطق admin_transfer_participant بالضبط.
create or replace function public.supervisor_transfer_participant(p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_supervisor_name text; v_payload jsonb; v_participant jsonb; v_to_name text; v_from_name text; v_session public.exam_sessions;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if p_committee_id is not null then
    select name into v_to_name from public.committees where id=p_committee_id and active;
    if v_to_name is null then raise exception 'اللجنة الهدف غير موجودة أو غير مفعّلة'; end if;
  end if;
  select * into v_session from public.exam_sessions where participant_id=p_participant_id;
  if v_session.id is not null then
    if v_session.status='final' then
      raise exception 'لا يمكن نقل متسابق اعتُمدت نتيجته بالفعل — يجب سحب الاعتماد أولاً';
    end if;
    select name into v_from_name from public.committees where id=v_session.committee_id;
    delete from public.exam_sessions where id=v_session.id;
  end if;
  v_payload=jsonb_set(v_payload,'{participants}',(
    select jsonb_agg(case when item->>'id'=p_participant_id
      then jsonb_set(item,'{transferCommitteeId}',coalesce(to_jsonb(p_committee_id::text),'null'::jsonb),true)
      else item end)
    from jsonb_array_elements(v_payload->'participants') item
  ),true);
  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'transfer_participant','participant',p_participant_id,
      jsonb_build_object('participant_name',v_participant->>'name','to_committee_id',p_committee_id,
        'to_committee_name',v_to_name,'from_committee_name',v_from_name,'supervisor_name',v_supervisor_name));
  return v_payload;
end $$;
grant execute on function public.supervisor_transfer_participant(text,uuid) to authenticated;

-- سحب موضع لمتسابق — نفس منطق admin_create_draw بالضبط.
create or replace function public.supervisor_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_existing jsonb; v_owner text; v_sequence integer;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
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
    values(auth.uid(),'supervisor_draw','participant',coalesce(p_draw->>'participantId',p_draw->>'id'),jsonb_build_object('draw_id',p_draw->>'id'));
  return p_draw;
end $$;
grant execute on function public.supervisor_create_draw(jsonb) to authenticated;

create or replace function public.supervisor_delete_participant_session(p_participant_id text)
returns void language plpgsql security definer set search_path=public,extensions
as $$
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  delete from public.exam_sessions where participant_id=p_participant_id;
end $$;
grant execute on function public.supervisor_delete_participant_session(text) to authenticated;

-- إدارة حسابات الأدمن الفرعي — نفس منطق admin_save_sub_admin/admin_delete_sub_admin بالضبط.
create or replace function public.supervisor_save_sub_admin(
  p_id uuid,p_name text,p_login_code text,p_pin text,p_gender text,p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_supervisor_name text;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();
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
      'sub_admin',v_id::text,jsonb_build_object('name',trim(p_name),'gender',p_gender,'active',p_active,'supervisor_name',v_supervisor_name));
  return v_id;
exception when unique_violation then
  raise exception 'رمز الدخول مستخدم من حساب آخر';
end $$;
grant execute on function public.supervisor_save_sub_admin(uuid,text,text,text,text,boolean) to authenticated;

create or replace function public.supervisor_delete_sub_admin(p_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
declare v_name text; v_supervisor_name text;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();
  delete from public.sub_admins where id=p_id returning name into v_name;
  if v_name is null then raise exception 'الحساب غير موجود'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'delete_sub_admin','sub_admin',p_id::text,jsonb_build_object('name',v_name,'supervisor_name',v_supervisor_name));
  return true;
end $$;
grant execute on function public.supervisor_delete_sub_admin(uuid) to authenticated;
