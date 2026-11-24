-- ==========================================================================
-- «القسم» لكل حساب (قرار الإدارة 2026-11-24): الاثنين / ديوان الحفاظ فقط / المسابقة السنوية فقط
-- للجان (الرئيس والعضو معاً) والمسؤولين الفرعيين ومشرف المسابقة. المدير الرئيسي يدخل القسمين دائماً.
--
-- مبدأ الأمان: كل الحسابات الحالية تبدأ على 'both' ⇒ تشغيل هذا الملف لا يغيّر سلوك أي حساب إطلاقاً
-- إلى أن تقيّد الإدارة حساباً بعينه. والتقييد يُفرض بالخادم نفسه (لا بالواجهة):
--   • اللجان والمسؤولون الفرعيون: داخل دوال التحقق المركزية committee_from_token / committee_role_from_token /
--     sub_admin_from_token التي تمر بها كل دوالهم، بحسب قسم الدالة المستدعية (caller_section):
--     دوال diwan_* = 'diwan'، دوال الحساب المشتركة (دخول/خروج/استئناف/تنبيهات/بلاغات/إدارة اللجان) = 'shared'،
--     وأي دالة أخرى = 'annual'.
--   • مشرف المسابقة: current_user_role() ترجع null للمشرف المقيَّد داخل دوال القسم الآخر، وdiwan_staff_actor
--     ترفضه بالديوان إن كان «سنوية فقط»، وسياسات القراءة المباشرة لجداول البيانات الأربعة تفحص قسمه صراحة.
-- بعد المراجعة الأمنية: المشرف المقيَّد تُرجع له current_user_role() القيمة 'restricted' (لا null) داخل دوال القسم الآخر،
-- فتُرفض حتى بأي فحص قديم غير آمن مع null (مثل <>'admin')؛ ولا يستطيع المشرف المقيَّد إنشاء/تعديل/حذف لجان أو مسؤولين
-- فرعيين (حارس على الجدولين) كي لا يمنح حساباً «الاثنين» يتجاوز به تقييده.
-- يُشغَّل بعد كل الملفات السابقة (آخرها granular-permissions-core.sql). آمن لإعادة التشغيل.
-- ==========================================================================

-- 1) الأعمدة: القيمة الافتراضية 'both' لكل الحسابات الحالية والجديدة.
alter table public.committees add column if not exists sections text not null default 'both';
alter table public.sub_admins add column if not exists sections text not null default 'both';
alter table public.profiles   add column if not exists sections text not null default 'both';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='committees_sections_check') then
    alter table public.committees add constraint committees_sections_check check (sections in ('both','annual','diwan')); end if;
  if not exists (select 1 from pg_constraint where conname='sub_admins_sections_check') then
    alter table public.sub_admins add constraint sub_admins_sections_check check (sections in ('both','annual','diwan')); end if;
  if not exists (select 1 from pg_constraint where conname='profiles_sections_check') then
    alter table public.profiles add constraint profiles_sections_check check (sections in ('both','annual','diwan')); end if;
end $$;

-- 2) هل يسمح قسم الحساب بقسم معيّن؟ 'both' والدوال المشتركة مسموحة دائماً؛ أي قيمة غير متوقعة (null) ⇒ رفض (إغلاق آمن).
create or replace function public.section_allows(p_sections text, p_section text)
returns boolean language sql immutable set search_path=public
as $$ select coalesce(coalesce(p_sections,'both')='both' or p_section='shared' or p_sections=p_section, false) $$;

