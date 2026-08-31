-- يمنع لجنة الاختبار الواحدة من بدء اختبار متسابق جديد طالما عندها اختبار آخر "قيد الاختبار"
-- (in_progress) فعليًا — كان ممكن يصير: رئيس اللجنة يبلش متسابقًا، وبنفس الوقت (بغلط أو
-- بتبويب متصفح ثاني) عضو اللجنة (أو الرئيس نفسه) يبلش متسابقًا آخر، فتظهر اللجنة "تختبر
-- اثنين" بنفس الوقت رغم أنها لجنة واحدة بغرفة اختبار واحدة. هذا القفل على مستوى قاعدة
-- البيانات مباشرة، فلا يمكن تجاوزه من تبويب متصفح ثانٍ أو من تعطّل واجهة الموقع.
--
-- المصدر الوحيد الحالي لدالة committee_claim_student: committee-claim-transferred-level.sql.
-- الجسم أدناه نفسه حرفيًا + الفحص الجديد فقط في أوله. لا علاقة له بقفل "متسابق واحد لدى
-- لجنة واحدة فقط" الموجود أصلاً (unique constraint على exam_sessions.participant_id) —
-- هذا قفل إضافي مختلف: "لجنة واحدة، اختبار واحد قيد التنفيذ بنفس اللحظة".
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.
create or replace function public.committee_claim_student(
  p_token text,p_participant_id text,p_draw_id text,p_level smallint
) returns public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.exam_sessions; v_transfer_committee_id text; v_active_name text;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;

  -- القفل الجديد: لو في جلسة أخرى قيد الاختبار حاليًا عند نفس اللجنة لمتسابق مختلف، امنع
  -- البدء بمتسابق جديد قبل إنهاء أو إلغاء الاختبار الجاري.
  select p.name into v_active_name
  from public.exam_sessions es
  left join lateral (
    select item->>'name' as name from public.competition_state cs,
      jsonb_array_elements(coalesce(cs.payload->'participants','[]')) item
    where cs.id=1 and item->>'id'=es.participant_id limit 1
  ) p on true
  where es.committee_id=v_committee.id and es.status='in_progress' and es.participant_id<>p_participant_id
  limit 1;
  if v_active_name is not null then
    raise exception 'لجنتكم تختبر حاليًا «%» — أنهوا أو ألغوا اختباره أولاً قبل بدء متسابق جديد',v_active_name;
  end if;

  select item->>'transferCommitteeId' into v_transfer_committee_id
  from public.competition_state cs, jsonb_array_elements(coalesce(cs.payload->'participants','[]')) item
  where cs.id=1 and item->>'id'=p_participant_id limit 1;

  if not (p_level=any(v_committee.levels)) and coalesce(v_transfer_committee_id,'')<>v_committee.id::text then
    raise exception 'هذا المستوى غير مخصص لهذه اللجنة';
  end if;

  insert into public.exam_sessions(participant_id,draw_id,committee_id,level)
  values(p_participant_id,p_draw_id,v_committee.id,p_level)
  on conflict(participant_id) do nothing
  returning * into v_session;

  if v_session.id is null then
    select * into v_session from public.exam_sessions
    where participant_id=p_participant_id;
    if v_session.committee_id<>v_committee.id then
      raise exception 'هذا المتسابق قيد الاختبار لدى لجنة أخرى';
    end if;
    if v_session.draw_id<>p_draw_id then
      raise exception 'تم تغيير سحب المتسابق؛ حدّث القائمة قبل المتابعة';
    end if;
  end if;
  return v_session;
end $$;
grant execute on function public.committee_claim_student(text,text,text,smallint) to anon,authenticated;
