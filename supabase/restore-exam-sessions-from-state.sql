-- استرجاع جلسات اللجان (exam_sessions) من بيانات المتسابقين المحفوظة في competition_state.
--
-- السبب: يوم 2026-10-07 وُجد جدول exam_sessions فارغاً تماماً (0 جلسات) بينما competition_state
-- (بعد استعادة النسخة الاحتياطية JSON) يحوي 433 متسابقاً قيّمتهم لجان إلكترونياً، ولكل منهم تقييم
-- كامل محفوظ داخله (assessment: examinerDrafts/committee/drawId/startedAt/finalizedAt...). صفحات
-- «مقارنة علامات اللجان» والإحصائيات تقرأ من exam_sessions لا من competition_state، فظهرت فارغة.
--
-- ماذا يفعل: يُنشئ جلسة نهائية (status='final') لكل متسابق scoreSource='electronic' له لجنة موجودة
-- فعلاً بجدول committees — نفس الأعمدة التي تكتبها دوال اللجنة عادةً: المستوى من السحب نفسه
-- (assessment.drawId) كما يفعل committee_draw، والتقييم والعلامة وتوقيتات البدء/الاعتماد من المتسابق.
--
-- آمن لإعادة التشغيل: on conflict (participant_id) do nothing — أي متسابق له جلسة أصلاً لا يُلمس.
-- لا يعدّل competition_state ولا committees ولا أي جدول من جداول ديوان الحفاظ. لا يضيف دوال أو صلاحيات.
-- تشغيل لمرة واحدة من Supabase SQL Editor (كل العملية transaction واحدة: إما تنجح كاملة أو لا شيء).

begin;

with p as (
  select e
  from public.competition_state cs, jsonb_array_elements(cs.payload->'participants') e
  where cs.id=1
),
d as (
  select e as draw
  from public.competition_state cs, jsonb_array_elements(coalesce(cs.payload->'draws','[]'::jsonb)) e
  where cs.id=1
),
src as (
  select
    p.e->>'id' as participant_id,
    coalesce(p.e->'assessment'->>'drawId', dr.draw->>'id') as draw_id,
    (p.e->'assessment'->'committee'->>'id')::uuid as committee_id,
    coalesce((dr.draw->>'level')::smallint, (p.e->>'level')::smallint) as level,
    p.e->>'levelName' as level_name,
    p.e->'assessment' as assessment,
    (p.e->>'score')::numeric(5,2) as score,
    coalesce((p.e->'assessment'->>'startedAt')::timestamptz, (p.e->>'gradedAt')::timestamptz, now()) as started_at,
    coalesce((p.e->'assessment'->>'updatedAt')::timestamptz, (p.e->'assessment'->>'finalizedAt')::timestamptz, (p.e->>'gradedAt')::timestamptz, now()) as updated_at,
    coalesce((p.e->'assessment'->>'finalizedAt')::timestamptz, (p.e->>'gradedAt')::timestamptz, now()) as finalized_at
  from p
  left join lateral (
    select d.draw from d
    where d.draw->>'id' = p.e->'assessment'->>'drawId'
       or (p.e->'assessment'->>'drawId' is null and d.draw->>'participantId' = p.e->>'id')
    order by (d.draw->>'id' = p.e->'assessment'->>'drawId') desc nulls last, d.draw->>'createdAt' desc
    limit 1
  ) dr on true
  where p.e->>'scoreSource' = 'electronic'
    and jsonb_typeof(p.e->'assessment') = 'object'
    and (p.e->'assessment'->'committee'->>'id') in (select id::text from public.committees)
)
insert into public.exam_sessions(participant_id,draw_id,committee_id,level,level_name,status,assessment,score,started_at,updated_at,finalized_at)
select participant_id,draw_id,committee_id,level,level_name,'final',assessment,score,started_at,updated_at,finalized_at
from src
on conflict (participant_id) do nothing;

-- تحقق: يجب أن يطابق عدد الجلسات النهائية عدد المتسابقين الإلكترونيين (433 يوم الاسترجاع).
select count(*) as final_sessions from public.exam_sessions where status='final';

commit;
