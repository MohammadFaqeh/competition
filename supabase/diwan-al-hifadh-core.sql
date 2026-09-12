-- "اختبارات ديوان الحفاظ - فرع الكورة": نظام مراحل متتالية (١ → ٢ → ٣ → نهائي)، كل مشارك حافظ
-- كامل بالتعريف والاختبار غرضه التصديق فقط. اللجان مشتركة تماماً مع السنوية — نفس حساب/رمز/PIN
-- المُضاف من "الإعدادات ← إدارة لجان الاختبار" (جدول public.committees ودوال committee_login/
-- committee_resume/committee_from_token/committee_role_from_token الموجودة أصلاً) يمتحن الطرفين
-- معاً، بلا أي حساب أو تسجيل دخول منفصل ثانٍ.
--
-- نسخة ثانية (تُلغي وتستبدل النسخة الأولى المسطّحة بالكامل — لا بيانات حقيقية موجودة، مؤكَّد من
-- صاحب المنصة): تدعم عدة محاولات/مراحل لكل مشارك (كل محاولة = سحب + جلسة مستقلة، تُحفظ كتاريخ
-- كامل ولا تُمحى أبداً)، بعلامة نجاح 80 (مختلفة عن السنوية)، بدل قيد "جلسة واحدة لكل مشارك مدى
-- الحياة" بالنسخة الأولى. نفّذ هذا الملف كاملاً من SQL Editor — يُسقط جدول diwan_exam_sessions
-- القديم بالكامل (فارغ فعلياً) ويعيد إنشاءه بالشكل الجديد.

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

-- إعادة إنشاء كاملة (لا بيانات حقيقية): القيد الفريد صار على draw_id لا participant_id، لأن
-- المشارك الواحد الآن له عدة صفوف عبر الزمن (محاولة لكل مرحلة + كل إعادة محاولة عند الرسوب).
-- عمود stage جديد (1/2/3/4، حيث 4=الاختبار النهائي) لتصنيف كل محاولة بمرحلتها.
drop table if exists public.diwan_exam_sessions cascade;
create table public.diwan_exam_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null,
  draw_id text not null unique,
  committee_id uuid not null references public.committees(id),
  stage smallint not null check (stage between 1 and 4),
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
create index diwan_exam_sessions_participant_idx on public.diwan_exam_sessions(participant_id);

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

-- التوقيعات القديمة (نسخة أولى مسطّحة) — إسقاط صريح لمنع بقاء نسخة زائدة (overload) بعد تغيير المعاملات.
drop function if exists public.diwan_committee_claim_student(text,text,text,smallint,text);
drop function if exists public.diwan_committee_cancel_session(text,text);
drop function if exists public.diwan_admin_delete_participant_session(text);

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

-- بدء اختبار متسابق (أول دخول للجنة على هذا السحب بعينه — draw_id وليس participant_id، لأن
-- نفس المشارك قد يملك سحوباً/جلسات سابقة من مراحل أو محاولات ماضية يجب ألا تتأثر). يمنع لجنة
-- ثانية تبدأ نفس السحب لو سبق وبدأته لجنة أخرى، يمنع نفس اللجنة من بدء سحب جديد قبل إنهاء/إلغاء
-- اختبارها الجاري (نفس تحصين committee_claim_student بالسنوية، المصدر: committee-single-active-
-- exam.sql)، ويمنع اللجنة من امتحان مستوى غير مخصَّص لها أصلاً (نفس فحص committee-claim-
-- transferred-level.sql) — كل هذا على مستوى القاعدة نفسها، لأن فلترة الواجهة وحدها لا تكفي.
create or replace function public.diwan_committee_claim_student(
  p_token text,p_participant_id text,p_draw_id text,p_stage smallint,p_level smallint,p_level_name text default null
) returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.diwan_exam_sessions; v_active_name text; v_transfer_committee_id text;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select p.name into v_active_name
  from public.diwan_exam_sessions es
  left join lateral (
    select item->>'name' as name from public.diwan_state ds,
      jsonb_array_elements(coalesce(ds.payload->'participants','[]')) item
    where ds.id=1 and item->>'id'=es.participant_id limit 1
  ) p on true
  where es.committee_id=v_committee.id and es.status='in_progress' and es.draw_id<>p_draw_id
  limit 1;
  if v_active_name is not null then
    raise exception 'لجنتكم تختبر حاليًا «%» — أنهوا أو ألغوا اختباره أولاً قبل بدء متسابق جديد',v_active_name;
  end if;
  select item->>'transferCommitteeId' into v_transfer_committee_id
  from public.diwan_state ds, jsonb_array_elements(coalesce(ds.payload->'participants','[]')) item
  where ds.id=1 and item->>'id'=p_participant_id limit 1;
  if not (p_level=any(v_committee.levels)) and coalesce(v_transfer_committee_id,'')<>v_committee.id::text then
    raise exception 'هذا المستوى غير مخصص لهذه اللجنة';
  end if;
  select * into v_session from public.diwan_exam_sessions where draw_id=p_draw_id;
  if v_session.id is not null and v_session.committee_id<>v_committee.id then raise exception 'بدأت لجنة أخرى امتحان هذا المتسابق'; end if;
  if v_session.id is null then
    insert into public.diwan_exam_sessions(participant_id,draw_id,committee_id,stage,level,level_name)
    values(p_participant_id,p_draw_id,v_committee.id,p_stage,p_level,p_level_name) returning * into v_session;
  end if;
  return v_session;
