-- التراجع عن تغيير الموضع أثناء الاختبار (لو ضغطه رئيس اللجنة بالخطأ) — بالسنوية وديوان الحفاظ.
-- يعيد الموضع السابق نفسه إلى السحب (لا موضعاً جديداً)، ويُعلِّم آخر محاولة تبديل لهذا الموضع
-- بـundone=true بدل حذفها: المحاولة تبقى محسوبة ضمن حد المرّتين لكل متسابق، فلا يمكن استخدام
-- "تغيير ثم تراجع" للتنقل بين المواضع بحثاً عن الأسهل.
-- الموضع المُعاد يُؤخذ من سجل التدقيق (audit_log → old_position) متى وُجد — مصدر موثوق كتبه
-- الخادم لحظة التبديل — وما يرسله المتصفح يجب أن يطابقه. لو حُذف السجل (يُنظَّف بعد 24 ساعة)
-- يُقبل موضع المتصفح بشرط أن يكون من الجزء نفسه وغير مكرر بالسحب (نفس مستوى الثقة بدالة التبديل).
-- لا يعدّل committee_replace_position ولا diwan_committee_replace_position إطلاقاً.
-- نفّذ هذا الملف بعد committee-position-change-limit.sql وdiwan-al-hifadh-core.sql.

create or replace function public.committee_undo_position_change(
  p_token text,p_participant_id text,p_draw_id text,p_position_index integer,p_old_position jsonb,p_assessment jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_draw jsonb; v_current jsonb; v_restore jsonb;
  v_logged jsonb; v_rerolls jsonb; v_reroll_ord integer; v_positions jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if public.committee_role_from_token(p_token) is distinct from 'chairman' then raise exception 'التراجع عن تغيير الموضع متاح لرئيس اللجنة فقط'; end if;
  perform 1 from public.exam_sessions where participant_id=p_participant_id and draw_id=p_draw_id
    and committee_id=v_committee.id and status='in_progress' for update;
  if not found then raise exception 'لا يمكن تعديل هذا السحب من هذه اللجنة'; end if;
  if p_position_index is null or p_position_index<0 then raise exception 'رقم الموضع غير صالح'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  select item into v_draw from jsonb_array_elements(v_payload->'draws') item where item->>'id'=p_draw_id limit 1;
  if v_draw is null then raise exception 'السحب غير موجود'; end if;
  v_current=v_draw->'positions'->p_position_index;
  if v_current is null then raise exception 'الموضع غير موجود بهذا السحب'; end if;
  v_rerolls=coalesce(v_draw->'rerolls','[]'::jsonb);
  select ord into v_reroll_ord from jsonb_array_elements(v_rerolls) with ordinality r(item,ord)
    where item->>'positionIndex'=p_position_index::text and coalesce(item->>'undone','false')<>'true'
    order by ord desc limit 1;
  if v_reroll_ord is null then raise exception 'لا يوجد تغيير موضع للتراجع عنه'; end if;
  select details->'old_position' into v_logged from public.audit_log
    where action='replace_exam_position' and entity_id=p_participant_id and details->>'draw_id'=p_draw_id
      and details->>'position_index'=p_position_index::text and details->'new_position'->>'id'=v_current->>'id'
    order by id desc limit 1;
  if v_logged is not null and jsonb_typeof(v_logged)='object' then
    if p_old_position is not null and p_old_position->>'id' is distinct from v_logged->>'id' then
      raise exception 'الموضع السابق لا يطابق سجل التبديل';
    end if;
    v_restore=v_logged;
  else
    if p_old_position is null or jsonb_typeof(p_old_position)<>'object' or p_old_position->>'id' is null then
      raise exception 'الموضع السابق غير معروف';
    end if;
    if p_old_position->>'juz' is distinct from v_current->>'juz' then raise exception 'الموضع السابق ليس من الجزء نفسه'; end if;
    v_restore=p_old_position;
  end if;
  if exists(select 1 from jsonb_array_elements(v_draw->'positions') with ordinality p(item,ord)
    where ord-1<>p_position_index and item->>'id'=v_restore->>'id') then
    raise exception 'الموضع السابق مستخدم بموضع آخر من السحب نفسه';
  end if;
  v_positions=jsonb_set(v_draw->'positions',array[p_position_index::text],v_restore,false);
  v_draw=jsonb_set(v_draw,'{positions}',v_positions,true);
  v_rerolls=jsonb_set(v_rerolls,array[(v_reroll_ord-1)::text],(v_rerolls->(v_reroll_ord-1)::integer)||jsonb_build_object('undone',true,'undoneAt',now()),false);
  v_draw=jsonb_set(v_draw,'{rerolls}',v_rerolls,true);
  v_payload=jsonb_set(v_payload,'{draws}',(
    select jsonb_agg(case when item->>'id'=p_draw_id then v_draw else item end) from jsonb_array_elements(v_payload->'draws') item),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  update public.exam_sessions set assessment=jsonb_set(jsonb_set(coalesce(assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(assessment->'examinerDrafts','{}'::jsonb),true),'{examinerDrafts,chairman}',p_assessment,true),updated_at=now()
    where participant_id=p_participant_id and draw_id=p_draw_id and committee_id=v_committee.id and status='in_progress';
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'undo_replace_exam_position','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,'draw_id',p_draw_id,
        'position_index',p_position_index,'undone_position',v_current,'restored_position',v_restore));
  return jsonb_build_object('draw',v_draw,'assessment',p_assessment);
end $$;
grant execute on function public.committee_undo_position_change(text,text,text,integer,jsonb,jsonb) to anon,authenticated;

create or replace function public.diwan_committee_undo_position_change(
  p_token text,p_participant_id text,p_draw_id text,p_position_index integer,p_old_position jsonb,p_assessment jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_draw jsonb; v_current jsonb; v_restore jsonb;
  v_logged jsonb; v_rerolls jsonb; v_reroll_ord integer; v_positions jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if public.committee_role_from_token(p_token) is distinct from 'chairman' then raise exception 'التراجع عن تغيير الموضع متاح لرئيس اللجنة فقط'; end if;
  perform 1 from public.diwan_exam_sessions where draw_id=p_draw_id
    and committee_id=v_committee.id and status='in_progress' for update;
  if not found then raise exception 'لا يمكن تعديل هذا السحب من هذه اللجنة'; end if;
  if p_position_index is null or p_position_index<0 then raise exception 'رقم الموضع غير صالح'; end if;
  select payload into v_payload from public.diwan_state where id=1 for update;
  select item into v_draw from jsonb_array_elements(coalesce(v_payload->'draws','[]'::jsonb)) item where item->>'id'=p_draw_id limit 1;
  if v_draw is null then raise exception 'السحب غير موجود'; end if;
  v_current=v_draw->'positions'->p_position_index;
  if v_current is null then raise exception 'الموضع غير موجود بهذا السحب'; end if;
  v_rerolls=coalesce(v_draw->'rerolls','[]'::jsonb);
  select ord into v_reroll_ord from jsonb_array_elements(v_rerolls) with ordinality r(item,ord)
    where item->>'positionIndex'=p_position_index::text and coalesce(item->>'undone','false')<>'true'
    order by ord desc limit 1;
  if v_reroll_ord is null then raise exception 'لا يوجد تغيير موضع للتراجع عنه'; end if;
  select details->'old_position' into v_logged from public.audit_log
    where action='replace_diwan_exam_position' and entity_id=p_participant_id and details->>'draw_id'=p_draw_id
      and details->>'position_index'=p_position_index::text and details->'new_position'->>'id'=v_current->>'id'
    order by id desc limit 1;
  if v_logged is not null and jsonb_typeof(v_logged)='object' then
    if p_old_position is not null and p_old_position->>'id' is distinct from v_logged->>'id' then
      raise exception 'الموضع السابق لا يطابق سجل التبديل';
    end if;
    v_restore=v_logged;
  else
    if p_old_position is null or jsonb_typeof(p_old_position)<>'object' or p_old_position->>'id' is null then
      raise exception 'الموضع السابق غير معروف';
    end if;
    if p_old_position->>'juz' is distinct from v_current->>'juz' then raise exception 'الموضع السابق ليس من الجزء نفسه'; end if;
    v_restore=p_old_position;
  end if;
  if exists(select 1 from jsonb_array_elements(v_draw->'positions') with ordinality p(item,ord)
    where ord-1<>p_position_index and item->>'id'=v_restore->>'id') then
    raise exception 'الموضع السابق مستخدم بموضع آخر من السحب نفسه';
  end if;
  v_positions=jsonb_set(v_draw->'positions',array[p_position_index::text],v_restore,false);
  v_draw=jsonb_set(v_draw,'{positions}',v_positions,true);
  v_rerolls=jsonb_set(v_rerolls,array[(v_reroll_ord-1)::text],(v_rerolls->(v_reroll_ord-1)::integer)||jsonb_build_object('undone',true,'undoneAt',now()),false);
  v_draw=jsonb_set(v_draw,'{rerolls}',v_rerolls,true);
  v_payload=jsonb_set(v_payload,'{draws}',(
    select jsonb_agg(case when item->>'id'=p_draw_id then v_draw else item end) from jsonb_array_elements(v_payload->'draws') item),true);
  update public.diwan_state set payload=v_payload,updated_at=now() where id=1;
  update public.diwan_exam_sessions set assessment=jsonb_set(jsonb_set(coalesce(assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(assessment->'examinerDrafts','{}'::jsonb),true),'{examinerDrafts,chairman}',p_assessment,true),updated_at=now()
    where draw_id=p_draw_id and committee_id=v_committee.id and status='in_progress';
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'undo_replace_diwan_exam_position','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,'draw_id',p_draw_id,
        'position_index',p_position_index,'undone_position',v_current,'restored_position',v_restore));
  return jsonb_build_object('draw',v_draw,'assessment',p_assessment);
end $$;
grant execute on function public.diwan_committee_undo_position_change(text,text,text,integer,jsonb,jsonb) to anon,authenticated;
