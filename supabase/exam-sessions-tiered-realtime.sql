-- نظام Real-Time طبقي (Tiered) لجلسات الاختبار: يقلّل العمل الفعلي من المصدر (قاعدة البيانات
-- والشبكة)، لا فقط إخفاء بالواجهة. القاعدة: جلسة "جارية" (in_progress) أو اعتُمدت خلال آخر
-- نافذة زمنية قريبة (تمررها الواجهة، افتراضيًا 12 ساعة بـLIVE_RECENT_WINDOW_MS بapp.js) تبقى
-- "حيّة" وتُجلب بكل استطلاع دوري؛ جلسة اعتُمدت قبل ذلك بكثير عمليًا لن تتغيّر ثانيةً (إلا بإعادة
-- فتحها يدويًا، وحينها finalized_at تصير جديدة فتدخل النافذة من جديد تلقائيًا)، فتتوقف عن
-- الدخول بالاستطلاع الدوري وتبقى محفوظة محليًا فقط من آخر مرة كانت "حديثة"، وتُجلب كاملة فقط
-- عند تسجيل الدخول أو زر تحديث يدوي (الدوال الكاملة القديمة committee_list_sessions/
-- sub_admin_list_sessions/listFinalSessions تبقى كما هي بلا أي حذف، تُستخدم لهذين الغرضين حصرًا).
--
-- كل دالة هنا إضافية جديدة الاسم (لا تُعدَّل أي دالة موجودة) — صفر خطر على أي استدعاء حالي، وإن
-- لم يُطبَّق هذا الملف بعد فالواجهة تتراجع تلقائيًا للدوال الكاملة القديمة (راجع cloud.js).
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor بعد كل ملفات supabase/*.sql الحالية.

-- فهارس أداء: exam_sessions لم يكن له أي فهرس صريح غير المعرّف الفريد الضمني على
-- participant_id، فكل فلترة بـstatus/committee_id/updated_at/finalized_at (والتي تحدث بكل
-- استطلاع دوري بكل الموقع) كانت مسحاً تسلسليًا كاملاً للجدول. لا تغيّر أي سلوك، فقط أداء.
create index if not exists exam_sessions_status_updated_idx
  on public.exam_sessions(status, updated_at desc);
create index if not exists exam_sessions_committee_status_updated_idx
  on public.exam_sessions(committee_id, status, updated_at desc);
create index if not exists exam_sessions_finalized_idx
  on public.exam_sessions(finalized_at desc) where status='final';

-- جلسات اللجنة "الحيّة" فقط: جارية حاليًا + معتمدة خلال p_since. نفس منطق تفويض/فحص
-- committee_list_sessions بالضبط (committee-pin-migration.sql) مع فلتر زمني إضافي فقط.
create or replace function public.committee_list_live_sessions(p_token text, p_since timestamptz)
returns setof public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  return query select * from public.exam_sessions
    where committee_id=v_committee.id and (status='in_progress' or updated_at>=p_since)
    order by updated_at desc;
end $$;

-- جلسة واحدة بعينها مقيّدة بلجنة صاحب الرمز — لمزامنة موضع الرئيس أثناء رصد العضو (كل 1.5
-- ثانية، أسخن نقطة استطلاع بالموقع): سطر واحد بدل مسح كامل تاريخ اللجنة في كل نبضة.
create or replace function public.committee_get_session(p_token text, p_session_id uuid)
returns public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select * into v_session from public.exam_sessions where id=p_session_id and committee_id=v_committee.id;
  return v_session;
end $$;

-- نفس تقييد "حيّة فقط" لمسار المسؤول الفرعي (نفس نمط sub_admin_list_sessions بملف
-- sub-admin-monitor-and-transfer-fields.sql، مع فلتر زمني إضافي فقط).
create or replace function public.sub_admin_list_live_sessions(p_token text, p_since timestamptz)
returns setof public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  return query select es.* from public.exam_sessions es
    join public.committees c on c.id=es.committee_id
    where (c.responsible_gender is null or c.responsible_gender=v_admin.gender)
      and (es.status='in_progress' or es.updated_at>=p_since)
    order by es.updated_at desc;
end $$;

grant execute on function public.committee_list_live_sessions(text,timestamptz) to anon,authenticated;
grant execute on function public.committee_get_session(text,uuid) to anon,authenticated;
grant execute on function public.sub_admin_list_live_sessions(text,timestamptz) to anon,authenticated;
