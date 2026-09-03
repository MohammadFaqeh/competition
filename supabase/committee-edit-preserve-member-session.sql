-- إصلاح: أي تعديل على بيانات لجنة موجودة (حتى تغيير مستواها فقط، بلا أي مساس بحساب العضو) كان
-- يُسقط جلسة دخول العضو الفعالة فوراً وبصمت (admin_save_committee_v3/supervisor_save_committee:
-- `delete from committee_login_sessions where committee_id=v_id and (examiner_role='member' or
-- p_id is null)` — الشرط الأول غير مشروط بأي تغيير حقيقي لبيانات العضو). فلو عضو اللجنة وسط
-- اختبار حي وقتها، أول طلب تالٍ له (حفظ مسودة/استطلاع دوري) يرجع "انتهت جلسة اللجنة"، تظهر له
-- كرسالة "تعذر مزامنة/تعذر تحميل" عامة دون أي سبب واضح، ولا تُحل بإعادة المحاولة (لازم يسجّل
-- خروج/دخول من جديد ليكتشف ذلك أصلاً). الإصلاح: لا نُسقط جلسة العضو إلا إذا تغيّر رمزه فعلياً أو
-- أُدخل له PIN جديد صراحةً هذه المرة — بقية التعديلات (اسم اللجنة، المستوى، الجنس، اسم الرئيس...)
-- لا تعود تُسقط جلسته. نسخة كاملة (النسخة الأحدث لكل دالة، مطابقة حرفياً لما هو مطبَّق فعلياً حالياً
-- بقاعدة البيانات) + التعديل المحدود فقط، بلا أي تغيير آخر.
-- شغّل هذا الملف كاملاً مرة واحدة من Supabase SQL Editor بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.admin_save_committee_v3(
  p_id uuid,p_name text,
  p_chairman_name text,p_chairman_code text,p_chairman_pin text,
  p_member_name text,p_member_code text,p_member_pin text,
  p_responsible_gender text,p_level_names text[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_levels smallint[]; v_old_member_code text; v_member_credentials_changed boolean;
begin
  if public.current_user_role() is distinct from 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'اسم اللجنة مطلوب'; end if;
  if nullif(trim(p_chairman_name),'') is null then raise exception 'اسم رئيس اللجنة مطلوب'; end if;
  if trim(p_chairman_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز الرئيس يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and trim(p_member_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز العضو يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and lower(trim(p_chairman_code))=lower(trim(p_member_code)) then raise exception 'يجب أن يختلف رمز الرئيس عن رمز العضو'; end if;
  if p_id is null and length(coalesce(p_chairman_pin,''))<4 then raise exception 'PIN الرئيس يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is null and length(coalesce(p_member_pin,''))<4 then raise exception 'PIN العضو يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is not null and length(coalesce(p_member_pin,''))<4
    and not exists(select 1 from public.committees where id=p_id and member_pin_hash is not null) then
    raise exception 'أدخل PIN للعضو عند تفعيل حسابه لأول مرة';
  end if;
  if p_responsible_gender not in ('ذكر','أنثى') then raise exception 'اختر الجنس المسؤولة عنه اللجنة'; end if;
  if coalesce(array_length(p_level_names,1),0)=0 then raise exception 'اختر مستوى واحداً على الأقل'; end if;
  if exists(select 1 from unnest(p_level_names) n where public.level_name_parts(n) is null) then
    raise exception 'أحد أسماء المستويات غير معروف';
  end if;
  if exists(select 1 from public.committees c where c.id is distinct from p_id and
    (lower(trim(p_chairman_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,''))) or
     (nullif(trim(p_member_code),'') is not null and lower(trim(p_member_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,'')))))) then
    raise exception 'أحد رموز الدخول مستخدم مسبقاً';
  end if;

  v_levels=public.level_names_to_parts(p_level_names);

  if p_id is not null then
    select member_login_code into v_old_member_code from public.committees where id=p_id;
  end if;

  if p_id is null then
    insert into public.committees(name,chairman_name,login_code,pin_hash,member_name,member_login_code,member_pin_hash,
      responsible_gender,level_names,levels,active)
    values(trim(p_name),trim(p_chairman_name),upper(trim(p_chairman_code)),crypt(p_chairman_pin,gen_salt('bf')),
      nullif(trim(p_member_name),''),upper(nullif(trim(p_member_code),'')),
      case when nullif(trim(p_member_code),'') is not null then crypt(p_member_pin,gen_salt('bf')) end,
      p_responsible_gender,p_level_names,v_levels,p_active) returning id into v_id;
  else
    update public.committees set name=trim(p_name),chairman_name=trim(p_chairman_name),login_code=upper(trim(p_chairman_code)),
      pin_hash=case when length(coalesce(p_chairman_pin,''))>=4 then crypt(p_chairman_pin,gen_salt('bf')) else pin_hash end,
      member_name=nullif(trim(p_member_name),''),
      member_login_code=upper(nullif(trim(p_member_code),'')),
      member_pin_hash=case when nullif(trim(p_member_code),'') is null then null when length(coalesce(p_member_pin,''))>=4 then crypt(p_member_pin,gen_salt('bf')) else member_pin_hash end,
      responsible_gender=p_responsible_gender,level_names=p_level_names,levels=v_levels,active=p_active
    where id=p_id returning id into v_id;
    if v_id is null then raise exception 'اللجنة غير موجودة'; end if;
  end if;

  v_member_credentials_changed=(p_id is null)
    or (coalesce(v_old_member_code,'') is distinct from coalesce(upper(nullif(trim(p_member_code),'')),''))
    or (nullif(trim(p_member_code),'') is not null and length(coalesce(p_member_pin,''))>=4);
  delete from public.committee_login_sessions where committee_id=v_id and p_id is null;
  if v_member_credentials_changed then
    delete from public.committee_login_sessions where committee_id=v_id and examiner_role='member';
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_id is null then 'create_committee' else 'update_committee' end,
      'committee',v_id::text,jsonb_build_object('name',trim(p_name),'responsible_gender',p_responsible_gender,'level_names',p_level_names));
  return v_id;
exception when unique_violation then
  raise exception 'رمز اللجنة مستخدم من لجنة أخرى';
end $$;
grant execute on function public.admin_save_committee_v3(uuid,text,text,text,text,text,text,text,text,text[],boolean) to authenticated;

create or replace function public.supervisor_save_committee(
  p_id uuid,p_name text,
  p_chairman_name text,p_chairman_code text,p_chairman_pin text,
  p_member_name text,p_member_code text,p_member_pin text,
  p_responsible_gender text,p_level_names text[],p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_levels smallint[]; v_name text; v_old_member_code text; v_member_credentials_changed boolean;
begin
  if public.current_user_role() is distinct from 'supervisor' then raise exception 'هذه العملية لمشرف المسابقة فقط'; end if;
  select display_name into v_name from public.profiles where id=auth.uid();
  if nullif(trim(p_name),'') is null then raise exception 'اسم اللجنة مطلوب'; end if;
  if nullif(trim(p_chairman_name),'') is null then raise exception 'اسم رئيس اللجنة مطلوب'; end if;
  if trim(p_chairman_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز الرئيس يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and trim(p_member_code)!~'^[A-Za-z0-9_-]{2,20}$' then raise exception 'رمز العضو يجب أن يكون من 2 إلى 20 حرفاً أو رقماً'; end if;
  if nullif(trim(p_member_code),'') is not null and lower(trim(p_chairman_code))=lower(trim(p_member_code)) then raise exception 'يجب أن يختلف رمز الرئيس عن رمز العضو'; end if;
  if p_id is null and length(coalesce(p_chairman_pin,''))<4 then raise exception 'PIN الرئيس يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is null and length(coalesce(p_member_pin,''))<4 then raise exception 'PIN العضو يجب أن يكون 4 خانات على الأقل'; end if;
  if nullif(trim(p_member_code),'') is not null and p_id is not null and length(coalesce(p_member_pin,''))<4
    and not exists(select 1 from public.committees where id=p_id and member_pin_hash is not null) then
    raise exception 'أدخل PIN للعضو عند تفعيل حسابه لأول مرة';
  end if;
  if p_responsible_gender not in ('ذكر','أنثى') then raise exception 'اختر الجنس المسؤولة عنه اللجنة'; end if;
  if coalesce(array_length(p_level_names,1),0)=0 then raise exception 'اختر مستوى واحداً على الأقل'; end if;
  if exists(select 1 from unnest(p_level_names) n where public.level_name_parts(n) is null) then
    raise exception 'أحد أسماء المستويات غير معروف';
  end if;
  if exists(select 1 from public.committees c where c.id is distinct from p_id and
    (lower(trim(p_chairman_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,''))) or
     (nullif(trim(p_member_code),'') is not null and lower(trim(p_member_code)) in (lower(c.login_code),lower(coalesce(c.member_login_code,'')))))) then
    raise exception 'أحد رموز الدخول مستخدم مسبقاً';
  end if;

  v_levels=public.level_names_to_parts(p_level_names);

  if p_id is not null then
    select member_login_code into v_old_member_code from public.committees where id=p_id;
  end if;

  if p_id is null then
    insert into public.committees(name,chairman_name,login_code,pin_hash,member_name,member_login_code,member_pin_hash,
      responsible_gender,level_names,levels,active)
    values(trim(p_name),trim(p_chairman_name),upper(trim(p_chairman_code)),crypt(p_chairman_pin,gen_salt('bf')),
      nullif(trim(p_member_name),''),upper(nullif(trim(p_member_code),'')),
      case when nullif(trim(p_member_code),'') is not null then crypt(p_member_pin,gen_salt('bf')) end,
      p_responsible_gender,p_level_names,v_levels,p_active) returning id into v_id;
  else
    update public.committees set name=trim(p_name),chairman_name=trim(p_chairman_name),login_code=upper(trim(p_chairman_code)),
      pin_hash=case when length(coalesce(p_chairman_pin,''))>=4 then crypt(p_chairman_pin,gen_salt('bf')) else pin_hash end,
      member_name=nullif(trim(p_member_name),''),
      member_login_code=upper(nullif(trim(p_member_code),'')),
      member_pin_hash=case when nullif(trim(p_member_code),'') is null then null when length(coalesce(p_member_pin,''))>=4 then crypt(p_member_pin,gen_salt('bf')) else member_pin_hash end,
      responsible_gender=p_responsible_gender,level_names=p_level_names,levels=v_levels,active=p_active
    where id=p_id returning id into v_id;
    if v_id is null then raise exception 'اللجنة غير موجودة'; end if;
  end if;

  v_member_credentials_changed=(p_id is null)
    or (coalesce(v_old_member_code,'') is distinct from coalesce(upper(nullif(trim(p_member_code),'')),''))
    or (nullif(trim(p_member_code),'') is not null and length(coalesce(p_member_pin,''))>=4);
  delete from public.committee_login_sessions where committee_id=v_id and p_id is null;
  if v_member_credentials_changed then
    delete from public.committee_login_sessions where committee_id=v_id and examiner_role='member';
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),case when p_id is null then 'create_committee' else 'update_committee' end,
      'committee',v_id::text,jsonb_build_object('name',trim(p_name),'responsible_gender',p_responsible_gender,'level_names',p_level_names,'supervisor_name',v_name));
  return v_id;
exception when unique_violation then
  raise exception 'رمز اللجنة مستخدم من لجنة أخرى';
end $$;
grant execute on function public.supervisor_save_committee(uuid,text,text,text,text,text,text,text,text,text[],boolean) to authenticated;
