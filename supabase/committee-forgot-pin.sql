-- "نسيت الرمز السري (PIN)" لرئيس/عضو اللجنة والمسؤول الفرعي — الجزء الوحيد المفقود عشان
-- الدالة المشتركة password-reset (راجع supabase/functions/password-reset/index.ts) تقدر تحدّث
-- الـPIN مباشرة، بنفس تشفير bcrypt المستخدم أصلاً بكل login_code/pin_hash بالمشروع
-- (crypt(pin, gen_salt('bf'))، طابق sub-admins-and-committee-upgrade.sql بالضبط).
--
-- تُستدعى فقط من الـEdge Function بمفتاح service_role بعد التحقق من رمز التأكيد — لا صلاحية
-- تنفيذ لـ anon ولا authenticated إطلاقاً (لا يوجد grant execute لهما أدناه).
--
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.reset_login_code_pin(p_login_code text,p_new_pin text)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
declare v_code text:=upper(trim(p_login_code));
begin
  if length(coalesce(p_new_pin,''))<4 then raise exception 'PIN يجب أن يكون 4 خانات على الأقل'; end if;

  update public.committees set pin_hash=crypt(p_new_pin,gen_salt('bf')),failed_login_count=0,locked_until=null
    where upper(login_code)=v_code;
  if found then return true; end if;

  update public.committees set member_pin_hash=crypt(p_new_pin,gen_salt('bf'))
    where upper(member_login_code)=v_code;
  if found then return true; end if;

  update public.sub_admins set pin_hash=crypt(p_new_pin,gen_salt('bf')),failed_login_count=0,locked_until=null
    where upper(login_code)=v_code;
  if found then return true; end if;

  return false;
end $$;

revoke all on function public.reset_login_code_pin(text,text) from public,anon,authenticated;
grant execute on function public.reset_login_code_pin(text,text) to service_role;
