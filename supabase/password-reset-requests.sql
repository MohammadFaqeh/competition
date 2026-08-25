-- طلبات "نسيت كلمة السر" لحسابات الإدارة/المشرف (حسابات Supabase Auth حقيقية، بريد+كلمة سر).
-- التطبيق لا يقدر يصفّر كلمة السر برمجياً أبداً (لا يوجد مفتاح service_role بالمشروع، وهذا
-- مقصود أمنياً — راجع تعليق مشابه بأعلى supervisor-role.sql). فبدل ما يوصل رابط تصفير تلقائي
-- لصندوق بريد الحساب نفسه (سلوك Supabase الافتراضي)، هذا الجدول فقط يسجّل الطلب، وEdge
-- Function منفصلة مجدولة (password-reset-notifier) تبعت إشعاراً بريدياً للإداري الرئيسي على
-- الإيميل المسجَّل بـ backup_settings.notify_email كل ما تلاقي طلبات جديدة — وهو بعدها يصفّر
-- كلمة السر يدوياً من لوحة Supabase (Authentication → Users)، تماماً متل إنشاء أي حساب مشرف.
--
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية (وتحديداً بعد auto-backup-settings.sql).

create table if not exists public.password_reset_requests (
  id bigint generated always as identity primary key,
  identifier text not null,
  requested_at timestamptz not null default now(),
  notified boolean not null default false,
  notified_at timestamptz
);

alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon, authenticated;
-- لا سياسة select/update للعامة إطلاقاً — القراءة والتحديث فقط عبر Edge Function بصلاحية
-- service_role (تتجاوز RLS أصلاً). الإدراج فقط من خلال الدالة أدناه (security definer).

create or replace function public.request_password_reset(p_identifier text)
returns void language plpgsql security definer set search_path=public,extensions
as $$
declare v_recent_count int;
begin
  -- تحديد صامت: طلب مكرر لنفس الإيميل خلال 10 دقائق ما بينشئ إشعار جديد (يحمي صندوق بريد
  -- الإداري من السبام)، بدون ما نكشف للمستخدم أي فرق بالاستجابة (نفس رسالة النجاح دائماً).
  select count(*) into v_recent_count from public.password_reset_requests
    where lower(identifier)=lower(trim(p_identifier)) and requested_at>now()-interval '10 minutes';
  if v_recent_count>0 then return; end if;
  insert into public.password_reset_requests(identifier) values (trim(p_identifier));
end $$;

grant execute on function public.request_password_reset(text) to anon,authenticated;
