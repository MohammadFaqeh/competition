-- ديوان الحفاظ: متسابقات الديوان (أنثى) متاحات لكل لجان الإناث بغض النظر عن مستويات اللجنة، وكل لجنة تختار من تمتحن.
-- إعادة تعريف diwan_committee_claim_student من diwan-al-hifadh-core.sql (النسخة الوحيدة/الأحدث) بنفس كل الفحوص حرفياً،
-- مع إضافة شرط واحد لفحص المستوى: لجنة إناث + متسابقة أنثى غير منقولة يدوياً للجنة أخرى (الذكور بلا أي تغيير)،
-- ومنع بدء اختبار متسابق سجّلته الإدارة منسحبًا. آمن لإعادة التشغيل أكثر من مرة.
-- تُشغَّل مرة واحدة من Supabase → SQL Editor.

create or replace function public.diwan_committee_claim_student(
  p_token text,p_participant_id text,p_draw_id text,p_stage smallint,p_level smallint,p_level_name text default null
) returns public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_session public.diwan_exam_sessions; v_active_name text; v_transfer_committee_id text; v_gender text; v_withdrawn text;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select p.name into v_active_name
  from public.diwan_exam_sessions es
  left join lateral (
    select item->>'name' as name from public.diwan_state ds,
      jsonb_array_elements(coalesce(ds.payload->'participants','[]')) item
    where ds.id=1 and item->>'id'=es.participant_id limit 1
  ) p on true
  where es.committee_id=v_committee.id and es.status='in_progress' and es.draw_id<>p_draw_id
  limit 1;
  if v_active_name is not null then
    raise exception 'لجنتكم تختبر حاليًا «%» — أنهوا أو ألغوا اختباره أولاً قبل بدء متسابق جديد',v_active_name;
  end if;
  select item->>'transferCommitteeId',item->>'gender',item->>'withdrawn' into v_transfer_committee_id,v_gender,v_withdrawn
  from public.diwan_state ds, jsonb_array_elements(coalesce(ds.payload->'participants','[]')) item
  where ds.id=1 and item->>'id'=p_participant_id limit 1;
  if v_withdrawn='true' then raise exception 'هذا المتسابق منسحب — لا يمكن بدء اختباره'; end if;
  if not (p_level=any(v_committee.levels))
     and coalesce(v_transfer_committee_id,'')<>v_committee.id::text
     and not (v_committee.responsible_gender='أنثى' and v_gender='أنثى' and coalesce(v_transfer_committee_id,'')='') then
    raise exception 'هذا المستوى غير مخصص لهذه اللجنة';
  end if;
  select * into v_session from public.diwan_exam_sessions where draw_id=p_draw_id;
  if v_session.id is not null and v_session.committee_id<>v_committee.id then raise exception 'بدأت لجنة أخرى امتحان هذا المتسابق'; end if;
  if v_session.id is null then
    insert into public.diwan_exam_sessions(participant_id,draw_id,committee_id,stage,level,level_name)
    values(p_participant_id,p_draw_id,v_committee.id,p_stage,p_level,p_level_name) returning * into v_session;
  end if;
  return v_session;
end $$;

grant execute on function public.diwan_committee_claim_student(text,text,text,smallint,smallint,text) to anon,authenticated;

-- السحوبات التي بدأتها/اعتمدتها لجان أخرى — ليرى الجميع فوراً أن المتسابقة امتُحنت (أو قيد الاختبار) عند لجنة أخرى فلا تُمتحن مرتين.
-- قراءة فقط: رقم السحب والحالة واسم اللجنة، بلا علامات ولا تقييم.
create or replace function public.diwan_committee_taken_draws(p_token text)
returns table(draw_id text,status text,committee_name text) language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  return query select es.draw_id,es.status,c.name from public.diwan_exam_sessions es join public.committees c on c.id=es.committee_id where es.committee_id<>v_committee.id;
end $$;

grant execute on function public.diwan_committee_taken_draws(text) to anon,authenticated;
