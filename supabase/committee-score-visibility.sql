-- يمنح الإدارة الرئيسية ومشرف المسابقة القدرة على إخفاء/إظهار العلامة النهائية عن كل لجنة
-- اختبار على حدة بعد اعتماد التقييم (نفس نمط can_edit_final / can_self_draw بالضبط:
-- عمود على committees + دالة admin_... ودالة supervisor_... منفصلتان لكل منهما).
-- الإخفاء لا يمنع اللجنة من إجراء التقييم أو رؤية العلامة أثناء المراجعة قبل الاعتماد؛
-- فقط يخفي العلامة النهائية المعروضة لها بعد الاعتماد (بطاقة "تم اعتماد النتيجة" وشاشة
-- "نتيجة معتمدة" وقائمة متسابقي اللجنة). الإدارة ومشرف المسابقة يريان العلامة دائماً.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية (بعد committee-transfer-notifications.sql).

alter table public.committees add column if not exists show_score boolean not null default true;

create or replace function public.admin_set_committee_show_score(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.committees set show_score=p_enabled where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),case when p_enabled then 'show_committee_score' else 'hide_committee_score' end,
    'committee',p_committee_id::text,jsonb_build_object('committee_name',v_name,'enabled',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.admin_set_committee_show_score(uuid,boolean) to authenticated;

create or replace function public.supervisor_set_committee_show_score(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
declare v_name text; v_supervisor_name text;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();
  update public.committees set show_score=p_enabled where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_enabled then 'show_committee_score' else 'hide_committee_score' end,
      'committee',p_committee_id::text,jsonb_build_object('committee_name',v_name,'enabled',p_enabled,'supervisor_name',v_supervisor_name));
  return p_enabled;
end $$;
grant execute on function public.supervisor_set_committee_show_score(uuid,boolean) to authenticated;

-- إظهار show_score للجنة نفسها عند الدخول/الاستئناف. نسخة مطابقة تمامًا لآخر نسخة من
-- هاتين الدالتين (committee-self-draw-permission.sql) مع إضافة الحقل الجديد فقط بلا أي تعديل آخر.
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
    'active',v_committee.active,'can_edit_final',(v_committee.can_edit_final and v_role='chairman'),
    'can_self_draw',v_committee.can_self_draw,'show_score',v_committee.show_score,'examiner_role',v_role);
end $$;
grant execute on function public.committee_resume(text) to anon,authenticated;
