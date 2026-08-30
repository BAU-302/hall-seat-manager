create or replace function private.allocate_session_seats(
  p_session_code text,
  p_seat_ids bigint[],
  p_recipient_type text,
  p_assignee_name text default null,
  p_group_name text default null,
  p_contact text default null,
  p_note text default ''
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
  target_session_code text;
  target_session_status text;
  requested_count integer;
  valid_count integer;
  allocated_count integer;
  clean_assignee_name text := nullif(btrim(p_assignee_name), '');
  clean_group_name text := nullif(btrim(p_group_name), '');
  clean_contact text := nullif(btrim(p_contact), '');
  clean_note text := coalesce(btrim(p_note), '');
begin
  if caller_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if p_recipient_type not in ('individual', 'group') then
    raise exception '배부 대상 유형이 올바르지 않습니다.';
  end if;
  if p_recipient_type = 'individual' and clean_assignee_name is null then
    raise exception '개인 이름을 입력해 주세요.';
  end if;
  if p_recipient_type = 'group' and clean_group_name is null then
    raise exception '단체명을 입력해 주세요.';
  end if;
  if length(coalesce(clean_assignee_name, '')) > 100
    or length(coalesce(clean_group_name, '')) > 150
    or length(coalesce(clean_contact, '')) > 50
    or length(clean_note) > 1000 then
    raise exception '입력 내용이 허용 길이를 초과했습니다.';
  end if;

  requested_count := coalesce(cardinality(p_seat_ids), 0);
  if requested_count < 1 then
    raise exception '배분할 좌석을 한 개 이상 선택해 주세요.';
  end if;
  if requested_count > 694 then
    raise exception '한 번에 배분할 수 있는 좌석 수를 초과했습니다.';
  end if;
  if (select count(distinct seat_id) from unnest(p_seat_ids) as seat_id) <> requested_count then
    raise exception '선택 좌석에 중복 값이 있습니다.';
  end if;

  select id, hall_id, session_code, status
  into target_session_id, target_hall_id, target_session_code, target_session_status
  from public.event_sessions
  where session_code = p_session_code
  for update;

  if target_session_id is null then
    raise exception '행사 회차를 찾을 수 없습니다.';
  end if;
  if target_session_status in ('ended', 'cancelled') then
    raise exception '종료되거나 취소된 회차에는 좌석을 배분할 수 없습니다.';
  end if;
  if not (select private.can_manage_hall(target_hall_id)) then
    raise exception '이 회차의 좌석을 배분할 권한이 없습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));

  select count(*)
  into valid_count
  from public.seats seat
  join public.hall_floors floor on floor.id = seat.hall_floor_id
  where seat.id = any(p_seat_ids)
    and seat.is_active
    and floor.hall_id = target_hall_id;

  if valid_count <> requested_count then
    raise exception '이 홀에서 사용할 수 없는 좌석이 포함되어 있습니다.';
  end if;

  with upserted as (
    insert into public.session_seats (
      session_id,
      seat_id,
      allocation_status,
      admission_status,
      ticket_code,
      assignee_name,
      group_name,
      contact,
      note,
      allocated_by,
      allocated_at
    )
    select
      target_session_id,
      seat.id,
      'distributed',
      'not_entered',
      target_session_code || ':' || seat.seat_code,
      case when p_recipient_type = 'individual' then clean_assignee_name else clean_assignee_name end,
      case when p_recipient_type = 'group' then clean_group_name else null end,
      clean_contact,
      clean_note,
      caller_id,
      now()
    from public.seats seat
    where seat.id = any(p_seat_ids)
    on conflict (session_id, seat_id) do update
      set allocation_status = 'distributed',
          admission_status = 'not_entered',
          ticket_code = excluded.ticket_code,
          assignee_name = excluded.assignee_name,
          group_name = excluded.group_name,
          contact = excluded.contact,
          note = excluded.note,
          allocated_by = excluded.allocated_by,
          allocated_at = excluded.allocated_at,
          admitted_by = null,
          admitted_at = null,
          entrance_name = null,
          version = public.session_seats.version + 1
      where public.session_seats.allocation_status = 'available'
        and public.session_seats.admission_status = 'not_entered'
    returning id, seat_id, allocation_status, admission_status, assignee_name, group_name, contact, note, allocated_at
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
    upserted.id,
    caller_id,
    'allocate',
    '좌석 배분',
    null,
    jsonb_build_object(
      'seat_id', upserted.seat_id,
      'allocation_status', upserted.allocation_status,
      'admission_status', upserted.admission_status,
      'assignee_name', upserted.assignee_name,
      'group_name', upserted.group_name,
      'contact', upserted.contact,
      'note', upserted.note,
      'allocated_at', upserted.allocated_at
    )
  from upserted;

  get diagnostics allocated_count = row_count;
  if allocated_count <> requested_count then
    raise exception '이미 배분된 좌석이 포함되어 있습니다. 좌석 상태를 새로고침해 주세요.';
  end if;

  update public.event_sessions
  set status = 'allocation'
  where id = target_session_id and status = 'scheduled';

  return allocated_count;
end;
$$;

create or replace function public.allocate_session_seats(
  p_session_code text,
  p_seat_ids bigint[],
  p_recipient_type text,
  p_assignee_name text default null,
  p_group_name text default null,
  p_contact text default null,
  p_note text default ''
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.allocate_session_seats(
    p_session_code,
    p_seat_ids,
    p_recipient_type,
    p_assignee_name,
    p_group_name,
    p_contact,
    p_note
  )
$$;

revoke execute on function private.allocate_session_seats(text, bigint[], text, text, text, text, text) from public, anon;
grant execute on function private.allocate_session_seats(text, bigint[], text, text, text, text, text) to authenticated;

revoke execute on function public.allocate_session_seats(text, bigint[], text, text, text, text, text) from public, anon;
grant execute on function public.allocate_session_seats(text, bigint[], text, text, text, text, text) to authenticated;
