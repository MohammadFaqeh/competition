-- نقل حقيقي لمتسابق بين اللجان (يختفي من اللجنة الأصلية ويظهر فقط عند اللجنة الجديدة)
-- بدل خاصية "الإضافة" القديمة (extra_participant_ids) التي كانت تُبقي المتسابق ظاهرًا
-- عند لجنته الأصلية مع إضافته للجنة أخرى، وكانت عرضة لعطل صامت بسبب تعارض عدة نسخ من
-- committee_load_state عبر ملفات الهجرة السابقة (exam-readiness-hardening.sql،
-- committee-live-draw.sql، sub-admins-and-committee-upgrade.sql) — فقط آخر نسخة مُنفَّذة
-- فعليًا كانت تتضمن شرط extra_participant_ids، فأي ترتيب تنفيذ مختلف يُسقطه بصمت.
--
-- الحل: حقل transferCommitteeId على المتسابق نفسه (داخل JSON) يتفوّق على مطابقة المستوى
-- الطبيعية عند وجوده. نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

-- نسخة موحّدة ومدقَّقة من committee_load_state: تدمج كل حقول أحدث نسخة صحيحة
-- (sub-admins-and-committee-upgrade.sql) — فلترة الجنس، مطابقة levelName/level، قفل
-- exam_sessions — مع استبدال شرط extra_participant_ids بمنطق transferCommitteeId.
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

-- نقل متسابق (أدمن): يقفل صف الحالة، يمنع النقل إن كانت النتيجة معتمدة بالفعل، يحذف أي
-- جلسة اختبار غير معتمدة عند اللجنة القديمة (لا يوجد فيها شيء نهائي بعد)، ويكتب
-- transferCommitteeId على المتسابق فقط (تعديل جراحي لعنصر واحد، بلا لمس أي حقل آخر —
-- نفس نمط admin_save_state في admin-safe-state-merge.sql). p_committee_id=null يُلغي
-- النقل ويعيد المتسابق لمطابقة مستواه الطبيعية.
create or replace function public.admin_transfer_participant(p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_participant jsonb; v_to_name text; v_from_name text; v_session public.exam_sessions;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if p_committee_id is not null then
    select name into v_to_name from public.committees where id=p_committee_id and active;
    if v_to_name is null then raise exception 'اللجنة الهدف غير موجودة أو غير مفعّلة'; end if;
  end if;
  select * into v_session from public.exam_sessions where participant_id=p_participant_id;
  if v_session.id is not null then
    if v_session.status='final' then
      raise exception 'لا يمكن نقل متسابق اعتُمدت نتيجته بالفعل — يجب سحب الاعتماد أولاً';
    end if;
    select name into v_from_name from public.committees where id=v_session.committee_id;
    delete from public.exam_sessions where id=v_session.id;
  end if;
  v_payload=jsonb_set(v_payload,'{participants}',(
    select jsonb_agg(case when item->>'id'=p_participant_id
      then jsonb_set(item,'{transferCommitteeId}',coalesce(to_jsonb(p_committee_id::text),'null'::jsonb),true)
      else item end)
    from jsonb_array_elements(v_payload->'participants') item
  ),true);
  update public.competition_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'transfer_participant','participant',p_participant_id,
      jsonb_build_object('participant_name',v_participant->>'name','to_committee_id',p_committee_id,
        'to_committee_name',v_to_name,'from_committee_name',v_from_name));
  return v_payload;
end $$;
grant execute on function public.admin_transfer_participant(text,uuid) to authenticated;

-- نظير المسؤول الفرعي: نفس المنطق بالضبط، مع تحقق تطابق الجنس (نفس نمط
-- sub_admin_assign_participant_to_committee في sub-admins-and-committee-upgrade.sql).
create or replace function public.sub_admin_transfer_participant(p_token text,p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participant jsonb; v_to_name text; v_to_gender text; v_from_name text; v_session public.exam_sessions;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if v_participant->>'gender'<>v_admin.gender then raise exception 'هذا المتسابق خارج صلاحية هذا الحساب'; end if;
  if p_committee_id is not null then
    select name,responsible_gender into v_to_name,v_to_gender from public.committees where id=p_committee_id and active;
    if v_to_name is null then raise exception 'اللجنة الهدف غير موجودة أو غير مفعّلة'; end if;
    if v_to_gender is not null and v_to_gender<>v_admin.gender then raise exception 'هذه اللجنة خارج صلاحية هذا الحساب'; end if;
  end if;
  select * into v_session from public.exam_sessions where participant_id=p_participant_id;
  if v_session.id is not null then
    if v_session.status='final' then
      raise exception 'لا يمكن نقل متسابق اعتُمدت نتيجته بالفعل — يجب سحب الاعتماد أولاً';
    end if;
    select name into v_from_name from public.committees where id=v_session.committee_id;
    delete from public.exam_sessions where id=v_session.id;
  end if;
  v_payload=jsonb_set(v_payload,'{participants}',(
    select jsonb_agg(case when item->>'id'=p_participant_id
      then jsonb_set(item,'{transferCommitteeId}',coalesce(to_jsonb(p_committee_id::text),'null'::jsonb),true)
      else item end)
    from jsonb_array_elements(v_payload->'participants') item
  ),true);
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'transfer_participant','participant',p_participant_id,
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,
        'participant_name',v_participant->>'name','to_committee_id',p_committee_id,
        'to_committee_name',v_to_name,'from_committee_name',v_from_name));
  return v_payload;
end $$;
grant execute on function public.sub_admin_transfer_participant(text,text,uuid) to anon,authenticated;
