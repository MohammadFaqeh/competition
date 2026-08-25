-- "نسيت كلمة السر" لحسابات الإدارة/المشرف (Supabase Auth حقيقية) — تدفق ذاتي بالكامل عبر رمز:
--   1) صاحب الحساب يكتب إيميله بشاشة الدخول → رمز 6 أرقام يُبعث بريدياً للإداري الرئيسي فقط
--      (notify_email بـ backup_settings) — أبداً لصندوق بريد صاحب الحساب نفسه.
--   2) الإداري يوصّل الرمز لصاحب الحساب هاتفياً (تحقق هوية يدوي).
--   3) صاحب الحساب يدخل الرمز + كلمة سر جديدة بنفس شاشة الدخول → لو الرمز صحيح وغير منتهٍ،
--      كلمة السر تتحدّث فوراً على نفس حساب Supabase Auth (auth.admin.updateUserById) — نفس
--      الحساب بالضبط يقدر يسجّل دخول فيها مباشرة، لا حساب بديل ولا ربط منفصل.
--
-- هذا الجدول فقط يخزّن الرموز؛ لا صلاحية قراءة/كتابة لأي دور — Edge Function وحدها (بصلاحية
-- service_role، تتجاوز RLS) تلمسه (راجع supabase/functions/password-reset/index.ts).
--
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية (وتحديداً بعد auto-backup-settings.sql).

create table if not exists public.password_reset_codes (
  id bigint generated always as identity primary key,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.password_reset_codes enable row level security;
revoke all on public.password_reset_codes from anon, authenticated;
-- عمداً بلا أي policy — لا anon ولا authenticated يقدر يقرأ/يكتب هالجدول إطلاقاً من التطبيق،
-- فقط الـ Edge Function بمفتاح service_role (يتجاوز RLS بطبيعته).
