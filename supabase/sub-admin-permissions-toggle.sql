-- صلاحيتان ON/OFF إضافيتان لحساب مسؤول فرعي معيّن، بنفس نمط can_edit_final/can_delete_data
-- الموجود أصلاً لمشرف المسابقة (راجع supervisor-role.sql) — تتيحان تفويض حساب واحد (عملياً:
-- مسؤولة الإناث) بصلاحيات أوسع دون فتحها لكل حسابات المسؤول الفرعي افتراضياً. القيمة
-- الافتراضية false لكلتيهما؛ الإداري الرئيسي وحده يقدر يفعّلهما، عبر مفتاح منفصل عن نموذج
-- إضافة/تعديل الحساب الأساسي (لا يُفقدان عند تعديل الاسم أو الـPIN).
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

alter table public.sub_admins add column if not exists can_edit_final boolean not null default false;
alter table public.sub_admins add column if not exists can_delete_data boolean not null default false;

create or replace function public.admin_set_sub_admin_permissions(p_id uuid,p_can_edit_final boolean,p_can_delete_data boolean)
returns void language plpgsql security definer set search_path=public,extensions
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.sub_admins set can_edit_final=p_can_edit_final,can_delete_data=p_can_delete_data where id=p_id returning name into v_name;
  if v_name is null then raise exception 'الحساب غير موجود'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'update_sub_admin_permissions','sub_admin',p_id::text,
      jsonb_build_object('name',v_name,'can_edit_final',p_can_edit_final,'can_delete_data',p_can_delete_data));
end $$;
grant execute on function public.admin_set_sub_admin_permissions(uuid,boolean,boolean) to authenticated;

-- sub_admin_login/sub_admin_resume تُعاد كتابتهما هون فقط لإضافة الحقلين الجديدين للكائن
-- المُرجَع للواجهة — الجسم الباقي مطابق حرفياً لآخر نسخة فعلية (single-session-login.sql
-- للدخول، sub-admins-and-committee-upgrade.sql للاستئناف).
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
  return jsonb_build_object('token',v_token,'admin',jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender,'can_edit_final',v_admin.can_edit_final,'can_delete_data',v_admin.can_delete_data));
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
  return jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender,'can_edit_final',v_admin.can_edit_final,'can_delete_data',v_admin.can_delete_data);
end $$;
grant execute on function public.sub_admin_resume(text) to anon,authenticated;

-- sub_admin_save_participants تُعاد كتابتها لإضافة فحصي can_edit_final/can_delete_data فقط
-- (بنفس منطق supervisor_save_state تماماً) — الجسم الباقي مطابق حرفياً لآخر نسخة فعلية
-- (admin-save-state-performance-fix.sql).
create or replace function public.sub_admin_save_participants(p_token text,p_participants jsonb,p_deleted_ids text[] default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_others jsonb; v_final jsonb; v_draws jsonb;
  v_incoming_participant_ids text[]; v_old_participants_by_id jsonb;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) item where item->>'gender'<>v_admin.gender) then
    raise exception 'لا يمكن إضافة أو تعديل متسابق من جنس مختلف عن صلاحية هذا الحساب';
  end if;
  if not v_admin.can_delete_data and cardinality(p_deleted_ids)>0 then
    raise exception 'حذف بيانات المتسابقين أو السحوبات يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب';
  end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  if not v_admin.can_edit_final and exists(
    select 1 from jsonb_array_elements(p_participants) n
    join jsonb_array_elements(coalesce(v_payload->'participants','[]')) old on old->>'id'=n->>'id'
    where old->>'scoreSource'='electronic' and coalesce(old->>'score','')<>coalesce(n->>'score','')
  ) then
    raise exception 'تعديل علامة معتمدة إلكترونيًا يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب';
  end if;

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(jsonb_object_agg(o->>'id',o),'{}'::jsonb) into v_old_participants_by_id
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o;

  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select n->>'id',n->>'name',now() from jsonb_array_elements(p_participants) n
  where not (
    (v_old_participants_by_id ? (n->>'id'))
    and coalesce(v_old_participants_by_id->(n->>'id')->>'gender','')=coalesce(n->>'gender','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'level','')=coalesce(n->>'level','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'levelName','')=coalesce(n->>'levelName','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'transferCommitteeId','')=coalesce(n->>'transferCommitteeId','')
    and coalesce(v_old_participants_by_id->(n->>'id')->'parts','[]'::jsonb)=coalesce(n->'parts','[]'::jsonb)
  );
  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select o->>'id',o->>'name',now() from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
  where o->>'id'=any(p_deleted_ids);

  select coalesce(jsonb_agg(item),'[]') into v_others
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where item->>'gender'<>v_admin.gender
     or (not (item->>'id'=any(p_deleted_ids)) and not (item->>'id'=any(v_incoming_participant_ids)));
  v_final=v_others||p_participants;
  v_payload=jsonb_set(v_payload,'{participants}',v_final,true);
  if cardinality(p_deleted_ids)>0 then
    select coalesce(jsonb_agg(item),'[]') into v_draws
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where not (item->>'participantId'=any(p_deleted_ids));
    v_payload=jsonb_set(v_payload,'{draws}',v_draws,true);
  end if;

  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'sub_admin_save_participants','participant','batch',
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,'gender',v_admin.gender,
        'count',jsonb_array_length(p_participants),'deleted_count',cardinality(p_deleted_ids)));
  return v_payload;
end $$;
grant execute on function public.sub_admin_save_participants(text,jsonb,text[]) to anon,authenticated;
