-- ديوان الحفاظ: عرض المتسابقين للمسؤول الفرعي (مسؤولة الإناث/مسؤول الذكور) ولمشرف المسابقة.
-- كانت diwan_state/diwan_exam_sessions مقروءة للإدارة الرئيسية فقط، فتظهر صفحة ديوان الحفاظ فارغة
-- لبقية حسابات الإدارة. القسم الثاني بالأسفل يمنحهم صلاحيات التعديل نفسها (ضمن جنس الحساب للمسؤول الفرعي).
-- المسؤول الفرعي يرى جنس حسابه فقط؛ والمتسابق بلا جنس محدد يُحسب على الإناث (نفس قاعدة
-- توزيع لجان الإناث بالواجهة: gender!=='ذكر'). نفّذ هذا الملف بعد diwan-al-hifadh-core.sql.

-- مشرف المسابقة: حساب Supabase Auth عادي (profiles.role='supervisor') → توسعة سياسة القراءة فقط.
drop policy if exists diwan_state_read on public.diwan_state;
create policy diwan_state_read on public.diwan_state for select to authenticated
using (public.current_user_role() in ('admin','supervisor'));

drop policy if exists diwan_sessions_read on public.diwan_exam_sessions;
create policy diwan_sessions_read on public.diwan_exam_sessions for select to authenticated
using (public.current_user_role() in ('admin','supervisor'));

-- المسؤول الفرعي: جلسة برمز (sub_admin_from_token) لا حساب Auth، فيحتاج دوالاً خاصة به.
create or replace function public.diwan_sub_admin_participant_visible(p_participant jsonb,p_gender text)
returns boolean language sql immutable
as $$ select case when p_gender='أنثى' then coalesce(p_participant->>'gender','') is distinct from 'ذكر'
                  else p_participant->>'gender'=p_gender end $$;

