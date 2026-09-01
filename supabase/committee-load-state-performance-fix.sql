-- نفس خلل الأداء المُصلَح بـ admin-save-state-performance-fix.sql، بس هون بمكان أخطر بكثير:
-- committee_load_state تُستدعى تلقائيًا كل ~5 ثوانٍ لكل لجنة اختبار مفتوحة (وsub_admin_load_state
-- بنفس الوتيرة تقريبًا للمسؤول/ة الفرعي)، لا فقط عند تعديل فعلي مثل حفظ الإدارة. مع 285
-- متسابقًا وعدد لا بأس به من اللجان المفتوحة بنفس اللحظة أيام الامتحان، هذا يعني عشرات
-- آلاف عمليات تفكيك JSON المتكررة كل 5 ثوانٍ باستمرار — وهو السبب الأرجح لظهور "canceling
-- statement due to statement timeout" عند أكثر من لجنة وعند المسؤولة الفرعي، بمعزل تام عن
-- أي تعديل فعلي من الإدارة.
--
-- نفس الإصلاح بالضبط: تفكيك مصفوفة معرّفات المتسابقين المُفلترة مرة واحدة فقط (array_agg)
-- بدل إعادة تفكيك JSON من جديد لكل سحب على حدة، ثم فحص الانتماء بعملية O(1). لا تغيير على
-- أي شرط تصفية أو صلاحية أو حقل — النتيجة مطابقة تمامًا، فقط أسرع حسابيًا.
--
-- المصدرات الحالية لهاتين الدالتين: committee_load_state من committee-load-state-gender-leak-fix.sql
-- (وهو نفسه المؤكَّد مطابقًا لـ participant-transfer.sql)، وsub_admin_load_state من
-- sub-admin-monitor-and-transfer-fields.sql (النسخة الأحدث المعتمدة). الجسم أدناه نفسه حرفيًا.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.committee_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_participants jsonb; v_draws jsonb; v_participant_ids text[];
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
  select coalesce(array_agg(p->>'id'),'{}') into v_participant_ids from jsonb_array_elements(v_participants) p;
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where (item->>'participantId')=any(v_participant_ids);
  return jsonb_set(jsonb_set(v_payload,'{participants}',v_participants,true),'{draws}',v_draws,true)-'deletions'-'resets';
end $$;
grant execute on function public.committee_load_state(text) to anon,authenticated;

create or replace function public.sub_admin_load_state(p_token text)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participants jsonb; v_draws jsonb; v_committees jsonb; v_participant_ids text[];
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(item),'[]') into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item where item->>'gender'=v_admin.gender;
  select coalesce(array_agg(p->>'id'),'{}') into v_participant_ids from jsonb_array_elements(v_participants) p;
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where (item->>'participantId')=any(v_participant_ids);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'levelNames',level_names,
      'extraParticipantIds',extra_participant_ids,'active',active,
      'chairman_name',chairman_name,'member_name',member_name,'responsible_gender',responsible_gender,
      'level_names',level_names,'levels',levels)),'[]') into v_committees
  from public.committees where responsible_gender is null or responsible_gender=v_admin.gender;
  return jsonb_build_object('config',v_payload->'config','participants',v_participants,'draws',v_draws,'committees',v_committees);
end $$;
grant execute on function public.sub_admin_load_state(text) to anon,authenticated;
