-- يمنح الإدارة الرئيسية القدرة على تفعيل/تعطيل سحب اللجان لكل لجنة على حدة (بدل المنع
-- القاطع النهائي في committee-live-draw.sql)، لكن فقط للمتسابقين الذين لم تُسجَّل أجزاؤهم
-- بعد (وصلت بياناتهم بدون أجزاء وتحتاج تسجيلاً يدويًا قبل السحب). أي متسابق مسجَّلة أجزاؤه
-- مسبقًا يبقى السحب له محصورًا بالإدارة/المسؤول الفرعي كما هو الآن، حتى لو كانت اللجنة مفعَّلة.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية (بعد committee-claim-transferred-level.sql).

alter table public.committees add column if not exists can_self_draw boolean not null default false;

-- نسخة معدَّلة من committee_create_draw (كانت معطَّلة نهائيًا في committee-live-draw.sql):
-- تحقق can_self_draw بدل raise exception غير المشروط، وتضيف شرط عدم وجود أجزاء مسجَّلة
-- مسبقًا للمتسابق. بقية المنطق (تحديث الأجزاء، إدراج السحب والجلسة، سجل النشاط) كما هو
-- بالضبط من النسخة الأصلية.
create or replace function public.committee_create_draw(
  p_token text,
  p_participant_id text,
  p_level smallint,
  p_parts smallint[],
  p_draw jsonb,
  p_change_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_committee public.committees;
  v_payload jsonb;
  v_participant jsonb;
  v_existing jsonb;
  v_owner text;
  v_session public.exam_sessions;
  v_sequence integer;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if not v_committee.can_self_draw then
    raise exception 'هذه اللجنة لا تملك صلاحية السحب حاليًا؛ راجع الإدارة';
  end if;
  if not (p_level=any(v_committee.levels)) then raise exception 'هذا المستوى غير مخصص لهذه اللجنة'; end if;
  if cardinality(p_parts)<>p_level or exists(select 1 from unnest(p_parts) n where n<1 or n>30) then
    raise exception 'الأجزاء المشاركة غير مكتملة أو غير صالحة';
  end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if (v_participant->>'level')::smallint<>p_level then
    raise exception 'مستوى المتسابق تغيّر؛ حدّث قائمة اللجنة ثم أعد المحاولة';
  end if;
  if jsonb_array_length(coalesce(v_participant->'parts','[]'::jsonb))>0 then
    raise exception 'أجزاء هذا المتسابق مسجَّلة مسبقًا؛ السحب له من صلاحية الإدارة أو المسؤول الفرعي فقط';
  end if;
  select item into v_existing from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where item->>'participantId'=p_participant_id limit 1;
  if v_existing is not null then
    select c.name into v_owner from public.exam_sessions s join public.committees c on c.id=s.committee_id
      where s.participant_id=p_participant_id;
    raise exception 'تم السحب لهذا المتسابق مسبقاً بواسطة %',coalesce(v_owner,'الإدارة');
  end if;

  if coalesce((v_participant->'parts')::text,'[]')<>to_jsonb(p_parts)::text then
    v_payload=jsonb_set(v_payload,'{participants}',(
      select jsonb_agg(case when item->>'id'=p_participant_id then jsonb_set(item,'{parts}',to_jsonb(p_parts),true) else item end)
      from jsonb_array_elements(v_payload->'participants') item),true);
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
      values(null,'committee_change_parts','participant',p_participant_id,
        jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
          'old_parts',v_participant->'parts','new_parts',to_jsonb(p_parts),'reason',p_change_reason));
  end if;

  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]'::jsonb)||jsonb_build_array(p_draw),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.exam_sessions(participant_id,draw_id,committee_id,level)
    values(p_participant_id,p_draw->>'id',v_committee.id,p_level) returning * into v_session;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'committee_draw','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,'draw_id',p_draw->>'id'));
  return jsonb_build_object('draw',p_draw,'session',to_jsonb(v_session),'committee',to_jsonb(v_committee));
exception when unique_violation then
  select c.name into v_owner from public.exam_sessions s join public.committees c on c.id=s.committee_id
    where s.participant_id=p_participant_id;
  raise exception 'يتم اختبار هذا المتسابق الآن بواسطة لجنة %',coalesce(v_owner,'أخرى');
end $$;
grant execute on function public.committee_create_draw(text,text,smallint,smallint[],jsonb,text) to anon,authenticated;

-- تفعيل/تعطيل صلاحية السحب لكل لجنة — الإدارة الرئيسية فقط (نفس نمط
-- admin_set_committee_final_edit في security-fix-null-safe-admin-checks.sql).
create or replace function public.admin_set_committee_self_draw(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  update public.committees set can_self_draw=p_enabled where id=p_committee_id returning name into v_name;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),case when p_enabled then 'grant_self_draw' else 'revoke_self_draw' end,
    'committee',p_committee_id::text,jsonb_build_object('committee_name',v_name,'enabled',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.admin_set_committee_self_draw(uuid,boolean) to authenticated;

-- إظهار can_self_draw للجنة نفسها عند الدخول/الاستئناف (تحتاجها الواجهة لعرض فورم تسجيل
-- الأجزاء وتنفيذ السحب). نسخة مطابقة تمامًا لآخر نسخة من هاتين الدالتين
-- (login-rate-limit-and-audit.sql) مع إضافة الحقل الجديد فقط بلا أي تعديل آخر.
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
    'can_self_draw',v_committee.can_self_draw,'examiner_role',v_role));
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
    'can_self_draw',v_committee.can_self_draw,'examiner_role',v_role);
end $$;
grant execute on function public.committee_resume(text) to anon,authenticated;

-- committee_load_state يُظهر للجنة فقط سحوبات متسابقيها هي (مصفّاة حسب المستوى)، فلا تكفي
-- لحساب "المواضع المستخدمة فعليًا" بشكل صحيح عند السحب الذاتي — قد تتكرر صفحة استخدمتها
-- لجنة أخرى بمستوى مختلف. هذه الدالة تُرجع فقط أرقام تعريف كل المواضع المستخدمة حاليًا في
-- كامل الدورة (بلا أي بيانات متسابقين) من الحمولة الكاملة غير المصفّاة، ليبني عليها العميل
-- حساب "الأجزاء المتاحة" بشكل صحيح قبل استدعاء committee_create_draw.
create or replace function public.committee_used_position_ids(p_token text)
returns text[] language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_ids text[];
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  select coalesce(array_agg(pos->>'id'),'{}') into v_ids
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) d,
         jsonb_array_elements(coalesce(d->'positions','[]')) pos;
  return v_ids;
end $$;
grant execute on function public.committee_used_position_ids(text) to anon,authenticated;
