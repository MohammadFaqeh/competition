-- شغّل هذا الملف مرة واحدة لإتاحة إعادة الطالب للسحب بعد تعديل أجزائه.
create or replace function public.admin_delete_participant_session(p_participant_id text)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'هذه العملية للمدير فقط'; end if;
  delete from public.exam_sessions where participant_id=p_participant_id;
end $$;

grant execute on function public.admin_delete_participant_session(text) to authenticated;
