-- تنظيف تلقائي لسجلات النشاط/الإشعارات المساعدة بعد 48 ساعة — طلب صريح: "أي سجل نشاط
-- موجود بالموقع، خليه يحتفظ ببيانات 48 ساعة بعدين يُحذف — قصدي سجل نشاط مش البيانات الحقيقية".
--
-- الجداول الثلاثة أدناه سجلات مساعدة بحتة (تدقيق/تنبيه/توقيت عرض) — حذف صف قديم منها لا يمس
-- أي بيانات فعلية بالمسابقة (لا نتائج، لا متسابقين، لا سحوبات، لا حسابات لجان):
--   - audit_log: سجل النشاط الكامل (من فعل ماذا ومتى).
--   - committee_notifications: تنبيهات نقل متسابق للجنة (تُعرض مرة وتُنسى).
--   - participant_change_log: توقيت حقيقي لتغييرات بيانات متسابق (لو حُذف صف قديم، النظام
--     أصلاً مصمَّم يتراجع تلقائياً لعرض "الآن" بدل التوقيت الحقيقي — سلوك تراجعي آمن موجود سلفاً).
-- لا تُلمَس أي جداول أخرى (exam_sessions، competition_state، committees، committee_login_sessions
-- وهو حالة تسجيل دخول فعلية لا سجل تاريخي، إلخ).
--
-- التنفيذ: دالة مستقلة جديدة بالكامل (بدل تعديل أي دالة موجودة لتفادي أي مجازفة على منطق
-- معتمد فعلياً) — تُستدعى بشكل انتهازي من جهة العميل (كل ما تفتح الإدارة لوحتها)، بدل
-- الاعتماد على pg_cron (غير مضمون التوفر على كل خطط Supabase، خصوصاً الخطة المجانية).
-- قابل لإعادة التشغيل بأمان (idempotent). نفّذه من SQL Editor بعد كل ملفات supabase/*.sql السابقة.

create or replace function public.prune_old_logs()
returns void language plpgsql security definer set search_path=public
as $$
begin
  delete from public.audit_log where created_at < now() - interval '48 hours';
  delete from public.committee_notifications where created_at < now() - interval '48 hours';
  delete from public.participant_change_log where changed_at < now() - interval '48 hours';
end $$;
grant execute on function public.prune_old_logs() to anon,authenticated;
