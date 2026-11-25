-- عدّاد «باقي X أيام على الاختبار» على شاشة الدخول (المسابقة السنوية — فرع الكورة)، 2026-11-25.
--
-- الإدارة تفعّله من الإعدادات ← بيانات الدورة، فيُحفظ ضمن config الموجود أصلاً:
--   competition_state.payload->'config'->'examCountdown' = {"enabled": true, "date": "YYYY-MM-DD"}
-- (يحفظه admin_save_state كما يحفظ بقية config — لا تغيير عليها).
--
-- شاشة الدخول تُعرض قبل تسجيل الدخول، وcompetition_state مقفولة تماماً على غير الإدارة
-- (security fix ff1311e). لذلك هذه الدالة الوحيدة المتاحة لـanon وترجع **التاريخ فقط** حين يكون
-- العدّاد مفعّلاً، وإلا null — لا أسماء ولا أرقام ولا أي حقل آخر من الـpayload.
--
-- الأمان: security definer بـsearch_path ثابت؛ لا مدخلات (فلا حقن)؛ التاريخ يُتحقَّق من صيغته
-- قبل إرجاعه؛ استعلام صف واحد (id=1) فلا كلفة تُذكر لو استُدعيت كثيراً.
-- آمن لإعادة التشغيل (create or replace).

create or replace function public.public_exam_countdown()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (s.payload #>> '{config,examCountdown,enabled}') = 'true'
     and (s.payload #>> '{config,examCountdown,date}') ~ '^\d{4}-\d{2}-\d{2}$'
    then jsonb_build_object('date', s.payload #>> '{config,examCountdown,date}')
    else null
  end
  from public.competition_state s
  where s.id = 1;
$$;

revoke all on function public.public_exam_countdown() from public;
grant execute on function public.public_exam_countdown() to anon, authenticated;

-- فحص سريع بعد التشغيل (يرجع null إن كان العدّاد معطّلاً، أو {"date": "..."} إن كان مفعّلاً):
-- select public.public_exam_countdown();
