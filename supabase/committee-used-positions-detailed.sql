-- دالة إضافية جديدة (لا تُعدَّل committee_used_position_ids الموجودة أصلاً — صفر خطر على أي
-- استدعاء حالي): بدل قائمة معرّفات مسطّحة فقط، ترجع لكل موضع استُخدم عالمياً (كل اللجان، كل
-- الوقت) أيضاً المستوى وتاريخ السحب — لازمة لخوارزمية Scoring الجديدة الواعية باليوم/المستوى
-- (راجع bestScoredCandidates بapp.js) لما تُستدعى من حساب لجنة، لأن committee_load_state
-- مقيَّدة أصلاً بمتسابقي اللجنة نفسها فقط (لا ترى سحوبات بقية اللجان) — بعكس هذه الدالة.
-- نفّذ هذا الملف بعد كل ملفات supabase/*.sql الحالية.

create or replace function public.committee_used_positions_detailed(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_committee public.committees; v_payload jsonb; v_result jsonb;
begin
  v_committee=public.committee_from_token(p_token);
  if v_committee.id is null then raise exception 'انتهت جلسة اللجنة'; end if;
  select payload into v_payload from public.competition_state where id=1;
  select coalesce(jsonb_agg(jsonb_build_object('id',pos->>'id','level',d->>'level','createdAt',d->>'createdAt')),'[]') into v_result
    from jsonb_array_elements(coalesce(v_payload->'draws','[]')) d,
         jsonb_array_elements(coalesce(d->'positions','[]')) pos;
  return v_result;
end $$;
grant execute on function public.committee_used_positions_detailed(text) to anon,authenticated;