-- 3) قسم الدالة المستدعية من سلسلة الاستدعاء (PG_CONTEXT): أي إطار لدالة diwan_* ⇒ 'diwan'؛ وإلا أي إطار لدالة
--    مشتركة ⇒ 'shared'؛ وإلا أي إطار لدالة أخرى ⇒ 'annual'؛ وبلا إطارات (قراءة جدول مباشرة عبر RLS) ⇒ 'shared'
--    (سياسات الجداول تفحص القسم صراحة — البند 7).
create or replace function public.caller_section()
returns text language plpgsql stable set search_path=public
as $$
declare v_ctx text; v_line text; v_name text; v_diwan boolean:=false; v_shared boolean:=false; v_other boolean:=false;
begin
  get diagnostics v_ctx = pg_context;
  foreach v_line in array string_to_array(coalesce(v_ctx,''), E'\n') loop
    v_name := substring(v_line from '(?:PL/pgSQL function |SQL function ")(?:public\.)?([a-z0-9_]+)');
    continue when v_name is null or v_name in ('caller_section','section_allows','current_user_role','profile_section_allows',
      'committee_from_token','committee_role_from_token','sub_admin_from_token');
    if v_name like 'diwan\_%' then v_diwan:=true;
    elsif v_name in ('committee_login','committee_logout','committee_resume','committee_list_notifications','committee_report_issue',
      'sub_admin_login','sub_admin_logout','sub_admin_resume','sub_admin_list_issue_reports','sub_admin_resolve_issue_report',
      'supervisor_save_committee','supervisor_set_committee_active','supervisor_set_committee_final_edit',
      'supervisor_set_committee_show_score','supervisor_set_committee_show_stats_summary',
      'supervisor_set_committee_permissions','supervisor_save_sub_admin','supervisor_delete_sub_admin','prune_old_logs','account_sections',
      'reset_login_code_pin') then v_shared:=true;
    else v_other:=true; end if;
  end loop;
  if v_diwan then return 'diwan'; end if;
  if v_shared then return 'shared'; end if;
  if v_other then return 'annual'; end if;
  return 'shared';
end $$;
revoke execute on function public.caller_section() from public, anon, authenticated;

create or replace function public.section_denied_message(p_sections text)
returns text language sql immutable set search_path=public
as $$ select case p_sections when 'diwan' then 'هذا الحساب مخصص لقسم ديوان الحفاظ — ادخل من رابط ديوان الحفاظ'
  when 'annual' then 'هذا الحساب مخصص لقسم المسابقة السنوية — ادخل من رابط المسابقة السنوية' else 'هذا الحساب غير مخوّل لهذا القسم' end $$;

-- 4) دوال التحقق المركزية: نفس الاستعلام تماماً (آخر نسخة: committee-pin-migration.sql / two-examiners.sql /
--    sub-admins-and-committee-upgrade.sql) + رفض صريح للحساب المقيَّد بقسم آخر. نفس التوقيع ونوع الإرجاع،
--    فتبقى صلاحيات التنفيذ (المسحوبة من العموم بـsecurity-hardening.sql) كما هي.
create or replace function public.committee_from_token(p_token text)
returns public.committees
language plpgsql stable security definer set search_path=public,extensions
as $$
declare v public.committees;
begin
  select c.* into v from public.committees c join public.committee_login_sessions s on s.committee_id=c.id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and c.active=true
  limit 1;
  if v.id is not null and coalesce(v.sections,'both')<>'both' then
    if not public.section_allows(v.sections, public.caller_section()) then raise exception '%', public.section_denied_message(v.sections); end if;
  end if;
  return v;
end $$;

create or replace function public.committee_role_from_token(p_token text)
returns text language plpgsql stable security definer set search_path=public,extensions
as $$
declare v_role text; v_sections text;
begin
  select s.examiner_role, c.sections into v_role, v_sections from public.committee_login_sessions s
  join public.committees c on c.id=s.committee_id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and c.active=true
  limit 1;
  if v_role is not null and coalesce(v_sections,'both')<>'both' then
    if not public.section_allows(v_sections, public.caller_section()) then raise exception '%', public.section_denied_message(v_sections); end if;
  end if;
  return v_role;
end $$;

create or replace function public.sub_admin_from_token(p_token text)
returns public.sub_admins language plpgsql stable security definer set search_path=public,extensions
as $$
declare v public.sub_admins;
begin
  select a.* into v from public.sub_admins a join public.sub_admin_sessions s on s.sub_admin_id=a.id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and a.active=true
  limit 1;
  if v.id is not null and coalesce(v.sections,'both')<>'both' then
    if not public.section_allows(v.sections, public.caller_section()) then raise exception '%', public.section_denied_message(v.sections); end if;
  end if;
  return v;
end $$;

