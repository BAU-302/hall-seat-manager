-- 선택 회차의 감사 이력을 권한 범위 안에서 검색·페이지 조회한다.
-- 연락처와 티켓 식별값은 이력 화면에 노출하지 않는다.

create or replace function private.list_session_audit_logs(
  p_session_code text,
  p_action_filter text default 'all',
  p_query text default '',
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  log_id bigint,
  session_seat_id bigint,
  seat_id bigint,
  action text,
  reason text,
  entrance_name text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz,
  actor_name text,
  seat_code text,
  floor_code text,
  floor_name text,
  row_label text,
  seat_number integer,
  current_allocation_status text,
  current_admission_status text,
  can_undo boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_session_id bigint;
  target_hall_id bigint;
  target_session_status text;
  clean_query text := lower(btrim(coalesce(p_query, '')));
  clean_offset integer := greatest(coalesce(p_offset, 0), 0);
  clean_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_action_filter not in ('all', 'entry', 'allocation', 'cancel', 'reassign', 'block') then
    raise exception '처리 유형 필터가 올바르지 않습니다.';
  end if;

  select session.id, session.hall_id, session.status
  into target_session_id, target_hall_id, target_session_status
  from public.event_sessions session
  where session.session_code = p_session_code;

  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if not (select private.can_access_hall(target_hall_id)) then
    raise exception '이 회차의 처리 이력을 조회할 권한이 없습니다.';
  end if;

  return query
  with history as materialized (
    select
      audit.id as log_id,
      audit.session_seat_id,
      coalesce(
        nullif(audit.after_state ->> 'seat_id', '')::bigint,
        nullif(audit.before_state ->> 'seat_id', '')::bigint,
        session_seat.seat_id
      ) as seat_id,
      audit.action,
      audit.reason,
      audit.entrance_name,
      coalesce(audit.before_state, '{}'::jsonb) - array['contact', 'ticket_code'] as before_state,
      coalesce(audit.after_state, '{}'::jsonb) - array['contact', 'ticket_code'] as after_state,
      audit.created_at,
      coalesce(nullif(profile.display_name, ''), '알 수 없음') as actor_name,
      coalesce(audit.after_state ->> 'seat_code', audit.before_state ->> 'seat_code', seat.seat_code) as seat_code,
      floor.floor_code,
      floor.name as floor_name,
      seat.row_label,
      seat.seat_number,
      session_seat.allocation_status as current_allocation_status,
      session_seat.admission_status as current_admission_status,
      audit.action = 'check_in'
        and target_session_status not in ('ended', 'cancelled')
        and session_seat.admission_status = 'entered'
        and not exists (
          select 1 from public.audit_logs later
          where later.session_id = audit.session_id
            and later.session_seat_id = audit.session_seat_id
            and later.id > audit.id
        ) as can_undo
    from public.audit_logs audit
    left join public.profiles profile on profile.user_id = audit.actor_id
    left join public.session_seats session_seat on session_seat.id = audit.session_seat_id
    left join public.seats seat on seat.id = coalesce(
      nullif(audit.after_state ->> 'seat_id', '')::bigint,
      nullif(audit.before_state ->> 'seat_id', '')::bigint,
      session_seat.seat_id
    )
    left join public.hall_floors floor on floor.id = seat.hall_floor_id
    where audit.session_id = target_session_id
      and (
        p_action_filter = 'all'
        or (p_action_filter = 'entry' and audit.action = 'check_in')
        or (p_action_filter = 'allocation' and audit.action in ('allocate', 'hold'))
        or (p_action_filter = 'cancel' and audit.action in ('release', 'undo_check_in'))
        or (p_action_filter = 'reassign' and audit.action = 'reassign')
        or (p_action_filter = 'block' and audit.action in ('block', 'unblock'))
      )
  ), filtered as (
    select history.* from history
    where clean_query = ''
      or lower(concat_ws(' ', history.seat_code, history.floor_name, history.row_label, history.seat_number::text, history.actor_name, history.reason, history.entrance_name,
        history.before_state ->> 'assignee_name', history.before_state ->> 'group_name', history.after_state ->> 'assignee_name', history.after_state ->> 'group_name')) like '%' || clean_query || '%'
  )
  select filtered.*, count(*) over() as total_count
  from filtered
  order by filtered.created_at desc, filtered.log_id desc
  offset clean_offset
  limit clean_limit;
end;
$$;

create or replace function public.list_session_audit_logs(
  p_session_code text,
  p_action_filter text default 'all',
  p_query text default '',
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  log_id bigint,
  session_seat_id bigint,
  seat_id bigint,
  action text,
  reason text,
  entrance_name text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz,
  actor_name text,
  seat_code text,
  floor_code text,
  floor_name text,
  row_label text,
  seat_number integer,
  current_allocation_status text,
  current_admission_status text,
  can_undo boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_session_audit_logs(p_session_code, p_action_filter, p_query, p_offset, p_limit)
$$;

revoke execute on function private.list_session_audit_logs(text, text, text, integer, integer) from public, anon;
revoke execute on function public.list_session_audit_logs(text, text, text, integer, integer) from public, anon;
grant execute on function private.list_session_audit_logs(text, text, text, integer, integer) to authenticated;
grant execute on function public.list_session_audit_logs(text, text, text, integer, integer) to authenticated;
