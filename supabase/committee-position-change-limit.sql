-- حد أقصى مرّتين لتبديل الموضع (السؤال/الصفحة) لكل متسابق، إجمالاً عبر كل مواضع سحبه
-- (وليس لكل موضع على حدة) — يمنع اللجان من إعادة السحب بحثًا عن موضع أسهل. يستخدم حقل
-- draws[].rerolls الموجود أصلاً في بنية السحب (يُهيَّأ فارغًا عند كل سحب) كعدّاد إجمالي.
-- نسخة معدَّلة من committee_replace_position (المصدر الوحيد: committee-live-draw.sql) —
-- نفس الجسم الأصلي حرفيًا + فحص الحد الأقصى + تسجيل كل استبدال ناجح في rerolls.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.committee_replace_position(
  p_token text,p_participant_id text,p_draw_id text,p_position_index integer,p_position jsonb,p_assessment jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_draw jsonb; v_old jsonb; v_positions jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if public.committee_role_from_token(p_token)<>'chairman' then raise exception 'تغيير الموضع متاح لرئيس اللجنة فقط'; end if;
  perform 1 from public.exam_sessions where participant_id=p_participant_id and draw_id=p_draw_id
    and committee_id=v_committee.id and status='in_progress' for update;
  if not found then raise exception 'لا يمكن تعديل هذا السحب من هذه اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  select item into v_draw from jsonb_array_elements(v_payload->'draws') item where item->>'id'=p_draw_id limit 1;
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
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  update public.exam_sessions set assessment=jsonb_set(jsonb_set(coalesce(assessment,'{}'::jsonb),'{examinerDrafts}',coalesce(assessment->'examinerDrafts','{}'::jsonb),true),'{examinerDrafts,chairman}',p_assessment,true),updated_at=now()
    where participant_id=p_participant_id and committee_id=v_committee.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'replace_exam_position','participant',p_participant_id,
      jsonb_build_object('committee_id',v_committee.id,'committee_name',v_committee.name,'draw_id',p_draw_id,
        'position_index',p_position_index,'old_position',v_old,'new_position',p_position));
  return jsonb_build_object('draw',v_draw,'assessment',p_assessment);
end $$;
grant execute on function public.committee_replace_position(text,text,text,integer,jsonb,jsonb) to anon,authenticated;