-- 5) مشرف المسابقة: نفس الدالة (schema.sql) — لغير المشرف أو للمشرف على 'both' النتيجة كما هي حرفياً؛
--    للمشرف المقيَّد داخل دالة من القسم الآخر ترجع 'restricted' (ليست دوراً معروفاً) فترفضه كل الفحوص:
--    ='supervisor' و in ('admin','supervisor') و <>'admin' (لا null، فلا يتسلل عبر فحص قديم غير آمن مع null).
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public
as $$
  select case when p.role='supervisor' and coalesce(p.sections,'both')<>'both'
    then (case when public.section_allows(p.sections, public.caller_section()) then p.role else 'restricted' end)
    else p.role end
  from public.profiles p where p.id=auth.uid()
$$;

-- قسم المستخدم الحالي (حساب Auth) يسمح بقسم معيّن؟ للمدير وغير المشرفين دائماً true.
create or replace function public.profile_section_allows(p_section text)
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select case when p.role='supervisor' then public.section_allows(p.sections,p_section) else true end
  from public.profiles p where p.id=auth.uid()), true) $$;

-- 5ب) المشرف المقيَّد لا يدير الحسابات المشتركة (لجان/مسؤولون فرعيون): الإنشاء يعطي 'both' افتراضياً وتغيير الرمز
--     يسمح بالدخول بها، فيتجاوز تقييده. الحارس على الجدولين نفسيهما فيشمل كل الدوال (حالية ومستقبلية).
create or replace function public.block_restricted_supervisor_account_admin()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  -- عدّادات قفل الدخول (failed_login_count/locked_until) تحدّثها دالة دخول اللجنة/المسؤول الفرعي نفسها، وقد يكون بنفس
  -- المتصفح جلسة Auth لمشرف مقيَّد (تبويب آخر) — هذا التحديث وحده ليس إدارة حسابات فلا يُمنع.
  if tg_op='UPDATE' and (to_jsonb(new)-'failed_login_count'-'locked_until')=(to_jsonb(old)-'failed_login_count'-'locked_until') then return new; end if;
  if exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='supervisor' and coalesce(p.sections,'both')<>'both') then
    raise exception 'إدارة اللجان والحسابات غير متاحة لحساب مقيَّد بقسم واحد — تتولاها الإدارة الرئيسية';
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists committees_restricted_supervisor_guard on public.committees;
create trigger committees_restricted_supervisor_guard before insert or update or delete on public.committees
  for each row execute function public.block_restricted_supervisor_account_admin();
drop trigger if exists sub_admins_restricted_supervisor_guard on public.sub_admins;
create trigger sub_admins_restricted_supervisor_guard before insert or update or delete on public.sub_admins
  for each row execute function public.block_restricted_supervisor_account_admin();

-- 6) diwan_staff_actor (آخر نسخة: granular-permissions-core.sql حرفياً) + رفض المشرف «سنوية فقط» بالديوان.
--    المسؤول الفرعي يُفحص تلقائياً داخل sub_admin_from_token (الاستدعاء من دوال diwan_staff_* ⇒ 'diwan').
create or replace function public.diwan_staff_actor(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions
as $$
declare v_profile public.profiles; v_admin public.sub_admins;
begin
  select * into v_profile from public.profiles where id=auth.uid();
  if v_profile.role='supervisor' then
    if not public.section_allows(v_profile.sections,'diwan') then raise exception '%', public.section_denied_message(v_profile.sections); end if;
    return jsonb_build_object('gender','*','can_delete',public.has_permission(v_profile.permissions,'can_delete_data'),
      'can_transfer',public.has_permission(v_profile.permissions,'can_transfer_participant'),'label','مشرف المسابقة: '||coalesce(v_profile.display_name,''));
  end if;
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  return jsonb_build_object('gender',v_admin.gender,'can_delete',public.has_permission(v_admin.permissions,'can_delete_data'),
    'can_transfer',public.has_permission(v_admin.permissions,'can_transfer_participant'),'label','مسؤول فرعي: '||coalesce(v_admin.name,''));
end $$;
revoke execute on function public.diwan_staff_actor(text) from public,anon,authenticated;

-- 7) القراءة المباشرة لجداول البيانات (المشرف يقرؤها عبر REST): نفس السياسات + فحص قسم المشرف صراحة.
drop policy if exists sessions_read on public.exam_sessions;
create policy sessions_read on public.exam_sessions for select to authenticated
using (public.current_user_role()='admin'
  or (public.current_user_role()='supervisor' and public.profile_section_allows('annual'))
  or committee_id=public.current_committee_id());

