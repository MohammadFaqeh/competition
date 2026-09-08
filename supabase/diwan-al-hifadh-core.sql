-- "اختبارات ديوان الحفاظ - فرع الكورة": مسار اختبار مستقل عن المسابقة القرآنية السنوية من ناحية
-- بيانات المتسابقين والسحوبات فقط (جدول diwan_state جديد بالكامل). اللجان مشتركة تماماً مع
-- السنوية — نفس حساب/رمز/PIN المُضاف من "الإعدادات ← إدارة لجان الاختبار" (جدول public.committees
-- ودوال committee_login/committee_resume/committee_from_token/committee_role_from_token الموجودة
-- أصلاً) يمتحن الطرفين معاً، بلا أي حساب أو تسجيل دخول منفصل ثانٍ — طلب صريح.
--
-- نسخة أساسية مقصودة (بموافقة صريحة): تغطي التسجيل، السحب (فردي/جماعي)، تصدير Excel (من
-- الواجهة مباشرة، لا حاجة لدالة SQL خاصة به)، تقييم إلكتروني بمُصحّحين (رئيس+عضو، بنفس صلاحيات
-- can_edit_final/show_score المضبوطة أصلاً على اللجنة بالسنوية)، اعتماد نتيجة. بلا الطبقات
-- المتقدمة التي تراكمت بالسنوية عبر شهور استخدام فعلي (رصد حي متعدد الطبقات، إلخ) — تُضاف
-- لاحقاً فقط لو احتاجها ديوان الحفاظ فعلياً. نفّذ هذا الملف كاملاً من SQL Editor بعد كل ملفات
-- supabase/*.sql الحالية (يحتاج تحديداً committee-pin-migration.sql وtwo-examiners.sql وexam-
-- readiness-hardening.sql/committee-score-visibility.sql مُطبَّقة مسبقاً لوجود can_edit_final/show_score).

create extension if not exists pgcrypto;

-- ==========================================================================
-- الجداول
-- ==========================================================================

create table if not exists public.diwan_state (
  id smallint primary key default 1 check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.diwan_state(id,payload) values(1,'{}'::jsonb) on conflict(id) do nothing;

-- committee_id يشير لنفس جدول public.committees المشترك مع السنوية — لا جدول لجان منفصل.
-- ملاحظة: حذف لجنة لها اختبارات ديوان حفاظ مسجَّلة (ولو بلا أي اختبار سنوي) سيُرفض بخطأ قاعدة
-- بيانات عام (قيد مفتاح أجنبي) حتى تُحذف/تُنقل جلساتها هنا أولاً — نفس حماية admin_delete_committee
-- الحالية (تمنع حذف لجنة لها اختبارات سنوية) بس بدون رسالة عربية مخصصة لهذه الحالة بعد.
create table if not exists public.diwan_exam_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null unique,
  draw_id text not null,
  committee_id uuid not null references public.committees(id),
  level smallint,
  level_name text,
  status text not null default 'in_progress' check (status in ('in_progress','final')),
  assessment jsonb not null default '{}'::jsonb,
  score numeric(5,2) check (score between 0 and 100),
  is_final_revision boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz
);

alter table public.diwan_state enable row level security;
alter table public.diwan_exam_sessions enable row level security;

grant usage on schema public to anon,authenticated;
grant select on public.diwan_state to authenticated;
grant select on public.diwan_exam_sessions to authenticated;

drop policy if exists diwan_state_read on public.diwan_state;
create policy diwan_state_read on public.diwan_state for select to authenticated
using (public.current_user_role()='admin');

drop policy if exists diwan_sessions_read on public.diwan_exam_sessions;
create policy diwan_sessions_read on public.diwan_exam_sessions for select to authenticated
using (public.current_user_role()='admin');

-- ==========================================================================
-- اللجنة: نفس تسجيل الدخول/الجلسة المستخدَم بالسنوية بالضبط (committee_from_token/
-- committee_role_from_token من committee-pin-migration.sql/two-examiners.sql) — بلا أي دالة
-- دخول أو جدول جلسات جديد هنا. الدوال أدناه فقط تستهلك تلك الجلسة لقراءة/كتابة بيانات ديوان الحفاظ.
-- ==========================================================================

create or replace function public.diwan_committee_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.diwan_state where id=1;
  return coalesce(v_payload,'{}'::jsonb);
end $$;

create or replace function public.diwan_committee_list_sessions(p_token text)
returns setof public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  return query select * from public.diwan_exam_sessions where committee_id=v_committee.id order by updated_at desc;
end $$;

-- بدء اختبار متسابق (أول دخول للجنة على موضعه) — يمنع لجنة ثانية تبدأ نفس المتسابق لو سبق وبدأته لجنة أخرى.
create or replace function public.diwan_committee_claim_student(p_token text,p_participant_id text,p_draw_id text,p_level smallint,p_level_name text default null)
returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.diwan_exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select * into v_session from public.diwan_exam_sessions where participant_id=p_participant_id;
  if v_session.id is not null and v_session.committee_id<>v_committee.id then raise exception 'بدأت لجنة أخرى امتحان هذا المتسابق'; end if;
  if v_session.id is null then
    insert into public.diwan_exam_sessions(participant_id,draw_id,committee_id,level,level_name)
    values(p_participant_id,p_draw_id,v_committee.id,p_level,p_level_name) returning * into v_session;
  end if;
  return v_session;
end $$;

-- حفظ مسودة/اعتماد تقييم بمُصحّحين (رئيس/عضو) — نفس منطق committee_save_session بالسنوية بالضبط،
-- بما فيه قراءة can_edit_final مباشرة من نفس صف اللجنة المشتركة (لا حقل مستقل لديوان الحفاظ).
create or replace function public.diwan_committee_save_session(
  p_token text,p_session_id uuid,p_assessment jsonb,p_status text,p_score numeric
) returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.diwan_exam_sessions; v_role text; v_saved jsonb;
begin
  v_committee=public.committee_from_token(p_token);v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_status not in ('in_progress','final') then raise exception 'حالة التقييم غير صالحة'; end if;
  select * into v_session from public.diwan_exam_sessions where id=p_session_id and committee_id=v_committee.id for update;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة أو ألغتها الإدارة'; end if;
  if p_status='final' and v_role<>'chairman' then raise exception 'اعتماد النتيجة متاح لرئيس اللجنة فقط'; end if;
  if v_session.status='final' and p_status='in_progress' and v_role<>'chairman' then raise exception 'إعادة فتح النتيجة متاحة لرئيس اللجنة فقط'; end if;
  if (v_session.status='final' or v_session.is_final_revision) and not v_committee.can_edit_final then raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة'; end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then raise exception 'العلامة النهائية غير صالحة'; end if;
  if p_status='in_progress' then
    v_saved=jsonb_set(jsonb_set(coalesce(v_session.assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb),true),array['examinerDrafts',v_role],p_assessment,true);
  else
    v_saved=p_assessment||jsonb_build_object('examinerDrafts',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb));
  end if;
  update public.diwan_exam_sessions set assessment=v_saved,status=p_status,
    score=case when p_status='final' then p_score else null end,updated_at=now(),
    finalized_at=case when p_status='final' then now() else finalized_at end,
    is_final_revision=case when v_session.status='final' and p_status='in_progress' then true when p_status='final' then false else v_session.is_final_revision end
    where id=p_session_id returning * into v_session;
  return v_session;
end $$;

grant execute on function public.diwan_committee_load_state(text) to anon,authenticated;
grant execute on function public.diwan_committee_list_sessions(text) to anon,authenticated;
grant execute on function public.diwan_committee_claim_student(text,text,text,smallint,text) to anon,authenticated;
grant execute on function public.diwan_committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;

-- ==========================================================================
-- الإدارة: حفظ الحالة (متسابقين+سحوبات) — يرسل فقط الفروقات (راجع cloud.js)، يحافظ على أي
-- id غائب عن الدفعة وغير مُدرَج بالمحذوفين كما هو (نفس منطق admin_save_state بالسنوية).
-- ==========================================================================

create or replace function public.diwan_admin_save_state(
  p_config jsonb,p_participants jsonb,p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',p_deleted_draw_ids text[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_others_participants jsonb; v_others_draws jsonb; v_final_participants jsonb; v_final_draws jsonb;
  v_incoming_participant_ids text[]; v_incoming_draw_ids text[];
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;

  select payload into v_payload from public.diwan_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_draw_ids from jsonb_array_elements(p_draws) n;

  select coalesce(jsonb_agg(item),'[]') into v_others_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where not (item->>'id'=any(p_deleted_participant_ids))
    and not (item->>'id'=any(v_incoming_participant_ids));
  v_final_participants=v_others_participants||p_participants;

  select coalesce(jsonb_agg(item),'[]') into v_others_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where not (item->>'id'=any(p_deleted_draw_ids))
    and not (item->>'id'=any(v_incoming_draw_ids));
  v_final_draws=v_others_draws||p_draws;

  v_payload=jsonb_set(v_payload,'{config}',p_config,true);
  v_payload=jsonb_set(v_payload,'{participants}',v_final_participants,true);
  v_payload=jsonb_set(v_payload,'{draws}',v_final_draws,true);

  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return v_payload;
end $$;
grant execute on function public.diwan_admin_save_state(jsonb,jsonb,jsonb,text[],text[]) to authenticated;

-- فحص خفيف جداً (توقيت فقط) قبل أي تنزيل كامل، لنفس سبب competition_state_version بالسنوية.
create or replace function public.diwan_state_version()
returns timestamptz language sql stable security definer set search_path=public
as $$ select updated_at from public.diwan_state where id=1 $$;
grant execute on function public.diwan_state_version() to authenticated;

create or replace function public.diwan_admin_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payload jsonb; v_existing jsonb; v_owner text; v_sequence integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select payload into v_payload from public.diwan_state where id=1 for update;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  if nullif(p_draw->>'participantId','') is not null then
    select item into v_existing from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
      where item->>'participantId'=p_draw->>'participantId' limit 1;
    if v_existing is not null then
      select c.name into v_owner from public.diwan_exam_sessions s join public.committees c on c.id=s.committee_id
        where s.participant_id=p_draw->>'participantId';
      raise exception 'تم السحب لهذا المتسابق مسبقاً بواسطة %',coalesce(v_owner,'الإدارة');
    end if;
  end if;
  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]')||jsonb_build_array(p_draw),true);
  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return p_draw;
end $$;
grant execute on function public.diwan_admin_create_draw(jsonb) to authenticated;

create or replace function public.diwan_admin_delete_participant_session(p_participant_id text)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.diwan_exam_sessions where participant_id=p_participant_id;
end $$;
grant execute on function public.diwan_admin_delete_participant_session(text) to authenticated;
