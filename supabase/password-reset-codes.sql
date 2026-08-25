-- "نسيت كلمة السر/الرمز" — لكل الحسابات (إدارة/مشرف بالإيميل، ولاحقاً وُسّعت لتشمل رئيس/عضو
-- اللجنة والمسؤول الفرعي برمز الدخول أيضاً — راجع supabase/committee-forgot-pin.sql). تدفق
-- ذاتي بالكامل عبر رمز:
--   1) صاحب الحساب يكتب إيميله (إدارة/مشرف) أو رمز دخوله (لجنة/مسؤول فرعي) بشاشة الدخول →
--      رمز 6 أرقام يُبعث بريدياً للإداري الرئيسي فقط (notify_email بـ backup_settings) — أبداً
--      لصندوق بريد صاحب الحساب نفسه.
--   2) الإداري يوصّل الرمز لصاحب الحساب هاتفياً (تحقق هوية يدوي).
--   3) صاحب الحساب يدخل الرمز + كلمة سر/PIN جديد بنفس شاشة الدخول → لو الرمز صحيح وغير منتهٍ،
--      يتحدّث فوراً على نفس الحساب (auth.admin.updateUserById للإدارة/المشرف، أو
--      public.reset_login_code_pin للجان/المسؤول الفرعي) — نفس الحساب بالضبط، دخول فوري.
--
-- عمود email هون فعلياً "معرّف عام" (إيميل أو رمز دخول)، بقي بنفس الاسم لتفادي أي تعديل على
-- جدول منشور مسبقاً — بلا أثر وظيفي (نص حر بدون قيد صيغة إيميل).
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
