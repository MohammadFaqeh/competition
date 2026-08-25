-- إعدادات "النسخ الاحتياطي التلقائي الدوري" — يتحكم فيه الإداري الرئيسي فقط (تفعيل/تعطيل +
-- الفاصل الزمني بالدقائق)، ويرسله فعلياً Edge Function منفصلة (auto-backup) تعمل من سيرفرات
-- Supabase نفسها بجدولة Cron — تشتغل حتى لو أُغلق المتصفح/الجهاز تمامًا، وترسل نسخة JSON
-- كاملة من حالة المسابقة (الإعدادات + المتسابقين + السحوبات + اللجان + المسؤولين الفرعيين +
-- جلسات الاختبار) كمرفق بريد إلكتروني إلى العنوان المسجَّل أدناه.
--
-- هذا الملف السطر الأول فقط (الجدول + RLS)؛ كود الـ Edge Function نفسه بملف منفصل
-- (supabase/functions/auto-backup/index.ts) يُنشر يدويًا من لوحة Supabase.
--
-- notify_email هون هو نفسه "إيميل الإداري الرئيسي" العام المستخدم أيضاً لإشعارات "نسيت كلمة
-- السر" (راجع supabase/password-reset-requests.sql وsupabase/functions/password-reset-notifier) —
-- مكان واحد فقط لتغييره لاحقاً إذا لزم.
--
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create table if not exists public.backup_settings (
  id smallint primary key default 1,
  enabled boolean not null default false,
  interval_minutes int not null default 30,
  notify_email text not null default 'mohammadalfaqeeh73@gmail.com',
  last_sent_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint backup_settings_single_row check (id=1),
  constraint backup_settings_interval_positive check (interval_minutes>=5)
);

insert into public.backup_settings(id) values (1) on conflict (id) do nothing;

alter table public.backup_settings enable row level security;
revoke all on public.backup_settings from anon;
grant select,update on public.backup_settings to authenticated;

drop policy if exists backup_settings_admin_all on public.backup_settings;
create policy backup_settings_admin_all on public.backup_settings for all to authenticated
  using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
