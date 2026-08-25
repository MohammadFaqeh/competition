-- إعادة تثبيت (لا تعديل) الجسم الصحيح والموثّق لدالة committee_load_state، لأن قاعدة
-- بيانات الإنتاج على الأرجح ما زالت تشغّل نسخة أقدم منها بلا فلترة الجنس (من
-- committee-live-draw.sql أو exam-readiness-hardening.sql)، وهذا بالضبط ما يفسّر
-- ظهور تنبيهات/متسابقين من الجنس الآخر عند لجنة اختبار واحدة (مثال: لجنة إناث تستقبل
-- تنبيه "لم يعد المتسابق [اسم ذكر] ضمن لجنتكم"، رغم أنه لم يكن يجب أن يظهر عندها إطلاقًا).
--
-- هذا الملف لا يضيف منطقًا جديدًا؛ هو نفس تعريف committee_load_state المُدقَّق في
-- supabase/participant-transfer.sql بالضبط (يدمج فلترة الجنس + مطابقة levelName/level +
-- أولوية transferCommitteeId عند النقل اليدوي + قفل exam_sessions). أعد تنفيذه هنا فقط
-- ليضمن أن آخر نسخة صحيحة هي الفعلية على قاعدة البيانات، بغضّ النظر عن ترتيب تنفيذ
-- ملفات الهجرة السابقة يدويًا.
--
-- طريقة التطبيق: انسخ محتوى هذا الملف بالكامل، الصقه في Supabase Dashboard ← SQL Editor،
-- ثم اضغط Run. التنفيذ آمن ومكرَّر (create or replace) ولا يمسّ أي بيانات موجودة.

create or replace function public.committee_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_participants jsonb; v_draws jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(item),'[]') into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where (v_committee.responsible_gender is null or item->>'gender'=v_committee.responsible_gender)
    and (
      case when nullif(item->>'transferCommitteeId','') is not null
        then (item->>'transferCommitteeId')::uuid = v_committee.id
        else (
          (nullif(item->>'levelName','') is not null and (item->>'levelName')=any(v_committee.level_names))
          or (nullif(item->>'levelName','') is null and (item->>'level')::smallint=any(v_committee.levels))
        )
      end
    )
    and not exists(select 1 from public.exam_sessions s where s.participant_id=item->>'id' and s.committee_id<>v_committee.id);
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where exists(select 1 from jsonb_array_elements(v_participants) participant where participant->>'id'=item->>'participantId');
  return jsonb_set(jsonb_set(v_payload,'{participants}',v_participants,true),'{draws}',v_draws,true)-'deletions'-'resets';
end $$;
grant execute on function public.committee_load_state(text) to anon,authenticated;
