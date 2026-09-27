-- تقوية أمنية بعد الفحص الأمني (2026-09-27) — لا يغيّر أي سلوك مطلوب بالموقع.
-- نفّذ هذا الملف مرة واحدة من Supabase SQL Editor (بعد كل ملفات supabase/*.sql الحالية). قابل لإعادة التشغيل بأمان.
--
-- 1) الدوال المساعدة الداخلية كانت قابلة للاستدعاء مباشرة من أي زائر عبر Supabase API (صلاحية EXECUTE الافتراضية
--    لـ PUBLIC). committee_from_token/sub_admin_from_token ترجع الصف كاملاً — ومنه رمز دخول الرئيس/العضو و pin_hash —
--    فكان عضو اللجنة يستطيع قراءة hash رقم الرئيس وكسره خارج الموقع (4 أرقام) والدخول كرئيس.
--    الموقع لا يستدعي أياً منها مباشرة؛ كل من يستدعيها دوال SECURITY DEFINER (تعمل بصلاحية المالك) فتبقى تعمل كما هي.
revoke execute on function public.committee_from_token(text) from public, anon, authenticated;
revoke execute on function public.committee_role_from_token(text) from public, anon, authenticated;
revoke execute on function public.sub_admin_from_token(text) from public, anon, authenticated;

-- 2) دوال تنبيهات اللجان الداخلية (تُستدعى فقط من دوال النقل/التعديل SECURITY DEFINER) — كانت متاحة لأي حساب مسجَّل،
--    فيستطيع إرسال تنبيهات مزيّفة لأي لجنة.
revoke execute on function public.record_participant_edit_notification(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.record_transfer_notifications(text,text,uuid,uuid) from public, anon, authenticated;

-- 3) تنظيف السجلات الأقدم من 24 ساعة: نفس الجسم تماماً، لكن للإدارة الرئيسية ومشرف المسابقة فقط (كانت متاحة لأي زائر).
--    لوحة الإدارة تستدعيها كالمعتاد عند فتحها؛ أي استدعاء من غيرهم يتجاهَل بصمت (بلا خطأ) فلا يتأثر شيء بالواجهة.
create or replace function public.prune_old_logs()
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is null or public.current_user_role() not in ('admin','supervisor') then return; end if;
  delete from public.audit_log where created_at < now() - interval '24 hours';
  delete from public.committee_notifications where created_at < now() - interval '24 hours';
  delete from public.participant_change_log where changed_at < now() - interval '24 hours';
end $$;
revoke execute on function public.prune_old_logs() from public, anon;
grant execute on function public.prune_old_logs() to authenticated;

-- فحص بعد التنفيذ (يجب أن تكون كل القيم false):
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can_run
-- from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and p.proname in ('committee_from_token','committee_role_from_token','sub_admin_from_token',
--   'record_participant_edit_notification','record_transfer_notifications','prune_old_logs');