end $$;

-- حفظ مسودة/اعتماد تقييم بمُصحّحين (رئيس/عضو) — نفس منطق committee_save_session بالسنوية بالضبط
-- (المصدر الحقيقي الأحدث: committee-finalize-race-guard.sql وليس two-examiners.sql)، بما فيه
-- قراءة can_edit_final مباشرة من نفس صف اللجنة المشتركة (لا حقل مستقل لديوان الحفاظ)، وحماية
-- تجاهل أي مسودة تلقائية متأخرة تصل بعد الاعتماد النهائي (نفس خلل "العلامة رجعت 100" الذي صار
-- بالسنوية فعلياً). التوصية (assessment.recommendation) تُحفظ ضمن p_assessment كما هي، بلا أي
-- تعديل بتوقيع الدالة.
create or replace function public.diwan_committee_save_session(
  p_token text,p_session_id uuid,p_assessment jsonb,p_status text,p_score numeric
) returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.diwan_exam_sessions; v_role text; v_saved jsonb; v_old_status text; v_was_revision boolean;
begin
  v_committee=public.committee_from_token(p_token);v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_status not in ('in_progress','final') then raise exception 'حالة التقييم غير صالحة'; end if;
  select * into v_session from public.diwan_exam_sessions where id=p_session_id and committee_id=v_committee.id for update;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة أو ألغتها الإدارة'; end if;
  v_old_status=v_session.status;v_was_revision=v_session.is_final_revision;
  if p_status='final' and v_role<>'chairman' then raise exception 'اعتماد النتيجة متاح لرئيس اللجنة فقط'; end if;
  if v_session.status='final' and p_status='in_progress' and v_role<>'chairman' then raise exception 'إعادة فتح النتيجة متاحة لرئيس اللجنة فقط'; end if;
  if (v_session.status='final' or v_session.is_final_revision) and not v_committee.can_edit_final then raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة'; end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then raise exception 'العلامة النهائية غير صالحة'; end if;
  if v_session.status='final' and p_status='in_progress' and coalesce(p_assessment->'revisions'->-1->>'type','')<>'reopened-final' then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
      'ignored_stale_diwan_draft_after_final','participant',v_session.participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
        'examiner_role',v_role,'session_id',v_session.id));
    return v_session;
  end if;
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
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
    case when v_old_status='final' and p_status='in_progress' then 'reopen_diwan_final_result'
      when v_was_revision and p_status='final' then 'revise_diwan_final_result'
      when p_status='final' then 'finalize_diwan' else 'save_diwan_examiner_draft' end,
    'participant',v_session.participant_id,jsonb_build_object('committee_id',v_committee.id,
      'committee_name',v_committee.name,'examiner_role',v_role,'session_id',v_session.id,
      'new_score',p_score,'assessment',p_assessment));
  return v_session;
end $$;

-- جلسة واحدة بعينها مقيّدة بلجنة صاحب الرمز — لمزامنة موضع الرئيس أثناء رصد العضو (نفس فكرة
-- committee_get_session بالسنوية، المصدر: exam-sessions-tiered-realtime.sql).
create or replace function public.diwan_committee_get_session(p_token text,p_session_id uuid)
returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.diwan_exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select * into v_session from public.diwan_exam_sessions where id=p_session_id and committee_id=v_committee.id;
  return v_session;
end $$;