drop policy if exists diwan_state_read on public.diwan_state;
create policy diwan_state_read on public.diwan_state for select to authenticated
using (public.current_user_role()='admin' or (public.current_user_role()='supervisor' and public.profile_section_allows('diwan')));

drop policy if exists diwan_sessions_read on public.diwan_exam_sessions;
create policy diwan_sessions_read on public.diwan_exam_sessions for select to authenticated
using (public.current_user_role()='admin' or (public.current_user_role()='supervisor' and public.profile_section_allows('diwan')));

-- 8) قسم الحساب الحالي للواجهة (لتعرض رسالة واضحة وتوجّه للرابط الصحيح بعد الدخول). يرجع القسم فقط لرمز صالح.
create or replace function public.account_sections(p_kind text, p_token text default null)
returns text language plpgsql stable security definer set search_path=public,extensions
as $$
declare v text;
begin
  if p_kind='committee' then
    select c.sections into v from public.committees c join public.committee_login_sessions s on s.committee_id=c.id
    where s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') and s.expires_at>now() and c.active=true limit 1;
  elsif p_kind='subAdmin' then
    select a.sections into v from public.sub_admins a join public.sub_admin_sessions s on s.sub_admin_id=a.id
    where s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') and s.expires_at>now() and a.active=true limit 1;
  else
    select case when p.role='supervisor' then p.sections else 'both' end into v from public.profiles p where p.id=auth.uid();
  end if;
  return coalesce(v,'both');
end $$;
grant execute on function public.account_sections(text,text) to anon, authenticated;

-- 9) تعيين قسم حساب — للمدير الرئيسي فقط.
create or replace function public.admin_set_account_sections(p_kind text, p_id uuid, p_sections text)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if p_sections not in ('both','annual','diwan') then raise exception 'قيمة القسم غير صحيحة'; end if;
  if p_kind='committee' then update public.committees set sections=p_sections where id=p_id;
  elsif p_kind='subAdmin' then update public.sub_admins set sections=p_sections where id=p_id;
  elsif p_kind='supervisor' then update public.profiles set sections=p_sections where id=p_id and role='supervisor';
  else raise exception 'نوع الحساب غير صحيح'; end if;
  if not found then raise exception 'الحساب غير موجود'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'update_account_sections',case p_kind when 'subAdmin' then 'sub_admin' else p_kind end,p_id::text,jsonb_build_object('sections',p_sections));
end $$;
revoke execute on function public.admin_set_account_sections(text,uuid,text) from public, anon;
grant execute on function public.admin_set_account_sections(text,uuid,text) to authenticated;

-- 10) فحص ذاتي للإدارة بعد التشغيل: diwan_section_selftest ⇒ 'diwan'، annual_section_selftest ⇒ 'annual'،
--     annual_section_selftest_sql (إطار SQL) ⇒ 'annual' — تحقق من تمييز القسم بالخادم الفعلي قبل تقييد أي حساب.
create or replace function public.diwan_section_selftest()
returns text language plpgsql stable security definer set search_path=public
as $$ begin if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if; return public.caller_section(); end $$;
create or replace function public.annual_section_selftest()
returns text language plpgsql stable security definer set search_path=public
as $$ begin if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if; return public.caller_section(); end $$;
create or replace function public.annual_section_selftest_sql()
returns text language sql stable security definer set search_path=public
as $$ select case when public.current_user_role()='admin' then public.caller_section() end $$;
-- الدوال الحية التي تقارن current_user_role() بـ<> أو != أو not in (يجب أن تكون فارغة؛ وحتى لو لم تكن فـ'restricted' يُرفض بها).
create or replace function public.account_sections_role_check_audit()
returns setof text language plpgsql stable security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  return query select p.oid::regprocedure::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p')
    and pg_get_functiondef(p.oid) ~ 'current_user_role\(\)\s*(<>|!=|not in)';
end $$;
revoke execute on function public.annual_section_selftest_sql() from public, anon;
revoke execute on function public.account_sections_role_check_audit() from public, anon;
grant execute on function public.annual_section_selftest_sql() to authenticated;
grant execute on function public.account_sections_role_check_audit() to authenticated;
revoke execute on function public.diwan_section_selftest() from public, anon;
revoke execute on function public.annual_section_selftest() from public, anon;
grant execute on function public.diwan_section_selftest() to authenticated;
grant execute on function public.annual_section_selftest() to authenticated;
