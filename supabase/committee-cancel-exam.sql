-- يسمح لرئيس/ة اللجنة (وليس العضو) بإلغاء اختبار بدأته اللجنة بالغلط (مثلاً دخلوا على متسابق
-- خطأ) طالما لم يُعتمد بعد، لإعادة المتسابق لحالة "جاهز للاختبار" من جديد بدون المساس بالسحب
-- أو المواضع. لا يعمل إطلاقاً على جلسة معتمدة (status='final') — تلك لها مسار منفصل (إعادة الفتح
-- عبر committee_save_session، بصلاحية can_edit_final).
-- شغّل هذا الملف كاملاً مرة واحدة في Supabase SQL Editor.

create or replace function public.committee_cancel_session(p_token text,p_participant_id text)
returns void
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_role text; v_session public.exam_sessions;
begin
  v_committee=public.committee_from_token(p_token);
  v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if v_role<>'chairman' then raise exception 'إلغاء الاختبار متاح لرئيس اللجنة فقط'; end if;

  select * into v_session from public.exam_sessions
    where participant_id=p_participant_id and committee_id=v_committee.id;
  if v_session.id is null then raise exception 'لا يوجد اختبار جارٍ لهذا المتسابق'; end if;
  if v_session.status<>'in_progress' then raise exception 'لا يمكن إلغاء اختبار مُعتمد؛ استخدم إعادة الفتح بدلاً من ذلك'; end if;

  delete from public.exam_sessions where id=v_session.id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'cancel_exam_session','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name));
end $$;
grant execute on function public.committee_cancel_session(text,text) to anon,authenticated;
