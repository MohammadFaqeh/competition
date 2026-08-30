-- بلاغ خطأ بيانات متسابق من اللجنة إلى الإدارة: قبل بدء "تسجيل الأخطاء" لأول مرة لأي
-- متسابق، تعرض شاشة اللجنة (بـ app.js) بيانات الطالب (الاسم/المركز/المستوى/الأجزاء)
-- للتأكد من مطابقتها للطالب الحاضر فعليًا. لو لاحظت اللجنة خطأ (مثلاً الأجزاء المسجّلة
-- غير التي حفظها الطالب)، تضغط "إبلاغ عن خطأ" بدل بدء الاختبار — فيصل بلاغ فوري
-- للإدارة الرئيسية ومشرف المسابقة والمسؤول الفرعي المختص (بجنس الطالب)، ولا يبدأ
-- الاختبار؛ تصحيح البيانات وإعادة السحب يبقى يدويًا من الإدارة بعدها.
--
-- جدول جديد بالكامل (بنفس نمط committee_notifications في committee-transfer-notifications.sql
-- لكن بالاتجاه المعاكس: اللجنة تكتب، الإدارة/المشرف/المسؤول الفرعي يقرؤون). لا يعدّل أو
-- يحذف أي حقل بأي جدول أو دالة موجودة.
--
-- نفّذ هذا الملف من Supabase SQL Editor بعد كل ملفات supabase/*.sql السابقة.
-- قابل لإعادة التشغيل بأمان (idempotent).

create table if not exists public.committee_issue_reports (
  id bigint generated always as identity primary key,
  committee_id uuid not null references public.committees(id) on delete cascade,
  participant_id text,
  participant_name text,
  participant_gender text,
  message text not null,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists committee_issue_reports_open_idx
  on public.committee_issue_reports(resolved, created_at desc);
alter table public.committee_issue_reports enable row level security;

-- الإدارة الرئيسية ومشرف المسابقة يقرآن ويُغلقان البلاغ مباشرة عبر RLS (بنفس نمط
-- committees_read بملف supervisor-role.sql)، بلا حاجة لأي RPC وسيط.
drop policy if exists committee_issue_reports_read on public.committee_issue_reports;
create policy committee_issue_reports_read on public.committee_issue_reports for select to authenticated
using (public.current_user_role() in ('admin','supervisor'));

drop policy if exists committee_issue_reports_resolve on public.committee_issue_reports;
create policy committee_issue_reports_resolve on public.committee_issue_reports for update to authenticated
using (public.current_user_role() in ('admin','supervisor'))
with check (public.current_user_role() in ('admin','supervisor'));
grant select,update on public.committee_issue_reports to authenticated;
-- عمداً بلا صلاحية insert/delete مباشرة لأي أحد: الكتابة فقط عبر committee_report_issue أدناه.

-- اللجنة تُرسل البلاغ (نفس مصادقة التوكن المستخدمة بكل دوال اللجان الأخرى).
create or replace function public.committee_report_issue(
  p_token text,p_participant_id text,p_message text
) returns void language plpgsql security definer set search_path=public,extensions as $$
declare v_committee public.committees; v_payload jsonb; v_participant jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if nullif(trim(p_message),'') is null then raise exception 'اكتب وصف المشكلة أولاً'; end if;
  select payload into v_payload from public.competition_state where id=1;
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  insert into public.committee_issue_reports(committee_id,participant_id,participant_name,participant_gender,message)
  values(v_committee.id,p_participant_id,v_participant->>'name',v_participant->>'gender',trim(p_message));
end $$;
grant execute on function public.committee_report_issue(text,text,text) to anon,authenticated;

-- المسؤول الفرعي (جلسة توكن مثل اللجنة، بلا مستخدم Supabase حقيقي): قراءة وإغلاق
-- البلاغات المطابقة لجنسه فقط.
create or replace function public.sub_admin_list_issue_reports(p_token text)
returns setof public.committee_issue_reports
language plpgsql security definer set search_path=public,extensions as $$
declare v_admin public.sub_admins;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  return query select * from public.committee_issue_reports
    where resolved=false and (participant_gender is null or participant_gender=v_admin.gender)
    order by created_at desc limit 200;
end $$;
grant execute on function public.sub_admin_list_issue_reports(text) to anon,authenticated;

create or replace function public.sub_admin_resolve_issue_report(p_token text,p_id bigint)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare v_admin public.sub_admins;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  update public.committee_issue_reports set resolved=true,resolved_at=now()
  where id=p_id and (participant_gender is null or participant_gender=v_admin.gender);
end $$;
grant execute on function public.sub_admin_resolve_issue_report(text,bigint) to anon,authenticated;
