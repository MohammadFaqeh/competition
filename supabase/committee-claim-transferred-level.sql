-- عطل: نقل متسابق (بواسطة الإداري/مشرف المسابقة) للجنة لا تخدم مستواه الأصلي كان يظهر
-- المتسابق عندها بنجاح (participant-transfer.sql يتحكم بالظهور فقط عبر transferCommitteeId)،
-- لكن عند ضغط اللجنة "بدء تسجيل الأخطاء" كان يُرفض بخطأ "هذا المستوى غير مخصص لهذه اللجنة" —
-- لأن committee_claim_student (exam-readiness-hardening.sql) يتحقق فقط من مطابقة مستوى
-- المتسابق لمستويات اللجنة (v_committee.levels)، بلا أي علم بالنقل اليدوي الصريح.
--
-- الحل: تجاوز فحص تطابق المستوى فقط عندما يكون المتسابق منقولاً صراحةً إلى هذه اللجنة بالذات
-- (participants[].transferCommitteeId = هذه اللجنة) — أي نقل إداري متعمد يُعتبر تصريحاً
-- كافياً، بينما الحالة الطبيعية (بلا نقل) تبقى محكومة بمطابقة المستوى كما كانت تمامًا.
--
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية (يعتمد على transferCommitteeId من
-- participant-transfer.sql).
create or replace function public.committee_claim_student(
  p_token text,p_participant_id text,p_draw_id text,p_level smallint
) returns public.exam_sessions
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.exam_sessions; v_transfer_committee_id text;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;

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
