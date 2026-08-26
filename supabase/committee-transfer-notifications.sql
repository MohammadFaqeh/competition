-- تنبيه نقل ثابت ومستقل عن الجلسة: حاليًا عند نقل متسابق (نقل حقيقي بين اللجان عبر
-- admin_transfer_participant / sub_admin_transfer_participant / supervisor_transfer_participant
-- في participant-transfer.sql و supervisor-role.sql) فإن اللجنة لا "تعرف" بالنقل إلا إذا
-- كانت متصلة فعليًا لحظة النقل (فرق لحظي بين لقطة محلية سابقة محفوظة بالمتصفح ولقطة
-- جديدة أثناء الاستطلاع الدوري كل 5 ثوانٍ) أو كانت قد فتحت الحساب من قبل على نفس
-- الجهاز/المتصفح (التنبيهات الحالية committee_alerts.* بالكامل محلية بـ localStorage —
-- بلا أي أثر على الخادم). لو نُقل متسابق للجنة ثم فتحت اللجنة الحساب لاحقًا من جهاز آخر،
-- أو كان أول فتح لها للحساب، أو مُسحت بيانات المتصفح — لا يظهر أي تنبيه بالنقل إطلاقًا.
--
-- الحل: جدول تنبيهات دائم على الخادم (لا يعتمد على أي جلسة أو جهاز)، تُكتب فيه سطور
-- عند كل نقل فعلي (وصول لِلجنة الهدف + مغادرة لجنة المصدر إن كانت معروفة)، وتُجلب عبر
-- RPC مخصص (بنفس نمط المصادقة بالتوكن المستخدم بكل دوال اللجان الأخرى) في كل مرة تفتح
-- فيها اللجنة حسابها أو أثناء الاستطلاع الدوري — فتظهر بالسجل دائمًا بصرف النظر عن
-- الجهاز أو وقت الفتح. هذا الملف إضافي بالكامل: لا يحذف أو يبدّل أي حقل بأي دالة موجودة،
-- فقط يضيف استدعاءً واحدًا لتسجيل التنبيه داخل كل دالة نقل (بعد نسخ جسمها الكامل
-- والمدقَّق من participant-transfer.sql و supervisor-role.sql بلا أي إسقاط لأي حقل).
--
-- نفّذ هذا الملف من Supabase SQL Editor بعد كل ملفات supabase/*.sql السابقة.
-- قابل لإعادة التشغيل بأمان (idempotent).

create table if not exists public.committee_notifications (
  id bigint generated always as identity primary key,
  committee_id uuid not null references public.committees(id) on delete cascade,
  participant_id text,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists committee_notifications_committee_idx
  on public.committee_notifications(committee_id, created_at desc);
alter table public.committee_notifications enable row level security;
-- عمداً بلا أي policy: الوصول فقط عبر دوال SECURITY DEFINER أدناه (نفس نمط بقية جداول
-- اللجان)، فلا داعٍ لمنح anon/authenticated أي صلاحية مباشرة على الجدول نفسه.

-- دالة مساعدة داخلية: تُستدعى من دوال النقل الثلاث فقط، تكتب سطر وصول للجنة الهدف
-- (إن وُجدت) وسطر مغادرة للجنة المصدر (إن كانت معروفة — من جلسة اختبار قائمة أو من
-- transferCommitteeId سابق) طالما تختلف عن لجنة الهدف.
create or replace function public.record_transfer_notifications(
  p_participant_id text,p_participant_name text,p_from_committee_id uuid,p_to_committee_id uuid
) returns void language plpgsql security definer set search_path=public,extensions as $$
begin
  if p_to_committee_id is not null then
    insert into public.committee_notifications(committee_id,participant_id,message) values(
      p_to_committee_id,p_participant_id,
      'تم نقل المتسابق '||coalesce(p_participant_name,'')||' إلى لجنتكم'
    );
  end if;
  if p_from_committee_id is not null and p_from_committee_id is distinct from p_to_committee_id then
    insert into public.committee_notifications(committee_id,participant_id,message) values(
      p_from_committee_id,p_participant_id,
      case when p_to_committee_id is null
        then 'تم إلغاء نقل المتسابق '||coalesce(p_participant_name,'')||' وإعادته لمستواه الطبيعي — لم يعد ضمن لجنتكم'
        else 'تم نقل المتسابق '||coalesce(p_participant_name,'')||' خارج لجنتكم إلى لجنة أخرى' end
    );
  end if;
end $$;
grant execute on function public.record_transfer_notifications(text,text,uuid,uuid) to authenticated;

-- جلب تنبيهات اللجنة (آخر 50)، بنفس مصادقة التوكن المستخدمة بكل دوال اللجنة الأخرى.
create or replace function public.committee_list_notifications(p_token text)
returns setof public.committee_notifications
language plpgsql security definer set search_path=public,extensions as $$
declare v_committee public.committees;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  return query select * from public.committee_notifications
    where committee_id=v_committee.id order by created_at desc limit 50;
end $$;
grant execute on function public.committee_list_notifications(text) to anon,authenticated;

-- إعادة تعريف كاملة (نفس كل حقل وكل سطر من النسخة الموثّقة في participant-transfer.sql)
-- + سطر واحد إضافي لتسجيل التنبيه الدائم.
create or replace function public.admin_transfer_participant(p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_participant jsonb; v_to_name text; v_from_name text; v_session public.exam_sessions; v_from_committee_id uuid;
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
  v_from_committee_id=coalesce(v_session.committee_id,nullif(v_participant->>'transferCommitteeId','')::uuid);
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
  perform public.record_transfer_notifications(p_participant_id,v_participant->>'name',v_from_committee_id,p_committee_id);
  return v_payload;
end $$;
grant execute on function public.admin_transfer_participant(text,uuid) to authenticated;

create or replace function public.sub_admin_transfer_participant(p_token text,p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participant jsonb; v_to_name text; v_to_gender text; v_from_name text; v_session public.exam_sessions; v_from_committee_id uuid;
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
  v_from_committee_id=coalesce(v_session.committee_id,nullif(v_participant->>'transferCommitteeId','')::uuid);
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
  perform public.record_transfer_notifications(p_participant_id,v_participant->>'name',v_from_committee_id,p_committee_id);
  return v_payload;
end $$;
grant execute on function public.sub_admin_transfer_participant(text,text,uuid) to anon,authenticated;

create or replace function public.supervisor_transfer_participant(p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_supervisor_name text; v_payload jsonb; v_participant jsonb; v_to_name text; v_from_name text; v_session public.exam_sessions; v_from_committee_id uuid;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_supervisor_name from public.profiles where id=auth.uid();
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
  v_from_committee_id=coalesce(v_session.committee_id,nullif(v_participant->>'transferCommitteeId','')::uuid);
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
        'to_committee_name',v_to_name,'from_committee_name',v_from_name,'supervisor_name',v_supervisor_name));
  perform public.record_transfer_notifications(p_participant_id,v_participant->>'name',v_from_committee_id,p_committee_id);
  return v_payload;
end $$;
grant execute on function public.supervisor_transfer_participant(text,uuid) to authenticated;
