create or replace function private.operate_session_ticket(
  p_session_code text,
  p_ticket_code text,
  p_entrance_name text default '정문'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_session_id bigint;
  target_hall_id bigint;
  target_session_status text;
  target_seat_id bigint;
  target_seat_code text;
  target_floor_name text;
  target_allocation_status text;
  target_admission_status text;
  target_assignee_name text;
  target_group_name text;
  target_admitted_at timestamptz;
  clean_ticket_code text := nullif(btrim(p_ticket_code), '');
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name), ''), '정문');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if clean_ticket_code is null then raise exception 'QR 티켓 코드가 비어 있습니다.'; end if;
  if length(clean_ticket_code) > 300 then raise exception 'QR 티켓 코드가 너무 깁니다.'; end if;
  if length(clean_entrance) > 100 then raise exception '입구 이름이 너무 깁니다.'; end if;

  select id, hall_id, status
  into target_session_id, target_hall_id, target_session_status
  from public.event_sessions
  where session_code = p_session_code;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_session_status in ('ended', 'cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_operate_hall(target_hall_id)) then
    raise exception '이 회차의 입장을 처리할 권한이 없습니다.';
  end if;

  select seat.id, seat.seat_code, floor.name
  into target_seat_id, target_seat_code, target_floor_name
  from public.seats seat
  join public.hall_floors floor on floor.id = seat.hall_floor_id
  where floor.hall_id = target_hall_id
    and seat.is_active
    and clean_ticket_code = p_session_code || ':' || seat.seat_code;
  if target_seat_id is null then raise exception '현재 회차에서 사용할 수 없는 QR입니다.'; end if;

  select session_seat.allocation_status, session_seat.admission_status,
         session_seat.assignee_name, session_seat.group_name
  into target_allocation_status, target_admission_status,
       target_assignee_name, target_group_name
  from public.session_seats session_seat
  where session_seat.session_id = target_session_id
    and session_seat.seat_id = target_seat_id;

  if target_allocation_status is null or target_allocation_status = 'available' then
    return jsonb_build_object(
      'status', 'onsite_confirmation_required',
      'seat_id', target_seat_id,
      'seat_code', target_seat_code,
      'floor_name', target_floor_name,
      'assignee_name', null,
      'group_name', null,
      'entrance_name', clean_entrance,
      'admitted_at', null
    );
  end if;
  if target_allocation_status <> 'distributed' then
    raise exception '현재 입장 처리할 수 없는 좌석입니다.';
  end if;
  if target_admission_status = 'entered' then
    raise exception '이미 입장 완료된 QR입니다.';
  end if;

  perform private.operate_session_admissions(
    p_session_code, array[target_seat_id], 'admit', clean_entrance, ''
  );
  select admitted_at into target_admitted_at
  from public.session_seats
  where session_id = target_session_id and seat_id = target_seat_id;

  return jsonb_build_object(
    'status', 'admitted',
    'seat_id', target_seat_id,
    'seat_code', target_seat_code,
    'floor_name', target_floor_name,
    'assignee_name', target_assignee_name,
    'group_name', target_group_name,
    'entrance_name', clean_entrance,
    'admitted_at', target_admitted_at
  );
end;
$$;

create or replace function private.confirm_onsite_ticket(
  p_session_code text,
  p_ticket_code text,
  p_entrance_name text default '정문',
  p_assignee_name text default '현장 입장'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_session_id bigint;
  target_hall_id bigint;
  target_session_status text;
  target_seat_id bigint;
  target_seat_code text;
  target_floor_name text;
  target_session_seat_id bigint;
  target_admitted_at timestamptz;
  existing_allocation_status text;
  existing_admission_status text;
  existing_version integer;
  clean_ticket_code text := nullif(btrim(p_ticket_code), '');
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name), ''), '정문');
  clean_assignee text := coalesce(nullif(btrim(p_assignee_name), ''), '현장 입장');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if clean_ticket_code is null then raise exception 'QR 티켓 코드가 비어 있습니다.'; end if;
  if length(clean_ticket_code) > 300 or length(clean_entrance) > 100 or length(clean_assignee) > 100 then
    raise exception '입력 내용이 허용 길이를 초과했습니다.';
  end if;

  select id, hall_id, status
  into target_session_id, target_hall_id, target_session_status
  from public.event_sessions
  where session_code = p_session_code
  for update;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_session_status in ('ended', 'cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_operate_hall(target_hall_id)) then
    raise exception '이 회차의 현장 입장을 처리할 권한이 없습니다.';
  end if;

  select seat.id, seat.seat_code, floor.name
  into target_seat_id, target_seat_code, target_floor_name
  from public.seats seat
  join public.hall_floors floor on floor.id = seat.hall_floor_id
  where floor.hall_id = target_hall_id
    and seat.is_active
    and clean_ticket_code = p_session_code || ':' || seat.seat_code;
  if target_seat_id is null then raise exception '현재 회차에서 사용할 수 없는 QR입니다.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));

  select allocation_status, admission_status, version
  into existing_allocation_status, existing_admission_status, existing_version
  from public.session_seats
  where session_id = target_session_id and seat_id = target_seat_id
  for update;

  if existing_allocation_status is not null and existing_allocation_status <> 'available' then
    if existing_admission_status = 'entered' then raise exception '이미 입장 완료된 QR입니다.'; end if;
    raise exception '다른 대상에게 이미 배정된 좌석입니다. 상태를 새로고침해 주세요.';
  end if;

  insert into public.session_seats (
    session_id, seat_id, allocation_status, admission_status, ticket_code,
    assignee_name, group_name, note, allocated_by, allocated_at,
    admitted_by, admitted_at, entrance_name
  ) values (
    target_session_id, target_seat_id, 'distributed', 'entered', clean_ticket_code,
    clean_assignee, null, 'QR 스캔 현장 배정', caller_id, now(),
    caller_id, now(), clean_entrance
  )
  on conflict (session_id, seat_id) do update
    set allocation_status = 'distributed',
        admission_status = 'entered',
        ticket_code = excluded.ticket_code,
        assignee_name = excluded.assignee_name,
        group_name = null,
        note = excluded.note,
        allocated_by = excluded.allocated_by,
        allocated_at = excluded.allocated_at,
        admitted_by = excluded.admitted_by,
        admitted_at = excluded.admitted_at,
        entrance_name = excluded.entrance_name,
        version = public.session_seats.version + 1
    where public.session_seats.allocation_status = 'available'
      and public.session_seats.admission_status = 'not_entered'
  returning id, admitted_at into target_session_seat_id, target_admitted_at;

  if target_session_seat_id is null then
    raise exception '좌석 상태가 변경되었습니다. 다시 스캔해 주세요.';
  end if;

  insert into public.audit_logs (
    session_id, session_seat_id, actor_id, action, entrance_name,
    reason, before_state, after_state
  ) values (
    target_session_id, target_session_seat_id, caller_id, 'reassign', clean_entrance,
    'QR 현장 배정 후 입장',
    jsonb_build_object(
      'seat_id', target_seat_id,
      'allocation_status', coalesce(existing_allocation_status, 'available'),
      'admission_status', coalesce(existing_admission_status, 'not_entered'),
      'version', coalesce(existing_version, 0)
    ),
    jsonb_build_object(
      'seat_id', target_seat_id,
      'allocation_status', 'distributed',
      'admission_status', 'entered',
      'assignee_name', clean_assignee,
      'onsite', true
    )
  );

  update public.event_sessions
  set status = 'entry_open'
  where id = target_session_id and status not in ('ended', 'cancelled');

  return jsonb_build_object(
    'status', 'onsite_admitted',
    'seat_id', target_seat_id,
    'seat_code', target_seat_code,
    'floor_name', target_floor_name,
    'assignee_name', clean_assignee,
    'group_name', null,
    'entrance_name', clean_entrance,
    'admitted_at', target_admitted_at
  );
end;
$$;

create or replace function public.confirm_onsite_ticket(
  p_session_code text,
  p_ticket_code text,
  p_entrance_name text default '정문',
  p_assignee_name text default '현장 입장'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.confirm_onsite_ticket(
    p_session_code, p_ticket_code, p_entrance_name, p_assignee_name
  )
$$;

revoke execute on function private.confirm_onsite_ticket(text, text, text, text) from public, anon;
grant execute on function private.confirm_onsite_ticket(text, text, text, text) to authenticated;
revoke execute on function public.confirm_onsite_ticket(text, text, text, text) from public, anon;
grant execute on function public.confirm_onsite_ticket(text, text, text, text) to authenticated;
