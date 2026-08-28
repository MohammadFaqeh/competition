-- يمنع تسجيل الدخول لنفس الحساب (نفس رمز/دور اللجنة، أو نفس حساب المسؤول الفرعي) من أكثر
-- من جهاز بنفس الوقت: عند نجاح تسجيل دخول جديد، تُحذف كل جلسات الدخول السابقة النشطة لنفس
-- الهوية فورًا (نفس الدور بالضبط للجان — رئيس لا يُسقط عضوًا والعكس)، فيفقد الجهاز القديم
-- صلاحيته عند أول استئناف/طلب لاحق (committee_resume/sub_admin_resume يرفعان استثناء
-- 'انتهت الجلسة'). نسخة كاملة (النسخة الأحدث لكل دالة) + سطر حذف واحد فقط قبل الإدراج،
-- بلا أي تعديل آخر. نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية (بعد
-- committee-score-visibility.sql).

create or replace function public.committee_login(p_login_code text,p_pin text)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_token text; v_role text;
begin
  select * into v_committee from public.committees where active=true and
    (lower(login_code)=lower(trim(p_login_code)) or lower(member_login_code)=lower(trim(p_login_code))) limit 1;

  if v_committee.id is not null and v_committee.locked_until is not null and v_committee.locked_until>now() then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
      values(null,'login_blocked','committee',v_committee.id::text,
        jsonb_build_object('login_code',upper(trim(p_login_code)),'locked_until',v_committee.locked_until));
    raise exception 'الحساب مقفل مؤقتاً بسبب محاولات دخول فاشلة متكررة. حاول لاحقاً بعد دقائق قليلة.';
  end if;

  if v_committee.id is not null and lower(v_committee.login_code)=lower(trim(p_login_code))
    and v_committee.pin_hash is not null and crypt(p_pin,v_committee.pin_hash)=v_committee.pin_hash then
    v_role='chairman';
  elsif v_committee.id is not null and v_committee.member_login_code is not null
    and lower(v_committee.member_login_code)=lower(trim(p_login_code))
    and v_committee.member_pin_hash is not null and crypt(p_pin,v_committee.member_pin_hash)=v_committee.member_pin_hash then
    v_role='member';
  else
    if v_committee.id is not null then
      update public.committees set
        failed_login_count=failed_login_count+1,
        locked_until=case when failed_login_count+1>=public.login_lockout_threshold()
          then now()+public.login_lockout_duration() else locked_until end
      where id=v_committee.id;
      insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
        values(null,'login_failed','committee',v_committee.id::text,
          jsonb_build_object('login_code',upper(trim(p_login_code))));
    end if;
    raise exception 'رمز اللجنة أو PIN غير صحيح';
  end if;

  update public.committees set failed_login_count=0,locked_until=null where id=v_committee.id;
  delete from public.committee_login_sessions where expires_at<=now();
  delete from public.committee_login_sessions where committee_id=v_committee.id and examiner_role=v_role;
  v_token=encode(gen_random_bytes(32),'hex');
  insert into public.committee_login_sessions(committee_id,token_hash,expires_at,examiner_role)
    values(v_committee.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '16 hours',v_role);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'login_success','committee',v_committee.id::text,jsonb_build_object('login_code',upper(trim(p_login_code)),'role',v_role));
  return jsonb_build_object('token',v_token,'committee',jsonb_build_object(
    'id',v_committee.id,'name',v_committee.name,'chairmanName',v_committee.chairman_name,'memberName',v_committee.member_name,
    'responsibleGender',v_committee.responsible_gender,'levelNames',v_committee.level_names,'levels',v_committee.levels,
    'active',v_committee.active,'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),
    'can_self_draw',v_committee.can_self_draw,'show_score',v_committee.show_score,'examiner_role',v_role));
end $$;
grant execute on function public.committee_login(text,text) to anon,authenticated;

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
  return jsonb_build_object('token',v_token,'admin',jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender));
end $$;
grant execute on function public.sub_admin_login(text,text) to anon,authenticated;
