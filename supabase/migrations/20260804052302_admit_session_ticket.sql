create or replace function private.admit_session_ticket(
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
  target_seat_id bigint;
  target_seat_code text;
  target_floor_name text;
  target_assignee_name text;
  target_group_name text;
  clean_ticket_code text := nullif(btrim(p_ticket_code), '');
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name), ''), '정문');
  admitted_count integer;
begin
  if caller_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if clean_ticket_code is null then
    raise exception 'QR 티켓 코드가 비어 있습니다.';
  end if;
  if length(clean_ticket_code) > 300 then
    raise exception 'QR 티켓 코드가 너무 깁니다.';
  end if;
  if length(clean_entrance) > 100 then
    raise exception '입구명은 100자 이내로 입력해 주세요.';
  end if;

  select session.id, session.hall_id
  into target_session_id, target_hall_id
  from public.event_sessions session
  where session.session_code = p_session_code;

  if target_session_id is null then
    raise exception '행사 회차를 찾을 수 없습니다.';
  end if;
  if not (select private.can_manage_hall(target_hall_id)) then
    raise exception '이 회차의 입장을 처리할 권한이 없습니다.';
  end if;

  select session_seat.seat_id, seat.seat_code, floor.name,
         session_seat.assignee_name, session_seat.group_name
  into target_seat_id, target_seat_code, target_floor_name,
       target_assignee_name, target_group_name
  from public.session_seats session_seat
  join public.seats seat on seat.id = session_seat.seat_id
  join public.hall_floors floor on floor.id = seat.hall_floor_id
  where session_seat.session_id = target_session_id
    and session_seat.ticket_code = clean_ticket_code
    and session_seat.allocation_status = 'distributed';

  if target_seat_id is null then
    raise exception '현재 회차에서 사용할 수 없는 QR입니다.';
  end if;

  admitted_count := private.admit_session_seats(
    p_session_code,
    array[target_seat_id],
    clean_entrance
  );

  if admitted_count <> 1 then
    raise exception 'QR 입장 처리에 실패했습니다.';
  end if;

  return jsonb_build_object(
    'seat_id', target_seat_id,
    'seat_code', target_seat_code,
    'floor_name', target_floor_name,
    'assignee_name', target_assignee_name,
    'group_name', target_group_name,
    'entrance_name', clean_entrance,
    'admitted_at', now()
  );
end;
$$;

create or replace function public.admit_session_ticket(
  p_session_code text,
  p_ticket_code text,
  p_entrance_name text default '정문'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admit_session_ticket(
    p_session_code,
    p_ticket_code,
    p_entrance_name
  )
$$;

revoke execute on function private.admit_session_ticket(text, text, text) from public, anon;
grant execute on function private.admit_session_ticket(text, text, text) to authenticated;

revoke execute on function public.admit_session_ticket(text, text, text) from public, anon;
grant execute on function public.admit_session_ticket(text, text, text) to authenticated;
