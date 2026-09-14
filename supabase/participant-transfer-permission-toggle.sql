-- صلاحية ثالثة ON/OFF لحساب المسؤول الفرعي ولحساب مشرف المسابقة، بنفس نمط can_edit_final/
-- can_delete_data الحاليتين بالضبط: "يقدر ينقل متسابقين بين اللجان" (can_transfer_participant).
-- سبب اختيارها تحديداً: نقل متسابق بين لجان الاختبار هي العملية الحساسة الوحيدة التي يقدر عليها
-- هذان الحسابان حالياً دون أي صلاحية مستقلة تحميها (خلافاً لتعديل نتيجة معتمدة أو حذف بيانات).
-- القيمة الافتراضية false؛ الإداري الرئيسي وحده يقدر يفعّلها. الإداري الرئيسي نفسه غير مقيَّد بهذه
-- الصلاحية إطلاقاً (نفس سابقة can_edit_final/can_delete_data — لا تحقّق منها بدوال admin_*).
--
-- كل الأجسام أدناه منسوخة حرفياً وكاملة (حقلاً حقلاً) من آخر نسخة فعلية لكل دالة قبل أي تعديل:
--   admin_set_sub_admin_permissions / sub_admin_login / sub_admin_resume  ← sub-admin-permissions-toggle.sql
--   admin_link_supervisor / admin_list_supervisors                        ← supervisor-role.sql
--   sub_admin_transfer_participant / supervisor_transfer_participant      ← committee-transfer-notifications.sql (أحدث نسخة، تُلغي ما بـparticipant-transfer.sql/supervisor-role.sql)
-- + سطر واحد إضافي بكل دالة: إما إضافة الحقل الجديد للكائن المُرجَع، أو تحقّق من الصلاحية قبل التنفيذ.
-- نفّذ هذا الملف من Supabase SQL Editor بعد كل ملفات supabase/*.sql السابقة. قابل لإعادة التشغيل بأمان.

alter table public.sub_admins add column if not exists can_transfer_participant boolean not null default false;
alter table public.profiles add column if not exists can_transfer_participant boolean not null default false;

-- create or replace function لا يكفي هون: الثلاث دوال أدناه تغيّر عدد/نوع معاملاتها أو أعمدة
-- جدولها المُرجَع عن النسخة الحالية بقاعدة البيانات، وPostgres يرفض ذلك بـcreate or replace
-- (يعطي overload جديد بصمت لو تغيّرت المعاملات فقط، أو خطأ 42P13 لو تغيّر شكل الجدول المُرجَع) —
-- لازم drop صريح للتوقيع القديم أولاً حتى يصير استبدالاً حقيقياً لا إضافة نسخة موازية.
drop function if exists public.admin_set_sub_admin_permissions(uuid,boolean,boolean);
drop function if exists public.admin_link_supervisor(uuid,text,boolean,boolean);
drop function if exists public.admin_list_supervisors();

-- ==========================================================================
-- المسؤول الفرعي
-- ==========================================================================
create or replace function public.admin_set_sub_admin_permissions(
  p_id uuid,p_can_edit_final boolean,p_can_delete_data boolean,p_can_transfer_participant boolean default false
)
returns void language plpgsql security definer set search_path=public,extensions
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.sub_admins set can_edit_final=p_can_edit_final,can_delete_data=p_can_delete_data,
    can_transfer_participant=p_can_transfer_participant where id=p_id returning name into v_name;
  if v_name is null then raise exception 'الحساب غير موجود'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'update_sub_admin_permissions','sub_admin',p_id::text,
      jsonb_build_object('name',v_name,'can_edit_final',p_can_edit_final,'can_delete_data',p_can_delete_data,'can_transfer_participant',p_can_transfer_participant));
end $$;
grant execute on function public.admin_set_sub_admin_permissions(uuid,boolean,boolean,boolean) to authenticated;

create or replace function public.sub_admin_login(p_login_code text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_token text;
begin
  select * into v_admin from public.sub_admins where lower(login_code)=lower(trim(p_login_code)) and active=true;

  if v_admin.id is not null and v_admin.locked_until is not null and v_admin.locked_until>now() then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
      values(null,'login_blocked','sub_admin',v_admin.id::text,
        jsonb_build_object('login_code',upper(trim(p_login_code)),'locked_until',v_admin.locked_until));
    raise exception 'الحساب مقفل مؤقتاً بسبب محاولات دخول فاشلة متكررة. حاول لاحقاً بعد دقائق قليلة.';
  end if;

  if v_admin.id is null or v_admin.pin_hash is null or crypt(p_pin,v_admin.pin_hash)<>v_admin.pin_hash then
    if v_admin.id is not null then
      update public.sub_admins set
        failed_login_count=failed_login_count+1,
        locked_until=case when failed_login_count+1>=public.login_lockout_threshold()
          then now()+public.login_lockout_duration() else locked_until end
      where id=v_admin.id;
      insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
        values(null,'login_failed','sub_admin',v_admin.id::text,
          jsonb_build_object('login_code',upper(trim(p_login_code))));
    end if;
    raise exception 'رمز الدخول أو PIN غير صحيح';
  end if;

  update public.sub_admins set failed_login_count=0,locked_until=null where id=v_admin.id;
  delete from public.sub_admin_sessions where expires_at<=now();
  delete from public.sub_admin_sessions where sub_admin_id=v_admin.id;
  v_token=encode(gen_random_bytes(32),'hex');
  insert into public.sub_admin_sessions(sub_admin_id,token_hash,expires_at)
    values(v_admin.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '16 hours');
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'login_success','sub_admin',v_admin.id::text,jsonb_build_object('login_code',v_admin.login_code));
  return jsonb_build_object('token',v_token,'admin',jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender,'can_edit_final',v_admin.can_edit_final,'can_delete_data',v_admin.can_delete_data,'can_transfer_participant',v_admin.can_transfer_participant));
end $$;
grant execute on function public.sub_admin_login(text,text) to anon,authenticated;

create or replace function public.sub_admin_resume(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  update public.sub_admin_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
  return jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender,'can_edit_final',v_admin.can_edit_final,'can_delete_data',v_admin.can_delete_data,'can_transfer_participant',v_admin.can_transfer_participant);
end $$;
grant execute on function public.sub_admin_resume(text) to anon,authenticated;

-- إعادة تعريف كاملة (نفس كل حقل من آخر نسخة فعلية بـcommittee-transfer-notifications.sql) + تحقّق
-- واحد إضافي من can_transfer_participant قبل التنفيذ.
create or replace function public.sub_admin_transfer_participant(p_token text,p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participant jsonb; v_to_name text; v_to_gender text; v_from_name text; v_session public.exam_sessions; v_from_committee_id uuid;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  if not v_admin.can_transfer_participant then raise exception 'نقل المتسابقين بين اللجان يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if v_participant->>'gender'<>v_admin.gender then raise exception 'هذا المتسابق خارج صلاحية هذا الحساب'; end if;
  if p_committee_id is not null then
    select name,responsible_gender into v_to_name,v_to_gender from public.committees where id=p_committee_id and active;
    if v_to_name is null then raise exception 'اللجنة الهدف غير موجودة أو غير مفعّلة'; end if;
    if v_to_gender is not null and v_to_gender<>v_admin.gender then raise exception 'هذه اللجنة خارج صلاحية هذا الحساب'; end if;
  end if;
  select * into v_session from public.exam_sessions where participant_id=p_participant_id;
  if v_session.id is not null then
    if v_session.status='final' then
      raise exception 'لا يمكن نقل متسابق اعتُمدت نتيجته بالفعل — يجب سحب الاعتماد أولاً';
    end if;
    select name into v_from_name from public.committees where id=v_session.committee_id;
    delete from public.exam_sessions where id=v_session.id;
  end if;
  v_from_committee_id=coalesce(v_session.committee_id,nullif(v_participant->>'transferCommitteeId','')::uuid);
  v_payload=jsonb_set(v_payload,'{participants}',(
    select jsonb_agg(case when item->>'id'=p_participant_id
      then jsonb_set(item,'{transferCommitteeId}',coalesce(to_jsonb(p_committee_id::text),'null'::jsonb),true)
      else item end)
    from jsonb_array_elements(v_payload->'participants') item
  ),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'transfer_participant','participant',p_participant_id,
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,
        'participant_name',v_participant->>'name','to_committee_id',p_committee_id,
        'to_committee_name',v_to_name,'from_committee_name',v_from_name));
  perform public.record_transfer_notifications(p_participant_id,v_participant->>'name',v_from_committee_id,p_committee_id);
  return v_payload;
end $$;
grant execute on function public.sub_admin_transfer_participant(text,text,uuid) to anon,authenticated;

-- ==========================================================================
-- مشرف المسابقة
-- ==========================================================================
create or replace function public.admin_link_supervisor(
  p_user_id uuid,p_name text,p_can_edit_final boolean default false,p_can_delete_data boolean default false,
  p_can_transfer_participant boolean default false
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if p_user_id is null then raise exception 'أدخل معرّف المستخدم (UID) من لوحة Supabase'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم المشرف مطلوب'; end if;
  insert into public.profiles(id,role,display_name,can_edit_final,can_delete_data,can_transfer_participant)
  values(p_user_id,'supervisor',trim(p_name),p_can_edit_final,p_can_delete_data,p_can_transfer_participant)
  on conflict(id) do update set role='supervisor',display_name=excluded.display_name,
    can_edit_final=excluded.can_edit_final,can_delete_data=excluded.can_delete_data,
    can_transfer_participant=excluded.can_transfer_participant;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'link_supervisor','supervisor',p_user_id::text,
      jsonb_build_object('name',trim(p_name),'can_edit_final',p_can_edit_final,'can_delete_data',p_can_delete_data,'can_transfer_participant',p_can_transfer_participant));
  return p_user_id;
end $$;
grant execute on function public.admin_link_supervisor(uuid,text,boolean,boolean,boolean) to authenticated;

create or replace function public.admin_list_supervisors()
returns table(id uuid,display_name text,can_edit_final boolean,can_delete_data boolean,can_transfer_participant boolean,created_at timestamptz)
language plpgsql security definer set search_path=public,extensions
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  return query select p.id,p.display_name,p.can_edit_final,p.can_delete_data,p.can_transfer_participant,p.created_at
    from public.profiles p where p.role='supervisor' order by p.created_at;
end $$;
grant execute on function public.admin_list_supervisors() to authenticated;

-- إعادة تعريف كاملة (نفس كل حقل من آخر نسخة فعلية بـcommittee-transfer-notifications.sql) + تحقّق
-- واحد إضافي من can_transfer_participant قبل التنفيذ.
create or replace function public.supervisor_transfer_participant(p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_supervisor_name text; v_can_transfer boolean; v_payload jsonb; v_participant jsonb; v_to_name text; v_from_name text; v_session public.exam_sessions; v_from_committee_id uuid;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name,can_transfer_participant into v_supervisor_name,v_can_transfer from public.profiles where id=auth.uid();
  if not coalesce(v_can_transfer,false) then raise exception 'نقل المتسابقين بين اللجان يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب'; end if;
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
  v_from_committee_id=coalesce(v_session.committee_id,nullif(v_participant->>'transferCommitteeId','')::uuid);
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
  perform public.record_transfer_notifications(p_participant_id,v_participant->>'name',v_from_committee_id,p_committee_id);
  return v_payload;
end $$;
grant execute on function public.supervisor_transfer_participant(text,uuid) to authenticated;