-- تغيير موضع أثناء الاختبار (اعتذار الطالب عن القراءة من موضع) — رئيس اللجنة فقط، بحد أقصى
-- مرتين إجمالاً لكل محاولة (نفس قيد committee_replace_position بالسنوية، المصدر: committee-
-- position-change-limit.sql). يعدّل diwan_state.draws ومسودة الرئيس بهذه الجلسة (draw_id
-- تحديداً — لا participant_id وحده، لوجود محاولات/جلسات تاريخية أخرى لنفس المشارك) بمعاملة واحدة.
create or replace function public.diwan_committee_replace_position(
  p_token text,p_participant_id text,p_draw_id text,p_position_index integer,p_position jsonb,p_assessment jsonb
) returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_draw jsonb; v_old jsonb; v_positions jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if public.committee_role_from_token(p_token)<>'chairman' then raise exception 'تغيير الموضع متاح لرئيس اللجنة فقط'; end if;
  perform 1 from public.diwan_exam_sessions where draw_id=p_draw_id
    and committee_id=v_committee.id and status='in_progress' for update;
  if not found then raise exception 'لا يمكن تعديل هذا السحب من هذه اللجنة'; end if;
  select payload into v_payload from public.diwan_state where id=1 for update;
  select item into v_draw from jsonb_array_elements(coalesce(v_payload->'draws','[]'::jsonb)) item where item->>'id'=p_draw_id limit 1;
  if v_draw is null then raise exception 'السحب غير موجود'; end if;
  if jsonb_array_length(coalesce(v_draw->'rerolls','[]'::jsonb))>=2 then
    raise exception 'تم استخدام الحد الأقصى لتبديل الموضع (مرتان) لهذا المتسابق';
  end if;
  v_old=v_draw->'positions'->p_position_index;
  v_positions=jsonb_set(v_draw->'positions',array[p_position_index::text],p_position,false);
  v_draw=jsonb_set(v_draw,'{positions}',v_positions,true);
  v_draw=jsonb_set(v_draw,'{rerolls}',coalesce(v_draw->'rerolls','[]'::jsonb)||jsonb_build_array(jsonb_build_object('positionIndex',p_position_index,'at',now())),true);
  v_payload=jsonb_set(v_payload,'{draws}',(
    select jsonb_agg(case when item->>'id'=p_draw_id then v_draw else item end) from jsonb_array_elements(v_payload->'draws') item),true);
  update public.diwan_state set payload=v_payload,updated_at=now() where id=1;
  update public.diwan_exam_sessions set assessment=jsonb_set(jsonb_set(coalesce(assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(assessment->'examinerDrafts','{}'::jsonb),true),'{examinerDrafts,chairman}',p_assessment,true),updated_at=now()
    where draw_id=p_draw_id and committee_id=v_committee.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'replace_diwan_exam_position','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,'draw_id',p_draw_id,
        'position_index',p_position_index,'old_position',v_old,'new_position',p_position));
  return jsonb_build_object('draw',v_draw,'assessment',p_assessment);
end $$;

-- إلغاء اللجنة لاختبار بدأته هي بنفسها طالما لم يُعتمد بعد (status='in_progress') — رئيس اللجنة
-- فقط (نفس فحص committee_cancel_session بالسنوية، المصدر: committee-cancel-exam.sql). مفتاح
-- draw_id لا participant_id، لتحديد المحاولة الجارية تحديداً بلا لبس مع محاولات سابقة. يمنع
-- إلغاء نتيجة معتمدة (لهذا تُستخدم diwan_admin_delete_participant_draw)، ويمنع لجنة من إلغاء
-- اختبار بدأته لجنة أخرى.
create or replace function public.diwan_committee_cancel_session(p_token text,p_draw_id text)
returns void language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_role text; v_session public.diwan_exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if v_role<>'chairman' then raise exception 'إلغاء الاختبار متاح لرئيس اللجنة فقط'; end if;
  select * into v_session from public.diwan_exam_sessions where draw_id=p_draw_id for update;
  if v_session.id is null then return; end if;
  if v_session.committee_id<>v_committee.id then raise exception 'لا يمكن إلغاء اختبار بدأته لجنة أخرى'; end if;
  if v_session.status='final' then raise exception 'لا يمكن إلغاء نتيجة معتمدة من هنا'; end if;
  delete from public.diwan_exam_sessions where id=v_session.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'cancel_diwan_exam_session','participant',v_session.participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name));
end $$;

grant execute on function public.diwan_committee_load_state(text) to anon,authenticated;
grant execute on function public.diwan_committee_list_sessions(text) to anon,authenticated;
grant execute on function public.diwan_committee_claim_student(text,text,text,smallint,smallint,text) to anon,authenticated;
grant execute on function public.diwan_committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;
grant execute on function public.diwan_committee_cancel_session(text,text) to anon,authenticated;
grant execute on function public.diwan_committee_get_session(text,uuid) to anon,authenticated;
grant execute on function public.diwan_committee_replace_position(text,text,text,integer,jsonb,jsonb) to anon,authenticated;

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

-- إنشاء سحب جديد لمشارك — بلا أي منع لتكرار participantId (كان مناسباً بالنسخة المسطّحة القديمة
-- ذات "سحب واحد مدى الحياة"، لكنه يمنع الآن كل مراحل التقدّم اللاحقة وإعادة المحاولة عند الرسوب،
-- وكلاهما مطلوب صراحة). الثقة هنا بالواجهة الإدارية فقط (لا تعرض زر سحب جديد إلا بالحالة الصحيحة)
-- تماماً كبقية عمليات الإدارة الأخرى بهذا النظام.
create or replace function public.diwan_admin_create_draw(p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payload jsonb; v_sequence integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'هذه العملية متاحة للإدارة فقط'; end if;
  select payload into v_payload from public.diwan_state where id=1 for update;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]')||jsonb_build_array(p_draw),true);
  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return p_draw;
end $$;
grant execute on function public.diwan_admin_create_draw(jsonb) to authenticated;

-- حذف محاولة/جلسة محدَّدة بعينها (draw_id) — لا كل تاريخ المشارك، لأن "تتبع كامل" يتطلب إبقاء كل
-- محاولة سابقة كسجل تاريخي. تُستخدم لتصحيح خطأ إداري بمحاولة بعينها فقط.
create or replace function public.diwan_admin_delete_participant_draw(p_draw_id text)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.diwan_exam_sessions where draw_id=p_draw_id;
end $$;
grant execute on function public.diwan_admin_delete_participant_draw(text) to authenticated;
