-- إصلاح خلل "canceling statement due to statement timeout" الذي صار يظهر متكررًا عند حفظ
-- بيانات الإدارة (وبنفس القالب عند المسؤول الفرعي ومشرف المسابقة أيضًا، لأنهم يشتركون بنفس
-- الجسم). السبب: admin_save_state/supervisor_save_state/sub_admin_save_participants كانت
-- تحسب "من بقي كما هو" عبر استعلام متداخل (NOT EXISTS + jsonb_array_elements) يُعاد تفكيك
-- مصفوفة JSON الواردة بالكامل لكل عنصر بالمصفوفة القديمة على حدة — أي تعقيد تقريبي O(ن×م).
-- مع 285 متسابقًا هذا يعني عشرات آلاف عمليات تفكيك JSON بكل عملية حفظ (تصير تلقائيًا كل
-- 450ms بعد أي تعديل)، وتحت الحمل الفعلي أيام الامتحان تتجاوز مهلة قاعدة البيانات وتُلغى
-- العملية بالكامل — أي أن تعديل الإدارة لا يُحفظ إطلاقًا لحد ما ينجح استعلام لاحق.
--
-- الحل: تفكيك كل مصفوفة JSON واردة مرة واحدة فقط بمصفوفة نصية عادية (array_agg)، ثم فحص
-- الانتماء بعدها بعملية O(1) لكل عنصر (= any(مصفوفة نصية)) بدل إعادة تفكيك JSON من جديد في
-- كل مرة. ولاكتشاف "هل تغيّر متسابق فعليًا" (تسجيل السجل)، بدل مقارنة كل وارد بكل قديم عبر
-- NOT EXISTS، نبني خارطة واحدة (jsonb_object_agg مفتاحها id) ثم نقرأ منها بحث مباشر O(1).
--
-- النتيجة مطابقة تمامًا للسلوك القديم حقل بحقل — لا حذف ولا تعديل على أي منطق أو صلاحية أو
-- تسجيل، فقط طريقة حساب أسرع لنفس النتيجة. المصدر الوحيد الحالي لهذه الدوال الثلاث:
-- participant-change-log.sql (يدمج admin-safe-state-merge.sql + supervisor-role.sql +
-- sub-admins-and-committee-upgrade.sql + سطرَي تسجيل التغيير). الجسم أدناه نفسه حرفيًا.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.admin_save_state(
  p_config jsonb,
  p_participants jsonb,
  p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',
  p_deleted_draw_ids text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_others_participants jsonb; v_others_draws jsonb; v_final_participants jsonb; v_final_draws jsonb;
  v_incoming_participant_ids text[]; v_incoming_draw_ids text[]; v_old_participants_by_id jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_draw_ids from jsonb_array_elements(p_draws) n;
  select coalesce(jsonb_object_agg(o->>'id',o),'{}'::jsonb) into v_old_participants_by_id
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o;

  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select n->>'id',n->>'name',now() from jsonb_array_elements(p_participants) n
  where not (
    (v_old_participants_by_id ? (n->>'id'))
    and coalesce(v_old_participants_by_id->(n->>'id')->>'gender','')=coalesce(n->>'gender','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'level','')=coalesce(n->>'level','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'levelName','')=coalesce(n->>'levelName','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'transferCommitteeId','')=coalesce(n->>'transferCommitteeId','')
    and coalesce(v_old_participants_by_id->(n->>'id')->'parts','[]'::jsonb)=coalesce(n->'parts','[]'::jsonb)
  );
  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select o->>'id',o->>'name',now() from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
  where o->>'id'=any(p_deleted_participant_ids);

  -- أي متسابق موجود بالخادم ولم يصل ضمن دفعة الإدارة ولا ضمن المحذوفين يبقى كما هو
  -- (أضافه طرف آخر — مثل مسؤولة الإناث — بعد آخر مزامنة محلية للإدارة).
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

  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return v_payload;
end $$;

grant execute on function public.admin_save_state(jsonb,jsonb,jsonb,text[],text[]) to authenticated;

create or replace function public.supervisor_save_state(
  p_participants jsonb,p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',p_deleted_draw_ids text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_can_edit_final boolean; v_can_delete_data boolean; v_payload jsonb; v_others_participants jsonb; v_others_draws jsonb; v_final_participants jsonb; v_final_draws jsonb;
  v_incoming_participant_ids text[]; v_incoming_draw_ids text[]; v_old_participants_by_id jsonb;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select can_edit_final,can_delete_data into v_can_edit_final,v_can_delete_data from public.profiles where id=auth.uid();

  if not v_can_delete_data and (cardinality(p_deleted_participant_ids)>0 or cardinality(p_deleted_draw_ids)>0) then
    raise exception 'حذف بيانات المتسابقين أو السحوبات يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب';
  end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  if not v_can_edit_final and exists(
    select 1 from jsonb_array_elements(p_participants) n
    join jsonb_array_elements(coalesce(v_payload->'participants','[]')) old on old->>'id'=n->>'id'
    where old->>'scoreSource'='electronic' and coalesce(old->>'score','')<>coalesce(n->>'score','')
  ) then
    raise exception 'تعديل علامة معتمدة إلكترونيًا يتطلب صلاحية خاصة غير ممنوحة لهذا الحساب';
  end if;

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_draw_ids from jsonb_array_elements(p_draws) n;
  select coalesce(jsonb_object_agg(o->>'id',o),'{}'::jsonb) into v_old_participants_by_id
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o;

  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select n->>'id',n->>'name',now() from jsonb_array_elements(p_participants) n
  where not (
    (v_old_participants_by_id ? (n->>'id'))
    and coalesce(v_old_participants_by_id->(n->>'id')->>'gender','')=coalesce(n->>'gender','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'level','')=coalesce(n->>'level','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'levelName','')=coalesce(n->>'levelName','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'transferCommitteeId','')=coalesce(n->>'transferCommitteeId','')
    and coalesce(v_old_participants_by_id->(n->>'id')->'parts','[]'::jsonb)=coalesce(n->'parts','[]'::jsonb)
  );
  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select o->>'id',o->>'name',now() from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
  where o->>'id'=any(p_deleted_participant_ids);

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

  v_payload=jsonb_set(v_payload,'{participants}',v_final_participants,true);
  v_payload=jsonb_set(v_payload,'{draws}',v_final_draws,true);

  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return jsonb_build_object('participants',v_final_participants,'draws',v_final_draws);
end $$;
grant execute on function public.supervisor_save_state(jsonb,jsonb,text[],text[]) to authenticated;

create or replace function public.sub_admin_save_participants(p_token text,p_participants jsonb,p_deleted_ids text[] default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_others jsonb; v_final jsonb; v_draws jsonb;
  v_incoming_participant_ids text[]; v_old_participants_by_id jsonb;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) item where item->>'gender'<>v_admin.gender) then
    raise exception 'لا يمكن إضافة أو تعديل متسابق من جنس مختلف عن صلاحية هذا الحساب';
  end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(jsonb_object_agg(o->>'id',o),'{}'::jsonb) into v_old_participants_by_id
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o;

  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select n->>'id',n->>'name',now() from jsonb_array_elements(p_participants) n
  where not (
    (v_old_participants_by_id ? (n->>'id'))
    and coalesce(v_old_participants_by_id->(n->>'id')->>'gender','')=coalesce(n->>'gender','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'level','')=coalesce(n->>'level','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'levelName','')=coalesce(n->>'levelName','')
    and coalesce(v_old_participants_by_id->(n->>'id')->>'transferCommitteeId','')=coalesce(n->>'transferCommitteeId','')
    and coalesce(v_old_participants_by_id->(n->>'id')->'parts','[]'::jsonb)=coalesce(n->'parts','[]'::jsonb)
  );
  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select o->>'id',o->>'name',now() from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
  where o->>'id'=any(p_deleted_ids);

  -- كل ما ليس من جنس الحساب، أو من جنسه لكن لم يُرسَل ضمن الدفعة ولا ضمن المحذوفين، يبقى كما هو
  select coalesce(jsonb_agg(item),'[]') into v_others
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where item->>'gender'<>v_admin.gender
     or (not (item->>'id'=any(p_deleted_ids)) and not (item->>'id'=any(v_incoming_participant_ids)));
  v_final=v_others||p_participants;
  v_payload=jsonb_set(v_payload,'{participants}',v_final,true);
  if cardinality(p_deleted_ids)>0 then
    select coalesce(jsonb_agg(item),'[]') into v_draws
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where not (item->>'participantId'=any(p_deleted_ids));
    v_payload=jsonb_set(v_payload,'{draws}',v_draws,true);
  end if;

  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'sub_admin_save_participants','participant','batch',
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,'gender',v_admin.gender,
        'count',jsonb_array_length(p_participants),'deleted_count',cardinality(p_deleted_ids)));
  return v_payload;
end $$;
grant execute on function public.sub_admin_save_participants(text,jsonb,text[]) to anon,authenticated;
