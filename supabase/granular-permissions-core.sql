-- نظام صلاحيات موسَّع (JSONB) يحل تدريجياً محل أعمدة boolean الثابتة الحالية:
--   profiles/sub_admins: can_edit_final, can_delete_data, can_transfer_participant
--   committees:          can_edit_final, can_self_draw, show_score, show_stats_summary
-- الهدف: كتالوج صلاحيات موسَّع بلا تغيير أي سلوك حالي بواجهة المستخدم (v1 متوافقة 100% خلفياً).
--
-- التصميم (معتمد بعد مراجعة أمنية مزدوجة وموافقة صريحة على كل قرار):
--   • كيسان JSONB منفصلان يشتركان بجدول كتالوج واحد بعمود scope: profiles.permissions/
--     sub_admins.permissions (scope='staff') وcommittees.permissions (scope='committee').
--   • مفتاح "تعديل نتيجة معتمدة" له اسمان مختلفان تماماً بين النطاقين (can_edit_final للموظفين،
--     committee_can_edit_final للجان) عمداً — لمنع خلل نسخ/لصق يقرأ كيس الجدول الخطأ من المرور
--     بصمت عبر التحقق (نفس المفتاح بنطاقين مختلفين كان سيمر التحقق رغم الخطأ).
--   • صلاحية المنح محصورة بالإداري الرئيسي فقط (فحص ثابت بالكود current_user_role() IS DISTINCT
--     FROM 'admin')، عدا استثناء واحد صريح: مشرف المسابقة يقدر يعدّل 3 مفاتيح محددة فقط للجان
--     (بمصفوفة ثابتة بالكود، لا كتالوج) — تماماً صلاحياته الحالية اليوم، بلا توسعة ولا نقصان.
--   • لا توجد صلاحية "manage_permissions" بهذا الإصدار لأي أحد — المنح دالة صريحة بالكود فقط.
--   • الأعمدة القديمة الستة تبقى كما هي (غير محذوفة) بعد هذا الملف كشبكة أمان للتراجع — ملف
--     لاحق منفصل، بعد التحقق بالإنتاج، يحذفها. هذا مقصود، وليس سهواً.
--
-- كل الدوال أدناه المُعاد تعريفها منسوخة حرفياً (حقلاً حقلاً) من آخر نسخة فعلية موجودة فعلاً
-- بالمستودع اليوم (وليس من نسخة وسيطة قديمة) — تم تتبع ذلك عبر تاريخ Git لكل ملف/دالة:
--   sub_admin_login/sub_admin_resume/admin_set_sub_admin_permissions/admin_link_supervisor/
--   admin_list_supervisors/sub_admin_transfer_participant/supervisor_transfer_participant
--     ← participant-transfer-permission-toggle.sql (الأحدث لهذه الدوال السبع)
--   sub_admin_save_participants ← sub-admin-permissions-toggle.sql
--   supervisor_save_state ← admin-save-state-performance-fix.sql
--   committee_login/committee_resume ← committee-stats-summary-visibility.sql
--   committee_create_draw ← committee-self-draw-permission.sql
--   committee_save_session ← committee-finalize-race-guard.sql
--   admin_set_committee_final_edit ← security-fix-null-safe-admin-checks.sql (فحص NULL-safe)
--   supervisor_set_committee_final_edit/admin_set_committee_show_score/
--   supervisor_set_committee_show_score/admin_set_committee_show_stats_summary/
--   supervisor_set_committee_show_stats_summary/admin_set_committee_self_draw
--     ← ملفاتها الأصلية (نسخة وحيدة لكل منها، بلا إعادة تعريف لاحقة)
--   diwan_committee_save_session ← diwan-al-hifadh-core.sql
--   diwan_staff_actor ← diwan-sub-admin-supervisor-view.sql
--
-- تنبيه: diwan_staff_actor تقرأ can_delete_data/can_transfer_participant لكنهما غير مُطبَّقتين
-- فعلياً بأي مكان بديوان الحفاظ اليوم (تعليق صريح بالمستودع: صلاحية كاملة للموظفين بالديوان
-- بلا مفاتيح إضافية) — هذا الملف يغيّر مصدر القراءة فقط، بلا أي إضافة تطبيق فعلي جديد.
--
-- إضافة لاحقة بنفس الملف (نفس التغيير المنطقي الواحد): admin_save_committee_v3/
-- supervisor_save_committee (النسخة الأحدث فعلياً لكلتيهما: committee-edit-preserve-member-
-- session.sql، أحدث من security-fix-null-safe-admin-checks.sql وsupervisor-role.sql) لا تكتبان
-- أياً من الأعمدة الستة القديمة عند إنشاء لجنة جديدة، فتعتمدان على قيمة افتراضية العمود وحدها —
-- وعمود permissions الجديد يبدأ '{}'::jsonb بينما show_score/show_stats_summary القديمان
-- يبدآن true. لجنة جديدة بعد هذا الملف كانت ستُنشأ بعلامتها وإحصائيتها مخفيتين عنها بالغلط
-- (has_permission تفشل مغلقة للمفتاح الغائب). القسم الأخير أدناه يبذر القيمتين true فقط عند
-- الإنشاء (p_id is null)، بنفس نمط الدمج || المستخدم بكل هذا الملف — لا يمسّ أي لجنة موجودة
-- ولا أي عملية تعديل، ونفس شكل الإرجاع (uuid) بلا أي تغيير آخر بالدالتين.
--
-- نفّذ هذا الملف كاملاً مرة واحدة (begin/commit صريحان دفاعياً، رغم أن باقي ملفات هذا المستودع
-- تعتمد على التجميع الضمني لمحرر Supabase SQL — "ملف واحد = معاملة واحدة" غير مضمون بشكل مستقل).
-- قابل لإعادة التشغيل بأمان (كل التعديلات create or replace / add column if not exists، والتمهيد
-- الأولي محمي بشرط WHERE لا يطأ أي صلاحية مُنِحت فعلاً عبر الدوال الجديدة بين تشغيلتين).
-- نفّذه بعد كل ملفات supabase/*.sql الحالية.

begin;

-- ==========================================================================
-- 1) كتالوج الصلاحيات — جدول قراءة فقط، تحديثه عبر ملفات هجرة لاحقة فقط، لا عبر أي RPC.
-- ==========================================================================
create table if not exists public.permission_catalog(
  key text primary key,
  scope text not null check (scope in ('staff','committee')),
  label_ar text not null,
  created_at timestamptz not null default now()
);

alter table public.permission_catalog enable row level security;

drop policy if exists permission_catalog_read on public.permission_catalog;
create policy permission_catalog_read on public.permission_catalog for select to authenticated using (true);

grant select on public.permission_catalog to authenticated;

insert into public.permission_catalog(key,scope,label_ar) values
  ('can_edit_final','staff','تعديل نتائج معتمدة إلكترونيًا'),
  ('can_delete_data','staff','حذف متسابقين/سحوبات'),
  ('can_transfer_participant','staff','نقل متسابقين بين اللجان'),
  ('committee_can_edit_final','committee','صلاحية تعديل النتائج المعتمدة'),
  ('can_self_draw','committee','صلاحية السحب للمتسابقين غير المسجَّلين'),
  ('show_score','committee','إظهار العلامة للجنة بعد الاعتماد'),
  ('show_stats_summary','committee','إظهار بطاقة الإحصائية للجنة')
on conflict (key) do nothing;

-- ==========================================================================
-- 2) أعمدة الصلاحيات الموسَّعة الجديدة + تمهيد من الأعمدة القديمة (بلا حذفها).
-- ==========================================================================
alter table public.profiles add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.sub_admins add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.committees add column if not exists permissions jsonb not null default '{}'::jsonb;

update public.profiles set permissions=jsonb_build_object(
  'can_edit_final',coalesce(can_edit_final,false),
  'can_delete_data',coalesce(can_delete_data,false),
  'can_transfer_participant',coalesce(can_transfer_participant,false)
) where permissions='{}'::jsonb;

update public.sub_admins set permissions=jsonb_build_object(
  'can_edit_final',coalesce(can_edit_final,false),
  'can_delete_data',coalesce(can_delete_data,false),
  'can_transfer_participant',coalesce(can_transfer_participant,false)
) where permissions='{}'::jsonb;

update public.committees set permissions=jsonb_build_object(
  'committee_can_edit_final',coalesce(can_edit_final,false),
  'can_self_draw',coalesce(can_self_draw,false),
  'show_score',coalesce(show_score,true),
  'show_stats_summary',coalesce(show_stats_summary,true)
) where permissions='{}'::jsonb;

-- ==========================================================================
-- 3) دالة القراءة الموحّدة — fail-closed: كيس NULL، مفتاح غائب، أو قيمة JSON null كلها false.
-- ==========================================================================
create or replace function public.has_permission(p_bag jsonb,p_key text)
returns boolean language sql immutable
as $$ select coalesce(p_bag->>p_key,'false')::boolean $$;

revoke execute on function public.has_permission(jsonb,text) from public,anon;
grant execute on function public.has_permission(jsonb,text) to authenticated;

-- ==========================================================================
-- 4) دوال المنح الموحَّدة الجديدة — الإداري الرئيسي فقط، عدا الثالثة (مشرف المسابقة بمصفوفة
--    ثابتة محدودة). لا توجد صلاحية "manage_permissions" لأي أحد بهذا الإصدار.
-- ==========================================================================
create or replace function public.admin_set_staff_permissions(p_subject_type text,p_subject_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_key text; v_value jsonb; v_name text; v_permissions jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if p_subject_type not in ('profile','sub_admin') then raise exception 'نوع الحساب غير صالح'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'صيغة الصلاحيات المرسلة غير صالحة'; end if;

  for v_key,v_value in select key,value from jsonb_each(p_patch) loop
    if not exists(select 1 from public.permission_catalog where key=v_key and scope='staff') then
      raise exception 'مفتاح صلاحية غير معروف: %',v_key;
    end if;
    if jsonb_typeof(v_value)<>'boolean' then
      raise exception 'قيمة الصلاحية % يجب أن تكون true أو false',v_key;
    end if;
  end loop;

  if p_subject_type='profile' then
    update public.profiles set permissions=coalesce(permissions,'{}'::jsonb)||p_patch where id=p_subject_id
      returning display_name,permissions into v_name,v_permissions;
  else
    update public.sub_admins set permissions=coalesce(permissions,'{}'::jsonb)||p_patch where id=p_subject_id
      returning name,permissions into v_name,v_permissions;
  end if;
  if v_name is null then raise exception 'الحساب غير موجود'; end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'update_staff_permissions',
      case when p_subject_type='profile' then 'supervisor' else 'sub_admin' end,
      p_subject_id::text,jsonb_build_object('name',v_name,'patch',p_patch));
  return v_permissions;
end $$;
revoke execute on function public.admin_set_staff_permissions(text,uuid,jsonb) from public,anon;
grant execute on function public.admin_set_staff_permissions(text,uuid,jsonb) to authenticated;

create or replace function public.admin_set_committee_permissions(p_committee_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_key text; v_value jsonb; v_name text; v_permissions jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'صيغة الصلاحيات المرسلة غير صالحة'; end if;

  for v_key,v_value in select key,value from jsonb_each(p_patch) loop
    if not exists(select 1 from public.permission_catalog where key=v_key and scope='committee') then
      raise exception 'مفتاح صلاحية غير معروف: %',v_key;
    end if;
    if jsonb_typeof(v_value)<>'boolean' then
      raise exception 'قيمة الصلاحية % يجب أن تكون true أو false',v_key;
    end if;
  end loop;

  update public.committees set permissions=coalesce(permissions,'{}'::jsonb)||p_patch where id=p_committee_id
    returning name,permissions into v_name,v_permissions;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'update_committee_permissions','committee',p_committee_id::text,
      jsonb_build_object('committee_name',v_name,'patch',p_patch));
  return v_permissions;
end $$;
revoke execute on function public.admin_set_committee_permissions(uuid,jsonb) from public,anon;
grant execute on function public.admin_set_committee_permissions(uuid,jsonb) to authenticated;

create or replace function public.supervisor_set_committee_permissions(p_committee_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare
  -- هذه المصفوفة الثابتة يجب ألا تشمل أبداً can_self_draw أو أي صلاحية مستقبلية يُقصَد أن تبقى
  -- بيد الإداري الرئيسي فقط — لا تُستبدل هذه القائمة بقراءة ديناميكية من permission_catalog.
  v_allowed_keys text[] := array['committee_can_edit_final','show_score','show_stats_summary'];
  v_key text; v_value jsonb; v_name text; v_supervisor_name text; v_permissions jsonb;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'صيغة الصلاحيات المرسلة غير صالحة'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();

  for v_key,v_value in select key,value from jsonb_each(p_patch) loop
    if not (v_key=any(v_allowed_keys)) then
      raise exception 'لا صلاحية لمشرف المسابقة على تعديل: %',v_key;
    end if;
    if jsonb_typeof(v_value)<>'boolean' then
      raise exception 'قيمة الصلاحية % يجب أن تكون true أو false',v_key;
    end if;
  end loop;

  update public.committees set permissions=coalesce(permissions,'{}'::jsonb)||p_patch where id=p_committee_id
    returning name,permissions into v_name,v_permissions;
  if v_name is null then raise exception 'اللجنة غير موجودة'; end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'update_committee_permissions','committee',p_committee_id::text,
      jsonb_build_object('committee_name',v_name,'patch',p_patch,'supervisor_name',v_supervisor_name));
  return v_permissions;
end $$;
revoke execute on function public.supervisor_set_committee_permissions(uuid,jsonb) from public,anon;
grant execute on function public.supervisor_set_committee_permissions(uuid,jsonb) to authenticated;

-- ==========================================================================
-- 5) إعادة تعريف كل دالة تقرأ حالياً أحد الأعمدة الستة القديمة مباشرة — نفس شكل الإرجاع
--    والحقول المسطَّحة تماماً كما كانت (بلا أي تغيير بعقد الواجهة الأمامية)، فقط تغيير مصدر
--    القراءة إلى has_permission(permissions, 'المفتاح'). الجسم الباقي حرفياً كآخر نسخة فعلية.
-- ==========================================================================

-- -- المسؤول الفرعي -----------------------------------------------------------
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
  return jsonb_build_object('token',v_token,'admin',jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender,
    'can_edit_final',public.has_permission(v_admin.permissions,'can_edit_final'),
    'can_delete_data',public.has_permission(v_admin.permissions,'can_delete_data'),
    'can_transfer_participant',public.has_permission(v_admin.permissions,'can_transfer_participant')));
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
  return jsonb_build_object('id',v_admin.id,'name',v_admin.name,'gender',v_admin.gender,
    'can_edit_final',public.has_permission(v_admin.permissions,'can_edit_final'),
    'can_delete_data',public.has_permission(v_admin.permissions,'can_delete_data'),
    'can_transfer_participant',public.has_permission(v_admin.permissions,'can_transfer_participant'));
end $$;
grant execute on function public.sub_admin_resume(text) to anon,authenticated;

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
  if not public.has_permission(v_admin.permissions,'can_delete_data') and cardinality(p_deleted_ids)>0 then
    raise exception 'حذف بيانات المتسابقين أو السحوبات يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب';
  end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  if not public.has_permission(v_admin.permissions,'can_edit_final') and exists(
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

create or replace function public.sub_admin_transfer_participant(p_token text,p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participant jsonb; v_to_name text; v_to_gender text; v_from_name text; v_session public.exam_sessions; v_from_committee_id uuid;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  if not public.has_permission(v_admin.permissions,'can_transfer_participant') then raise exception 'نقل المتسابقين بين اللجان يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب'; end if;
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

-- -- مشرف المسابقة -------------------------------------------------------------
create or replace function public.supervisor_save_state(
  p_participants jsonb,p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',p_deleted_draw_ids text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_can_edit_final boolean; v_can_delete_data boolean; v_payload jsonb; v_others_participants jsonb; v_others_draws jsonb; v_final_participants jsonb; v_final_draws jsonb;
  v_incoming_participant_ids text[]; v_incoming_draw_ids text[]; v_old_participants_by_id jsonb;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select public.has_permission(permissions,'can_edit_final'),public.has_permission(permissions,'can_delete_data')
    into v_can_edit_final,v_can_delete_data from public.profiles where id=auth.uid();

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

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_draw_ids from jsonb_array_elements(p_draws) n;
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
  where o->>'id'=any(p_deleted_participant_ids);

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

  v_payload=jsonb_set(v_payload,'{participants}',v_final_participants,true);
  v_payload=jsonb_set(v_payload,'{draws}',v_final_draws,true);

  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return jsonb_build_object('participants',v_final_participants,'draws',v_final_draws);
end $$;
grant execute on function public.supervisor_save_state(jsonb,jsonb,text[],text[]) to authenticated;

create or replace function public.supervisor_transfer_participant(p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_supervisor_name text; v_can_transfer boolean; v_payload jsonb; v_participant jsonb; v_to_name text; v_from_name text; v_session public.exam_sessions; v_from_committee_id uuid;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name,public.has_permission(permissions,'can_transfer_participant') into v_supervisor_name,v_can_transfer from public.profiles where id=auth.uid();
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
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'transfer_participant','participant',p_participant_id,
      jsonb_build_object('participant_name',v_participant->>'name','to_committee_id',p_committee_id,
        'to_committee_name',v_to_name,'from_committee_name',v_from_name,'supervisor_name',v_supervisor_name));
  perform public.record_transfer_notifications(p_participant_id,v_participant->>'name',v_from_committee_id,p_committee_id);
  return v_payload;
end $$;
grant execute on function public.supervisor_transfer_participant(text,uuid) to authenticated;

-- -- اللجان (السنوية) -----------------------------------------------------------
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
    'active',v_committee.active,'can_edit_final',(public.has_permission(v_committee.permissions,'committee_can_edit_final') and v_role='chairman'),
    'can_self_draw',public.has_permission(v_committee.permissions,'can_self_draw'),
    'show_score',public.has_permission(v_committee.permissions,'show_score'),
    'show_stats_summary',public.has_permission(v_committee.permissions,'show_stats_summary'),'examiner_role',v_role));
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
    'active',v_committee.active,'can_edit_final',(public.has_permission(v_committee.permissions,'committee_can_edit_final') and v_role='chairman'),
    'can_self_draw',public.has_permission(v_committee.permissions,'can_self_draw'),
    'show_score',public.has_permission(v_committee.permissions,'show_score'),
    'show_stats_summary',public.has_permission(v_committee.permissions,'show_stats_summary'),'examiner_role',v_role);
end $$;
grant execute on function public.committee_resume(text) to anon,authenticated;

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
  if not public.has_permission(v_committee.permissions,'can_self_draw') then
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
  if (v_session.status='final' or v_session.is_final_revision) and not public.has_permission(v_committee.permissions,'committee_can_edit_final') then raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة'; end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then raise exception 'العلامة النهائية غير صالحة'; end if;
  if v_session.status='final' and p_status='in_progress' and coalesce(p_assessment->'revisions'->-1->>'type','')<>'reopened-final' then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
      'ignored_stale_draft_after_final','participant',v_session.participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
        'examiner_role',v_role,'session_id',v_session.id));
    return v_session;
  end if;
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
grant execute on function public.committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;

-- -- ديوان الحفاظ ----------------------------------------------------------------
create or replace function public.diwan_committee_save_session(
  p_token text,p_session_id uuid,p_assessment jsonb,p_status text,p_score numeric
) returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.diwan_exam_sessions; v_role text; v_saved jsonb; v_old_status text; v_was_revision boolean;
begin
  v_committee=public.committee_from_token(p_token);v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_status not in ('in_progress','final') then raise exception 'حالة التقييم غير صالحة'; end if;
  select * into v_session from public.diwan_exam_sessions where id=p_session_id and committee_id=v_committee.id for update;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة أو ألغتها الإدارة'; end if;
  v_old_status=v_session.status;v_was_revision=v_session.is_final_revision;
  if p_status='final' and v_role<>'chairman' then raise exception 'اعتماد النتيجة متاح لرئيس اللجنة فقط'; end if;
  if v_session.status='final' and p_status='in_progress' and v_role<>'chairman' then raise exception 'إعادة فتح النتيجة متاحة لرئيس اللجنة فقط'; end if;
  if (v_session.status='final' or v_session.is_final_revision) and not public.has_permission(v_committee.permissions,'committee_can_edit_final') then raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة'; end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then raise exception 'العلامة النهائية غير صالحة'; end if;
  if v_session.status='final' and p_status='in_progress' and coalesce(p_assessment->'revisions'->-1->>'type','')<>'reopened-final' then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
      'ignored_stale_diwan_draft_after_final','participant',v_session.participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
        'examiner_role',v_role,'session_id',v_session.id));
    return v_session;
  end if;
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
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
    case when v_old_status='final' and p_status='in_progress' then 'reopen_diwan_final_result'
      when v_was_revision and p_status='final' then 'revise_diwan_final_result'
      when p_status='final' then 'finalize_diwan' else 'save_diwan_examiner_draft' end,
    'participant',v_session.participant_id,jsonb_build_object('committee_id',v_committee.id,
      'committee_name',v_committee.name,'examiner_role',v_role,'session_id',v_session.id,
      'new_score',p_score,'assessment',p_assessment));
  return v_session;
end $$;
grant execute on function public.diwan_committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;

create or replace function public.diwan_staff_actor(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions
as $$
declare v_profile public.profiles; v_admin public.sub_admins;
begin
  select * into v_profile from public.profiles where id=auth.uid();
  if v_profile.role='supervisor' then
    return jsonb_build_object('gender','*','can_delete',public.has_permission(v_profile.permissions,'can_delete_data'),
      'can_transfer',public.has_permission(v_profile.permissions,'can_transfer_participant'),'label','مشرف المسابقة: '||coalesce(v_profile.display_name,''));
  end if;
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  return jsonb_build_object('gender',v_admin.gender,'can_delete',public.has_permission(v_admin.permissions,'can_delete_data'),
    'can_transfer',public.has_permission(v_admin.permissions,'can_transfer_participant'),'label','مسؤول فرعي: '||coalesce(v_admin.name,''));
end $$;
revoke execute on function public.diwan_staff_actor(text) from public,anon,authenticated;

-- ==========================================================================
-- 6) دوال المنح القديمة تصير أغلفة رفيعة تستدعي الدوال الموحَّدة الجديدة داخلياً — تبقى بنفس
--    التوقيع والقيمة المُرجَعة تماماً حتى لا يحتاج cloud.js أي تعديل بهذا الإصدار.
-- ==========================================================================
create or replace function public.admin_set_sub_admin_permissions(
  p_id uuid,p_can_edit_final boolean,p_can_delete_data boolean,p_can_transfer_participant boolean default false
)
returns void language plpgsql security definer set search_path=public,extensions
as $$
begin
  perform public.admin_set_staff_permissions('sub_admin',p_id,jsonb_build_object(
    'can_edit_final',p_can_edit_final,'can_delete_data',p_can_delete_data,'can_transfer_participant',p_can_transfer_participant));
end $$;
grant execute on function public.admin_set_sub_admin_permissions(uuid,boolean,boolean,boolean) to authenticated;

-- admin_link_supervisor تبقى دالة كاملة (تُنشئ/تُحدّث صف profiles نفسه، لا مجرد صلاحيات)، لكن
-- جزء ضبط الصلاحيات بداخلها يستدعي admin_set_staff_permissions الآن بدل كتابة الأعمدة القديمة.
create or replace function public.admin_link_supervisor(
  p_user_id uuid,p_name text,p_can_edit_final boolean default false,p_can_delete_data boolean default false,
  p_can_transfer_participant boolean default false
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if p_user_id is null then raise exception 'أدخل معرّف المستخدم (UID) من لوحة Supabase'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم المشرف مطلوب'; end if;
  insert into public.profiles(id,role,display_name)
  values(p_user_id,'supervisor',trim(p_name))
  on conflict(id) do update set role='supervisor',display_name=excluded.display_name;
  perform public.admin_set_staff_permissions('profile',p_user_id,jsonb_build_object(
    'can_edit_final',p_can_edit_final,'can_delete_data',p_can_delete_data,'can_transfer_participant',p_can_transfer_participant));
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
  return query select p.id,p.display_name,
    public.has_permission(p.permissions,'can_edit_final'),
    public.has_permission(p.permissions,'can_delete_data'),
    public.has_permission(p.permissions,'can_transfer_participant'),
    p.created_at
    from public.profiles p where p.role='supervisor' order by p.created_at;
end $$;
grant execute on function public.admin_list_supervisors() to authenticated;

create or replace function public.admin_set_committee_final_edit(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  perform public.admin_set_committee_permissions(p_committee_id,jsonb_build_object('committee_can_edit_final',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.admin_set_committee_final_edit(uuid,boolean) to authenticated;

create or replace function public.admin_set_committee_self_draw(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  perform public.admin_set_committee_permissions(p_committee_id,jsonb_build_object('can_self_draw',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.admin_set_committee_self_draw(uuid,boolean) to authenticated;

create or replace function public.admin_set_committee_show_score(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  perform public.admin_set_committee_permissions(p_committee_id,jsonb_build_object('show_score',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.admin_set_committee_show_score(uuid,boolean) to authenticated;

create or replace function public.admin_set_committee_show_stats_summary(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  perform public.admin_set_committee_permissions(p_committee_id,jsonb_build_object('show_stats_summary',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.admin_set_committee_show_stats_summary(uuid,boolean) to authenticated;

create or replace function public.supervisor_set_committee_final_edit(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
begin
  perform public.supervisor_set_committee_permissions(p_committee_id,jsonb_build_object('committee_can_edit_final',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.supervisor_set_committee_final_edit(uuid,boolean) to authenticated;

create or replace function public.supervisor_set_committee_show_score(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
begin
  perform public.supervisor_set_committee_permissions(p_committee_id,jsonb_build_object('show_score',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.supervisor_set_committee_show_score(uuid,boolean) to authenticated;

create or replace function public.supervisor_set_committee_show_stats_summary(p_committee_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
begin
  perform public.supervisor_set_committee_permissions(p_committee_id,jsonb_build_object('show_stats_summary',p_enabled));
  return p_enabled;
end $$;
grant execute on function public.supervisor_set_committee_show_stats_summary(uuid,boolean) to authenticated;

-- ==========================================================================
-- 7) لجنة جديدة تبقى بعلامتها وبطاقة إحصائيتها ظاهرتين افتراضياً (كما كانت دائماً) — تبذر
--    show_score/show_stats_summary=true بكيس permissions عند الإنشاء فقط (p_id is null)، لا عند
--    التعديل. الجسم الباقي حرفياً كآخر نسخة فعلية (committee-edit-preserve-member-session.sql)،
--    ونفس شكل الإرجاع (uuid) تماماً.
-- ==========================================================================
create or replace function public.admin_save_committee_v3(
  p_id uuid,p_name text,
  p_chairman_name text,p_chairman_code text,p_chairman_pin text,
  p_member_name text,p_member_code text,p_member_pin text,
  p_responsible_gender text,p_level_names text[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_levels smallint[]; v_old_member_code text; v_member_credentials_changed boolean;
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

  if p_id is not null then
    select member_login_code into v_old_member_code from public.committees where id=p_id;
  end if;

  if p_id is null then
    insert into public.committees(name,chairman_name,login_code,pin_hash,member_name,member_login_code,member_pin_hash,
      responsible_gender,level_names,levels,active)
    values(trim(p_name),trim(p_chairman_name),upper(trim(p_chairman_code)),crypt(p_chairman_pin,gen_salt('bf')),
      nullif(trim(p_member_name),''),upper(nullif(trim(p_member_code),'')),
      case when nullif(trim(p_member_code),'') is not null then crypt(p_member_pin,gen_salt('bf')) end,
      p_responsible_gender,p_level_names,v_levels,p_active) returning id into v_id;
    update public.committees set permissions=coalesce(permissions,'{}'::jsonb)||jsonb_build_object('show_score',true,'show_stats_summary',true) where id=v_id;
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

  v_member_credentials_changed=(p_id is null)
    or (coalesce(v_old_member_code,'') is distinct from coalesce(upper(nullif(trim(p_member_code),'')),''))
    or (nullif(trim(p_member_code),'') is not null and length(coalesce(p_member_pin,''))>=4);
  delete from public.committee_login_sessions where committee_id=v_id and p_id is null;
  if v_member_credentials_changed then
    delete from public.committee_login_sessions where committee_id=v_id and examiner_role='member';
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_id is null then 'create_committee' else 'update_committee' end,
      'committee',v_id::text,jsonb_build_object('name',trim(p_name),'responsible_gender',p_responsible_gender,'level_names',p_level_names));
  return v_id;
exception when unique_violation then
  raise exception 'رمز اللجنة مستخدم من لجنة أخرى';
end $$;
grant execute on function public.admin_save_committee_v3(uuid,text,text,text,text,text,text,text,text,text[],boolean) to authenticated;

create or replace function public.supervisor_save_committee(
  p_id uuid,p_name text,
  p_chairman_name text,p_chairman_code text,p_chairman_pin text,
  p_member_name text,p_member_code text,p_member_pin text,
  p_responsible_gender text,p_level_names text[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_levels smallint[]; v_name text; v_old_member_code text; v_member_credentials_changed boolean;
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

  if p_id is not null then
    select member_login_code into v_old_member_code from public.committees where id=p_id;
  end if;

  if p_id is null then
    insert into public.committees(name,chairman_name,login_code,pin_hash,member_name,member_login_code,member_pin_hash,
      responsible_gender,level_names,levels,active)
    values(trim(p_name),trim(p_chairman_name),upper(trim(p_chairman_code)),crypt(p_chairman_pin,gen_salt('bf')),
      nullif(trim(p_member_name),''),upper(nullif(trim(p_member_code),'')),
      case when nullif(trim(p_member_code),'') is not null then crypt(p_member_pin,gen_salt('bf')) end,
      p_responsible_gender,p_level_names,v_levels,p_active) returning id into v_id;
    update public.committees set permissions=coalesce(permissions,'{}'::jsonb)||jsonb_build_object('show_score',true,'show_stats_summary',true) where id=v_id;
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

  v_member_credentials_changed=(p_id is null)
    or (coalesce(v_old_member_code,'') is distinct from coalesce(upper(nullif(trim(p_member_code),'')),''))
    or (nullif(trim(p_member_code),'') is not null and length(coalesce(p_member_pin,''))>=4);
  delete from public.committee_login_sessions where committee_id=v_id and p_id is null;
  if v_member_credentials_changed then
    delete from public.committee_login_sessions where committee_id=v_id and examiner_role='member';
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_id is null then 'create_committee' else 'update_committee' end,
      'committee',v_id::text,jsonb_build_object('name',trim(p_name),'responsible_gender',p_responsible_gender,'level_names',p_level_names,'supervisor_name',v_name));
  return v_id;
exception when unique_violation then
  raise exception 'رمز اللجنة مستخدم من لجنة أخرى';
end $$;
grant execute on function public.supervisor_save_committee(uuid,text,text,text,text,text,text,text,text,text[],boolean) to authenticated;

commit;
