-- حماية إضافية على مستوى قاعدة البيانات (طبقة دفاع ثانية) لخلل حقيقي صار: مسودة تلقائية
-- متأخرة (queueSessionSave بـ cloud.js، تُرسل دائمًا حالة 'in_progress' وعلامة فارغة) وصلت
-- للسيرفر بعد اعتماد رئيس اللجنة للنتيجة النهائية مباشرة، فرجّعت الجلسة لحالة "قيد الاختبار"
-- بعلامة فارغة رغم اعتماد نتيجة راسبة قبلها بلحظات — وهذا ما كان يُظهر لاحقًا للجنة أن علامة
-- المتسابق رجعت 100 عند إعادة بناء تقييم فارغ له. تم إصلاح المصدر بجهة المتصفح (cancelQueuedSessionSave
-- بـ cloud.js تُستدعى الآن قبل أي حفظ مباشر) — هذا الملف طبقة حماية إضافية على السيرفر نفسه،
-- تحمي حتى لو تكرر نفس النمط من خلل مختلف بالمستقبل أو من إعادة إرسال طلب بسبب مشكلة شبكة.
--
-- الفكرة: أي حفظ عادي (in_progress) يصل لجلسة "معتمدة نهائيًا" أصلاً يُتجاهل بصمت (ترجع
-- الجلسة كما هي دون تعديل) بدل ما يُنزلها لحالة "قيد الاختبار" — إلا إذا كان الطلب فعليًا
-- عملية "إعادة فتح النتيجة" المتعمَّدة من زر "تعديل النتيجة المعتمدة"، والتي تُعلَّم بإضافة
-- سجل {"type":"reopened-final",...} كآخر عنصر بمصفوفة assessment.revisions (reopenFinalAssessment
-- بـ app.js تضيفها فعلاً قبل الحفظ) — أي مسودة روتينية عادية لا تحمل هذه العلامة إطلاقاً.
-- هذا التمييز لا يحتاج أي تعديل على واجهة الدالة (نفس المعاملات الخمسة تمامًا) فلا حاجة لتزامن
-- نشر هذا الملف مع أي تحديث بالموقع — شغّله وقتما تحب.
--
-- المصدر الوحيد الحالي لدالة committee_save_session: two-examiners.sql (تعتمد على أعمدة
-- can_edit_final وis_final_revision المضافة بـ exam-readiness-hardening.sql). الجسم أدناه
-- نفس الجسم الأصلي حرفيًا + الفحص الجديد فقط قبل سطر تحديث الجدول مباشرة.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.committee_save_session(
  p_token text,p_session_id uuid,p_assessment jsonb,p_status text,p_score numeric
) returns public.exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees;v_session public.exam_sessions;v_role text;v_saved jsonb;v_old_status text;v_was_revision boolean;
begin
  v_committee=public.committee_from_token(p_token);v_role=public.committee_role_from_token(p_token);
  if v_committee.id is null or v_role is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_status not in ('in_progress','final') then raise exception 'حالة التقييم غير صالحة'; end if;
  select * into v_session from public.exam_sessions where id=p_session_id and committee_id=v_committee.id for update;
  if v_session.id is null then raise exception 'جلسة الامتحان غير موجودة أو ألغتها الإدارة'; end if;
  v_old_status=v_session.status;v_was_revision=v_session.is_final_revision;
  if p_status='final' and v_role<>'chairman' then raise exception 'اعتماد النتيجة متاح لرئيس اللجنة فقط'; end if;
  if v_session.status='final' and p_status='in_progress' and v_role<>'chairman' then raise exception 'إعادة فتح النتيجة متاحة لرئيس اللجنة فقط'; end if;
  if (v_session.status='final' or v_session.is_final_revision) and not v_committee.can_edit_final then raise exception 'لا تملك اللجنة صلاحية تعديل النتائج المعتمدة'; end if;
  if p_status='final' and (p_score is null or p_score<0 or p_score>100) then raise exception 'العلامة النهائية غير صالحة'; end if;
  -- الحماية الجديدة: تجاهل أي حفظ in_progress عادي يصل بعد الاعتماد ما لم يحمل علامة إعادة
  -- الفتح الصريحة، بدل ما يُنزل النتيجة المعتمدة بالغلط.
  if v_session.status='final' and p_status='in_progress' and coalesce(p_assessment->'revisions'->-1->>'type','')<>'reopened-final' then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
      'ignored_stale_draft_after_final','participant',v_session.participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,
        'examiner_role',v_role,'session_id',v_session.id));
    return v_session;
  end if;
  if p_status='in_progress' then
    v_saved=jsonb_set(jsonb_set(coalesce(v_session.assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb),true),array['examinerDrafts',v_role],p_assessment,true);
  else
    v_saved=p_assessment||jsonb_build_object('examinerDrafts',coalesce(v_session.assessment->'examinerDrafts','{}'::jsonb));
  end if;
  update public.exam_sessions set assessment=v_saved,status=p_status,
    score=case when p_status='final' then p_score else null end,updated_at=now(),
    finalized_at=case when p_status='final' then now() else finalized_at end,
    is_final_revision=case when v_session.status='final' and p_status='in_progress' then true when p_status='final' then false else v_session.is_final_revision end
    where id=p_session_id returning * into v_session;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details) values(null,
    case when v_old_status='final' and p_status='in_progress' then 'reopen_final_result'
      when v_was_revision and p_status='final' then 'revise_final_result'
      when p_status='final' then 'finalize' else 'save_examiner_draft' end,
    'participant',v_session.participant_id,jsonb_build_object('committee_id',v_committee.id,
      'committee_name',v_committee.name,'examiner_role',v_role,'session_id',v_session.id,
      'new_score',p_score,'assessment',p_assessment));
  return v_session;
end $$;

grant execute on function public.committee_save_session(text,uuid,jsonb,text,numeric) to anon,authenticated;
