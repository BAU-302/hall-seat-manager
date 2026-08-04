create or replace function private.release_session_seats(
  p_session_code text,
  p_seat_ids bigint[],
  p_reason text default '배분 취소'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_session_id bigint;
  target_hall_id bigint;
  target_session_status text;
  requested_count integer;
  releasable_count integer;
  released_count integer;
  clean_reason text := coalesce(nullif(btrim(p_reason), ''), '배분 취소');
begin
  if caller_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  requested_count := coalesce(cardinality(p_seat_ids), 0);
  if requested_count < 1 then
    raise exception '취소할 좌석을 한 개 이상 선택해 주세요.';
  end if;
  if requested_count > 694 then
    raise exception '한 번에 취소할 수 있는 좌석 수를 초과했습니다.';
  end if;
  if (select count(distinct seat_id) from unnest(p_seat_ids) as seat_id) <> requested_count then
    raise exception '선택 좌석에 중복 값이 있습니다.';
  end if;
  if length(clean_reason) > 500 then
    raise exception '취소 사유는 500자 이내로 입력해 주세요.';
  end if;

  select id, hall_id, status
  into target_session_id, target_hall_id, target_session_status
  from public.event_sessions
  where session_code = p_session_code
  for update;

  if target_session_id is null then
    raise exception '행사 회차를 찾을 수 없습니다.';
  end if;
  if target_session_status in ('ended', 'cancelled') then
    raise exception '종료되거나 취소된 회차의 배분은 취소할 수 없습니다.';
  end if;
  if not (select private.can_manage_hall(target_hall_id)) then
    raise exception '이 회차의 배분을 취소할 권한이 없습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));

  select count(*)
  into releasable_count
  from (
    select session_seat.id
    from public.session_seats session_seat
    where session_seat.session_id = target_session_id
      and session_seat.seat_id = any(p_seat_ids)
      and session_seat.allocation_status = 'distributed'
      and session_seat.admission_status = 'not_entered'
    for update
  ) as locked_session_seats;

  if releasable_count <> requested_count then
    raise exception '배분되지 않았거나 이미 입장한 좌석이 포함되어 있습니다. 상태를 새로고침해 주세요.';
  end if;

  with targets as materialized (
    select
      session_seat.id,
      session_seat.seat_id,
      session_seat.allocation_status,
      session_seat.admission_status,
      session_seat.ticket_code,
      session_seat.assignee_name,
      session_seat.group_name,
      session_seat.contact,
      session_seat.note,
      session_seat.allocated_by,
      session_seat.allocated_at,
      session_seat.version
    from public.session_seats session_seat
    where session_seat.session_id = target_session_id
      and session_seat.seat_id = any(p_seat_ids)
  ), updated as (
    update public.session_seats session_seat
    set allocation_status = 'available',
        admission_status = 'not_entered',
        ticket_code = null,
        assignee_name = null,
        group_name = null,
        contact = null,
        note = '',
        allocated_by = null,
        allocated_at = null,
        admitted_by = null,
        admitted_at = null,
        entrance_name = null,
        version = session_seat.version + 1
    from targets
    where session_seat.id = targets.id
    returning session_seat.id, session_seat.seat_id, session_seat.version
  )
  insert into public.audit_logs (
    session_id,
    session_seat_id,
    actor_id,
    action,
    reason,
    before_state,
    after_state
  )
  select
    target_session_id,
    updated.id,
    caller_id,
    'release',
    clean_reason,
    jsonb_build_object(
      'seat_id', targets.seat_id,
      'allocation_status', targets.allocation_status,
      'admission_status', targets.admission_status,
      'ticket_code', targets.ticket_code,
      'assignee_name', targets.assignee_name,
      'group_name', targets.group_name,
      'contact', targets.contact,
      'note', targets.note,
      'allocated_by', targets.allocated_by,
      'allocated_at', targets.allocated_at,
      'version', targets.version
    ),
    jsonb_build_object(
      'seat_id', updated.seat_id,
      'allocation_status', 'available',
      'admission_status', 'not_entered',
      'version', updated.version
    )
  from updated
  join targets on targets.id = updated.id;

  get diagnostics released_count = row_count;
  if released_count <> requested_count then
    raise exception '좌석 배분 취소 중 상태가 변경되었습니다. 다시 시도해 주세요.';
  end if;

  update public.event_sessions
  set status = 'scheduled'
  where id = target_session_id
    and status = 'allocation'
    and not exists (
      select 1
      from public.session_seats session_seat
      where session_seat.session_id = target_session_id
        and session_seat.allocation_status <> 'available'
    );

  return released_count;
end;
$$;

create or replace function public.release_session_seats(
  p_session_code text,
  p_seat_ids bigint[],
  p_reason text default '배분 취소'
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.release_session_seats(
    p_session_code,
    p_seat_ids,
    p_reason
  )
$$;

revoke execute on function private.release_session_seats(text, bigint[], text) from public, anon;
grant execute on function private.release_session_seats(text, bigint[], text) to authenticated;

revoke execute on function public.release_session_seats(text, bigint[], text) from public, anon;
grant execute on function public.release_session_seats(text, bigint[], text) to authenticated;