create or replace function public.diwan_sub_admin_load_state(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_payload jsonb; v_participants jsonb; v_draws jsonb;
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select payload into v_payload from public.diwan_state where id=1;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select coalesce(jsonb_agg(item),'[]') into v_participants
  from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
  where public.diwan_sub_admin_participant_visible(item,v_admin.gender);
  select coalesce(jsonb_agg(item),'[]') into v_draws
  from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where exists(select 1 from jsonb_array_elements(v_participants) p where p->>'id'=item->>'participantId');
  return jsonb_build_object('config',v_payload->'config','participants',v_participants,'draws',v_draws);
end $$;
grant execute on function public.diwan_sub_admin_load_state(text) to anon,authenticated;

create or replace function public.diwan_sub_admin_list_sessions(p_token text)
returns setof public.diwan_exam_sessions language plpgsql security definer set search_path=public,extensions
as $$
declare v_admin public.sub_admins; v_ids text[];
begin
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  select coalesce(array_agg(item->>'id'),'{}') into v_ids
  from jsonb_array_elements(coalesce((select payload->'participants' from public.diwan_state where id=1),'[]')) item
  where public.diwan_sub_admin_participant_visible(item,v_admin.gender);
  return query select * from public.diwan_exam_sessions where participant_id=any(v_ids) order by updated_at desc;
end $$;
grant execute on function public.diwan_sub_admin_list_sessions(text) to anon,authenticated;

-- ==========================================================================
-- صلاحيات التعديل (نفس صلاحيات الإدارة الرئيسية على المتسابقين): سحب، تعديل البيانات والأجزاء، انسحاب،
-- نقل لمرحلة، توصية، حذف سحب/جلسة. المسؤول الفرعي ضمن جنس حسابه فقط (يُفحص هنا بالخادم لا بالمتصفح).
-- صلاحية كاملة مثل الإدارة الرئيسية (طلب صريح): إضافة، تعديل، حذف، نقل بين اللجان، بلا مفاتيح إضافية.
-- ==========================================================================

-- هوية المنفّذ: مشرف المسابقة (حساب Auth) → كل الأجناس '*'، والمسؤول الفرعي (رمز جلسة) → جنس حسابه.
create or replace function public.diwan_staff_actor(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions
as $$
declare v_profile public.profiles; v_admin public.sub_admins;
begin
  select * into v_profile from public.profiles where id=auth.uid();
  if v_profile.role='supervisor' then
    return jsonb_build_object('gender','*','can_delete',coalesce(v_profile.can_delete_data,false),
      'can_transfer',coalesce(v_profile.can_transfer_participant,false),'label','مشرف المسابقة: '||coalesce(v_profile.display_name,''));
  end if;
  v_admin=public.sub_admin_from_token(p_token);
  if v_admin.id is null then raise exception 'انتهت الجلسة'; end if;
  return jsonb_build_object('gender',v_admin.gender,'can_delete',coalesce(v_admin.can_delete_data,false),
    'can_transfer',coalesce(v_admin.can_transfer_participant,false),'label','مسؤول فرعي: '||coalesce(v_admin.name,''));
end $$;
revoke execute on function public.diwan_staff_actor(text) from public,anon,authenticated;

create or replace function public.diwan_staff_can_see(p_participant jsonb,p_gender text)
returns boolean language sql immutable
as $$ select p_gender='*' or public.diwan_sub_admin_participant_visible(p_participant,p_gender) $$;

-- نفس منطق diwan_admin_save_state (فروقات فقط، ويبقى أي id غائب كما هو) + فحص نطاق الجنس لكل عنصر.
create or replace function public.diwan_staff_save_state(
  p_token text,p_config jsonb,p_participants jsonb,p_draws jsonb,
  p_deleted_participant_ids text[] default '{}',p_deleted_draw_ids text[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_actor jsonb; v_gender text; v_payload jsonb; v_stored jsonb; v_visible_ids text[];
  v_others_participants jsonb; v_others_draws jsonb; v_incoming_participant_ids text[]; v_incoming_draw_ids text[];
begin
  v_actor=public.diwan_staff_actor(p_token);v_gender=v_actor->>'gender';
  p_participants=coalesce(p_participants,'[]');p_draws=coalesce(p_draws,'[]');
  p_deleted_participant_ids=coalesce(p_deleted_participant_ids,'{}');p_deleted_draw_ids=coalesce(p_deleted_draw_ids,'{}');
  select payload into v_payload from public.diwan_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);v_stored=coalesce(v_payload->'participants','[]');

  if exists(select 1 from jsonb_array_elements(p_participants) n where not public.diwan_staff_can_see(n,v_gender)
       or exists(select 1 from jsonb_array_elements(v_stored) o where o->>'id'=n->>'id' and not public.diwan_staff_can_see(o,v_gender))) then
    raise exception 'لا صلاحية لحسابك على متسابقين من الجنس الآخر';
  end if;
  if cardinality(p_deleted_participant_ids)>0 then
    if exists(select 1 from jsonb_array_elements(v_stored) o where o->>'id'=any(p_deleted_participant_ids) and not public.diwan_staff_can_see(o,v_gender)) then
      raise exception 'لا صلاحية لحسابك على متسابقين من الجنس الآخر';
    end if;
  end if;
  -- السحوبات: كل سحب جديد/معدَّل/محذوف يجب أن يخص متسابقاً ضمن نطاق الحساب.
  select coalesce(array_agg(item->>'id'),'{}') into v_visible_ids
  from (select o as item from jsonb_array_elements(v_stored) o union all select n from jsonb_array_elements(p_participants) n) x
  where public.diwan_staff_can_see(item,v_gender);
  if exists(select 1 from jsonb_array_elements(p_draws) d where not (d->>'participantId'=any(v_visible_ids)))
     or exists(select 1 from jsonb_array_elements(coalesce(v_payload->'draws','[]')) d
               where (d->>'id'=any(p_deleted_draw_ids) or d->>'id' in (select n->>'id' from jsonb_array_elements(p_draws) n))
                 and not (d->>'participantId'=any(v_visible_ids))) then
    raise exception 'لا صلاحية لحسابك على سحوبات متسابقين من الجنس الآخر';
  end if;

  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_participant_ids from jsonb_array_elements(p_participants) n;
  select coalesce(array_agg(n->>'id'),'{}') into v_incoming_draw_ids from jsonb_array_elements(p_draws) n;
  select coalesce(jsonb_agg(item),'[]') into v_others_participants from jsonb_array_elements(v_stored) item
  where not (item->>'id'=any(p_deleted_participant_ids)) and not (item->>'id'=any(v_incoming_participant_ids));
  select coalesce(jsonb_agg(item),'[]') into v_others_draws from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
  where not (item->>'id'=any(p_deleted_draw_ids)) and not (item->>'id'=any(v_incoming_draw_ids));

  -- الإعدادات تبقى للإدارة الرئيسية؛ فقط عدّاد أرقام الشهادات يتقدّم (لا يرجع للخلف أبداً).
  v_payload=jsonb_set(v_payload,'{config}',coalesce(v_payload->'config','{}'::jsonb)||jsonb_build_object('nextCertificateSeq',
    greatest(coalesce((v_payload->'config'->>'nextCertificateSeq')::int,0),coalesce((p_config->>'nextCertificateSeq')::int,0))),true);
  v_payload=jsonb_set(v_payload,'{participants}',v_others_participants||p_participants,true);
  v_payload=jsonb_set(v_payload,'{draws}',v_others_draws||p_draws,true);
  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return v_payload;
end $$;
grant execute on function public.diwan_staff_save_state(text,jsonb,jsonb,jsonb,text[],text[]) to anon,authenticated;

-- نفس diwan_admin_create_draw + فحص نطاق المتسابق.
create or replace function public.diwan_staff_create_draw(p_token text,p_draw jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_actor jsonb; v_payload jsonb; v_sequence integer;
begin
  v_actor=public.diwan_staff_actor(p_token);
  select payload into v_payload from public.diwan_state where id=1 for update;
  if not exists(select 1 from jsonb_array_elements(coalesce(v_payload->'participants','[]')) o
                where o->>'id'=p_draw->>'participantId' and public.diwan_staff_can_see(o,v_actor->>'gender')) then
    raise exception 'المتسابق غير موجود أو خارج صلاحية حسابك';
  end if;
  select coalesce(max((item->>'sequence')::integer),0)+1 into v_sequence
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item;
  p_draw=jsonb_set(p_draw,'{sequence}',to_jsonb(v_sequence),true);
  v_payload=jsonb_set(v_payload,'{draws}',coalesce(v_payload->'draws','[]')||jsonb_build_array(p_draw),true);
  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  return p_draw;
end $$;
grant execute on function public.diwan_staff_create_draw(text,jsonb) to anon,authenticated;

-- نفس diwan_admin_delete_participant_draw (انسحاب أثناء اختبار جارٍ) + فحص نطاق المتسابق.
create or replace function public.diwan_staff_delete_participant_draw(p_token text,p_draw_id text)
returns void language plpgsql security definer set search_path=public,extensions
as $$
declare v_actor jsonb; v_participant_id text;
begin
  v_actor=public.diwan_staff_actor(p_token);
  select participant_id into v_participant_id from public.diwan_exam_sessions where draw_id=p_draw_id limit 1;
  if v_participant_id is null then return; end if;
  if not exists(select 1 from public.diwan_state ds,jsonb_array_elements(coalesce(ds.payload->'participants','[]')) o
                where ds.id=1 and o->>'id'=v_participant_id and public.diwan_staff_can_see(o,v_actor->>'gender')) then
    raise exception 'المتسابق خارج صلاحية حسابك';
  end if;
  delete from public.diwan_exam_sessions where draw_id=p_draw_id;
end $$;
grant execute on function public.diwan_staff_delete_participant_draw(text,text) to anon,authenticated;

-- النقل بين اللجان: جسم diwan_admin_transfer_participant (diwan-al-hifadh-core.sql) كما هو حرفياً بدالة داخلية
-- مشتركة، والدالة الإدارية تبقى بنفس توقيعها وسلوكها (فحص الدور ثم نفس الجسم).
create or replace function public.diwan_transfer_participant_core(p_participant_id text,p_committee_id uuid,p_actor text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_payload jsonb; v_participant jsonb; v_to_name text; v_current_stage int; v_current_draw_id text; v_session public.diwan_exam_sessions;
begin
  select payload into v_payload from public.diwan_state where id=1 for update;
  v_payload=coalesce(v_payload,'{}'::jsonb);
  select item into v_participant from jsonb_array_elements(coalesce(v_payload->'participants','[]')) item
    where item->>'id'=p_participant_id limit 1;
  if v_participant is null then raise exception 'المتسابق غير موجود'; end if;
  if p_committee_id is not null then
    select name into v_to_name from public.committees where id=p_committee_id and active;
    if v_to_name is null then raise exception 'اللجنة الهدف غير موجودة أو غير مفعّلة'; end if;
  end if;
  v_current_stage=coalesce((v_participant->>'stage')::int,1);
  select item->>'id' into v_current_draw_id from jsonb_array_elements(coalesce(v_payload->'draws','[]')) item
    where item->>'participantId'=p_participant_id and (item->>'stage')::int=v_current_stage
    order by (item->>'createdAt') desc limit 1;
  if v_current_draw_id is not null then
    select * into v_session from public.diwan_exam_sessions where draw_id=v_current_draw_id;
    if v_session.id is not null and v_session.status='final' then
      raise exception 'لا يمكن نقل متسابق اعتُمدت نتيجة مرحلته الحالية بالفعل';
    end if;
    if v_session.id is not null then delete from public.diwan_exam_sessions where id=v_session.id; end if;
  end if;
  v_payload=jsonb_set(v_payload,'{participants}',(
    select jsonb_agg(case when item->>'id'=p_participant_id
      then jsonb_set(item,'{transferCommitteeId}',coalesce(to_jsonb(p_committee_id::text),'null'::jsonb),true)
      else item end)
    from jsonb_array_elements(v_payload->'participants') item
  ),true);
  update public.diwan_state set payload=v_payload,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'transfer_diwan_participant','participant',p_participant_id,
      jsonb_build_object('participant_name',v_participant->>'name','to_committee_id',p_committee_id,'to_committee_name',v_to_name)||case when p_actor is null then '{}'::jsonb else jsonb_build_object('actor',p_actor) end);
  perform public.record_transfer_notifications(p_participant_id,v_participant->>'name',null,p_committee_id);
  return v_payload;
end $$;
revoke execute on function public.diwan_transfer_participant_core(text,uuid,text) from public,anon,authenticated;

create or replace function public.diwan_admin_transfer_participant(p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  return public.diwan_transfer_participant_core(p_participant_id,p_committee_id,null);
end $$;
grant execute on function public.diwan_admin_transfer_participant(text,uuid) to authenticated;

create or replace function public.diwan_staff_transfer_participant(p_token text,p_participant_id text,p_committee_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_actor jsonb; v_gender text; v_committee_gender text;
begin
  v_actor=public.diwan_staff_actor(p_token);v_gender=v_actor->>'gender';
  if not exists(select 1 from public.diwan_state ds,jsonb_array_elements(coalesce(ds.payload->'participants','[]')) o
                where ds.id=1 and o->>'id'=p_participant_id and public.diwan_staff_can_see(o,v_gender)) then
    raise exception 'المتسابق غير موجود أو خارج صلاحية حسابك';
  end if;
  if p_committee_id is not null and v_gender<>'*' then
    select responsible_gender into v_committee_gender from public.committees where id=p_committee_id;
    if v_committee_gender is not null and v_committee_gender<>v_gender then raise exception 'لا يمكن النقل إلى لجنة من الجنس الآخر'; end if;
  end if;
  return public.diwan_transfer_participant_core(p_participant_id,p_committee_id,v_actor->>'label');
end $$;
grant execute on function public.diwan_staff_transfer_participant(text,text,uuid) to anon,authenticated;
