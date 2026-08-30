-- توقيت حقيقي لتنبيهات اللجنة ("تمت إضافة"/"لم يعد ضمن لجنتكم"/"تم تحديث بيانات"): هاي
-- التنبيهات حاليًا مبنية على مقارنة محلية بمتصفح اللجنة (آخر نسخة محفوظة عندها محليًا مقابل
-- النسخة الحالية بالخادم)، فتُختم دائمًا بلحظة "هلأ" (وقت فتح/تحديث الشاشة) — حتى لو
-- التغيير الفعلي صار من ساعات أو أيام، لأنه ببساطة ما في أي مكان بالخادم مسجَّل فيه متى
-- تغيّرت بيانات متسابق فعليًا (استيراد إكسل، تعديل يدوي...). هذا الملف يضيف سجلاً خفيفًا
-- بتوقيت حقيقي لكل تغيير يؤثر على توزيع اللجان (الجنس/المستوى/اسم المستوى/التحويل اليدوي/
-- الأجزاء)، تكتبه دوال الحفظ الثلاث (admin_save_state / supervisor_save_state /
-- sub_admin_save_participants) وقت الحفظ الفعلي، وتقرأه اللجنة عبر RPC مخصص لتستبدل به
-- "الآن" كلما توفّر توقيت حقيقي لنفس المتسابق. لا يعمل بأثر رجعي: أي تغيير صار قبل تنفيذ
-- هذا الملف لن يكون له سطر بالسجل، فتبقى اللجنة تراه بتوقيت "الآن" كالسابق تمامًا (سلوك
-- مقصود، بلا أي تخمين لتواريخ ماضية).
--
-- إعادة تعريف admin_save_state/supervisor_save_state/sub_admin_save_participants هون هي
-- نفس الجسم الكامل الموثّق حاليًا (admin-safe-state-merge.sql، supervisor-role.sql،
-- sub-admins-and-committee-upgrade.sql بالترتيب) بلا أي حذف أو تعديل على أي حقل أو سطر
-- موجود، فقط إضافة سطرَي تسجيل قبل حساب الدمج.
--
-- نفّذ هذا الملف من Supabase SQL Editor بعد كل ملفات supabase/*.sql السابقة.
-- قابل لإعادة التشغيل بأمان (idempotent).

create table if not exists public.participant_change_log (
  id bigint generated always as identity primary key,
  participant_id text not null,
  participant_name text,
  changed_at timestamptz not null default now()
);
create index if not exists participant_change_log_participant_idx
  on public.participant_change_log(participant_id, changed_at desc);
alter table public.participant_change_log enable row level security;
-- عمداً بلا أي policy ولا منح مباشر على الجدول: الكتابة فقط من داخل دوال الحفظ أدناه
-- (SECURITY DEFINER)، والقراءة فقط عبر committee_lookup_change_times (SECURITY DEFINER كمان).

-- اللجنة تسأل عن آخر توقيت تغيير حقيقي لمجموعة متسابقين (اللي ظهر عندها فرق لتوّها بالمقارنة
-- المحلية)، فتستبدله بـ"الآن" كلما توفّر.
create or replace function public.committee_lookup_change_times(p_token text,p_participant_ids text[])
returns table(participant_id text,changed_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare v_committee public.committees;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  if p_participant_ids is null or cardinality(p_participant_ids)=0 then return; end if;
  return query select distinct on (l.participant_id) l.participant_id,l.changed_at
    from public.participant_change_log l
    where l.participant_id=any(p_participant_ids)
    order by l.participant_id,l.changed_at desc;
end $$;
grant execute on function public.committee_lookup_change_times(text,text[]) to anon,authenticated;

-- ==========================================================================
-- إعادة تعريف كاملة لدوال الحفظ الثلاث + سطرا تسجيل تغيير فقط (بلا أي حذف/تعديل لأي حقل
-- أو سطر موجود). كل سطر تحت هو نسخة طبق الأصل عن الملف الأصلي.
-- ==========================================================================

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
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;

  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select n->>'id',n->>'name',now() from jsonb_array_elements(p_participants) n
  where not exists(
    select 1 from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
    where o->>'id'=n->>'id'
      and coalesce(o->>'gender','')=coalesce(n->>'gender','')
      and coalesce(o->>'level','')=coalesce(n->>'level','')
      and coalesce(o->>'levelName','')=coalesce(n->>'levelName','')
      and coalesce(o->>'transferCommitteeId','')=coalesce(n->>'transferCommitteeId','')
      and coalesce(o->'parts','[]'::jsonb)=coalesce(n->'parts','[]'::jsonb)
  );
  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select o->>'id',o->>'name',now() from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
  where o->>'id'=any(p_deleted_participant_ids);

  -- أي متسابق موجود بالخادم ولم يصل ضمن دفعة الإدارة ولا ضمن المحذوفين يبقى كما هو
  -- (أضافه طرف آخر — مثل مسؤولة الإناث — بعد آخر مزامنة محلية للإدارة).
  select coalesce(jsonb_agg(item),'[]') into v_others_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where not (item->>'id'=any(p_deleted_participant_ids))
    and not exists(select 1 from jsonb_array_elements(p_participants) n where n->>'id'=item->>'id');
  v_final_participants=v_others_participants||p_participants;

  select coalesce(jsonb_agg(item),'[]') into v_others_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where not (item->>'id'=any(p_deleted_draw_ids))
    and not exists(select 1 from jsonb_array_elements(p_draws) n where n->>'id'=item->>'id');
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

  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select n->>'id',n->>'name',now() from jsonb_array_elements(p_participants) n
  where not exists(
    select 1 from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
    where o->>'id'=n->>'id'
      and coalesce(o->>'gender','')=coalesce(n->>'gender','')
      and coalesce(o->>'level','')=coalesce(n->>'level','')
      and coalesce(o->>'levelName','')=coalesce(n->>'levelName','')
      and coalesce(o->>'transferCommitteeId','')=coalesce(n->>'transferCommitteeId','')
      and coalesce(o->'parts','[]'::jsonb)=coalesce(n->'parts','[]'::jsonb)
  );
  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select o->>'id',o->>'name',now() from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
  where o->>'id'=any(p_deleted_participant_ids);

  select coalesce(jsonb_agg(item),'[]') into v_others_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where not (item->>'id'=any(p_deleted_participant_ids))
    and not exists(select 1 from jsonb_array_elements(p_participants) n where n->>'id'=item->>'id');
  v_final_participants=v_others_participants||p_participants;

  select coalesce(jsonb_agg(item),'[]') into v_others_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where not (item->>'id'=any(p_deleted_draw_ids))
    and not exists(select 1 from jsonb_array_elements(p_draws) n where n->>'id'=item->>'id');
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
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) item where item->>'gender'<>v_admin.gender) then
    raise exception 'لا يمكن إضافة أو تعديل متسابق من جنس مختلف عن صلاحية هذا الحساب';
  end if;
  select payload into v_payload from public.competition_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);

  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select n->>'id',n->>'name',now() from jsonb_array_elements(p_participants) n
  where not exists(
    select 1 from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
    where o->>'id'=n->>'id'
      and coalesce(o->>'gender','')=coalesce(n->>'gender','')
      and coalesce(o->>'level','')=coalesce(n->>'level','')
      and coalesce(o->>'levelName','')=coalesce(n->>'levelName','')
      and coalesce(o->>'transferCommitteeId','')=coalesce(n->>'transferCommitteeId','')
      and coalesce(o->'parts','[]'::jsonb)=coalesce(n->'parts','[]'::jsonb)
  );
  insert into public.participant_change_log(participant_id,participant_name,changed_at)
  select o->>'id',o->>'name',now() from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
  where o->>'id'=any(p_deleted_ids);

  -- كل ما ليس من جنس الحساب، أو من جنسه لكن لم يُرسَل ضمن الدفعة ولا ضمن المحذوفين، يبقى كما هو
  select coalesce(jsonb_agg(item),'[]') into v_others
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where item->>'gender'<>v_admin.gender
     or (not (item->>'id'=any(p_deleted_ids)) and not exists(select 1 from jsonb_array_elements(p_participants) n where n->>'id'=item->>'id'));
  v_final=v_others||p_participants;
  v_payload=jsonb_set(v_payload,'{participants}',v_final,true);
  if cardinality(p_deleted_ids)>0 then
    select coalesce(jsonb_agg(item),'[]') into v_draws
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where not (item->>'participantId'=any(p_deleted_ids));
    v_payload=jsonb_set(v_payload,'{draws}',v_draws,true);
  end if;
  update public.competition_state set payload=v_payload,updated_at=now() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(null,'sub_admin_save_participants','participant','batch',
      jsonb_build_object('sub_admin_id',v_admin.id,'sub_admin_name',v_admin.name,'gender',v_admin.gender,
        'count',jsonb_array_length(p_participants),'deleted_count',cardinality(p_deleted_ids)));
  return v_payload;
end $$;
grant execute on function public.sub_admin_save_participants(text,jsonb,text[]) to anon,authenticated;
