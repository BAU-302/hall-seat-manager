create or replace function private.can_operate_hall(target_hall_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.current_app_role()) = 'super_admin'
    or (
      (select private.current_app_role()) in ('event_manager', 'entrance_staff')
      and (select private.can_access_hall(target_hall_id))
    )
$$;

create or replace function private.operate_session_admissions(
  p_session_code text,
  p_seat_ids bigint[],
  p_mode text,
  p_entrance_name text default '정문',
  p_reason text default '입장 관리 화면에서 취소'
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
  eligible_count integer;
  processed_count integer;
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name), ''), '정문');
  clean_reason text := coalesce(nullif(btrim(p_reason), ''), '입장 관리 화면에서 취소');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_mode not in ('admit', 'undo') then raise exception '입장 처리 방식이 올바르지 않습니다.'; end if;
  requested_count := coalesce(cardinality(p_seat_ids), 0);
  if requested_count < 1 then raise exception '처리할 좌석을 한 개 이상 선택해 주세요.'; end if;
  if requested_count > 694 then raise exception '한 번에 처리할 수 있는 좌석 수를 초과했습니다.'; end if;
  if (select count(distinct seat_id) from unnest(p_seat_ids) as seat_id) <> requested_count then
    raise exception '선택 좌석에 중복 값이 있습니다.';
  end if;
  if length(clean_entrance) > 100 or length(clean_reason) > 500 then
    raise exception '입력 내용이 허용 길이를 초과했습니다.';
  end if;

  select id, hall_id, status into target_session_id, target_hall_id, target_session_status
  from public.event_sessions where session_code = p_session_code for update;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_session_status in ('ended', 'cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_operate_hall(target_hall_id)) then
    raise exception '이 회차의 입장을 처리할 권한이 없습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));

  select count(*) into eligible_count
  from (
    select session_seat.id
    from public.session_seats session_seat
    where session_seat.session_id = target_session_id
      and session_seat.seat_id = any(p_seat_ids)
      and session_seat.allocation_status = 'distributed'
      and session_seat.admission_status = case when p_mode = 'admit' then 'not_entered' else 'entered' end
    for update
  ) locked_session_seats;

  if eligible_count <> requested_count then
    if p_mode = 'admit' then
      raise exception '배분되지 않았거나 이미 입장한 좌석이 포함되어 있습니다. 상태를 새로고침해 주세요.';
    else
      raise exception '입장 완료 상태가 아닌 좌석이 포함되어 있습니다. 상태를 새로고침해 주세요.';
    end if;
  end if;

  with targets as materialized (
    select session_seat.id, session_seat.seat_id, session_seat.allocation_status,
           session_seat.admission_status, session_seat.admitted_by,
           session_seat.admitted_at, session_seat.entrance_name, session_seat.version
    from public.session_seats session_seat
    where session_seat.session_id = target_session_id
      and session_seat.seat_id = any(p_seat_ids)
  ), updated as (
    update public.session_seats session_seat
    set admission_status = case when p_mode = 'admit' then 'entered' else 'not_entered' end,
        admitted_by = case when p_mode = 'admit' then caller_id else null end,
        admitted_at = case when p_mode = 'admit' then now() else null end,
        entrance_name = case when p_mode = 'admit' then clean_entrance else null end,
        version = session_seat.version + 1
    from targets
    where session_seat.id = targets.id
    returning session_seat.id, session_seat.seat_id, session_seat.admitted_at,
              session_seat.entrance_name, session_seat.version
  )
  insert into public.audit_logs (
    session_id, session_seat_id, actor_id, action, reason, before_state, after_state
  )
  select target_session_id, updated.id, caller_id,
         case when p_mode = 'admit' then 'check_in' else 'undo_check_in' end,
         case when p_mode = 'admit' then '입장 운영 화면에서 처리' else clean_reason end,
         jsonb_build_object(
           'seat_id', targets.seat_id,
           'allocation_status', targets.allocation_status,
           'admission_status', targets.admission_status,
           'admitted_by', targets.admitted_by,
           'admitted_at', targets.admitted_at,
           'entrance_name', targets.entrance_name,
           'version', targets.version
         ),
         jsonb_build_object(
           'seat_id', updated.seat_id,
           'allocation_status', 'distributed',
           'admission_status', case when p_mode = 'admit' then 'entered' else 'not_entered' end,
           'admitted_by', case when p_mode = 'admit' then caller_id else null end,
           'admitted_at', updated.admitted_at,
           'entrance_name', updated.entrance_name,
           'version', updated.version
         )
  from updated join targets on targets.id = updated.id;

  get diagnostics processed_count = row_count;
  if processed_count <> requested_count then raise exception '입장 처리 중 좌석 상태가 변경되었습니다. 다시 시도해 주세요.'; end if;

  if p_mode = 'admit' then
    update public.event_sessions set status = 'entry_open'
    where id = target_session_id and status not in ('ended', 'cancelled');
  else
    update public.event_sessions set status = 'entry_ready'
    where id = target_session_id and status = 'entry_open'
      and not exists (
        select 1 from public.session_seats session_seat
        where session_seat.session_id = target_session_id and session_seat.admission_status = 'entered'
      );
  end if;

  return processed_count;
end;
$$;

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
  target_seat_id bigint;
  target_seat_code text;
  target_floor_name text;
  target_assignee_name text;
  target_group_name text;
  target_admitted_at timestamptz;
  clean_ticket_code text := nullif(btrim(p_ticket_code), '');
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name), ''), '정문');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if clean_ticket_code is null then raise exception 'QR 티켓 코드가 비어 있습니다.'; end if;
  if length(clean_ticket_code) > 300 then raise exception 'QR 티켓 코드가 너무 깁니다.'; end if;

  select id, hall_id into target_session_id, target_hall_id
  from public.event_sessions where session_code = p_session_code;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if not (select private.can_operate_hall(target_hall_id)) then
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
  if target_seat_id is null then raise exception '현재 회차에서 사용할 수 없는 QR입니다.'; end if;

  perform private.operate_session_admissions(
    p_session_code, array[target_seat_id], 'admit', clean_entrance, ''
  );
  select admitted_at into target_admitted_at
  from public.session_seats where session_id = target_session_id and seat_id = target_seat_id;

  return jsonb_build_object(
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

create or replace function private.configure_staff_access(
  p_user_id uuid,
  p_role text,
  p_hall_codes text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  hall_count integer;
begin
  if (select auth.uid()) is null then raise exception '로그인이 필요합니다.'; end if;
  if (select private.current_app_role()) <> 'super_admin' then raise exception '최고 관리자만 직원 권한을 설정할 수 있습니다.'; end if;
  if p_role not in ('event_manager', 'entrance_staff') then raise exception '설정할 수 없는 직원 역할입니다.'; end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id and role <> 'super_admin') then
    raise exception '설정할 수 있는 직원 계정을 찾지 못했습니다.';
  end if;
  if coalesce(cardinality(p_hall_codes), 0) <> (select count(distinct code) from unnest(coalesce(p_hall_codes, array[]::text[])) code) then
    raise exception '홀 선택에 중복 값이 있습니다.';
  end if;

  update public.profiles set role = p_role where user_id = p_user_id;
  delete from public.staff_hall_access where user_id = p_user_id;
  insert into public.staff_hall_access(user_id, hall_id)
  select p_user_id, hall.id
  from public.halls hall
  where hall.code = any(coalesce(p_hall_codes, array[]::text[])) and hall.is_active;
  get diagnostics hall_count = row_count;
  if hall_count <> coalesce(cardinality(p_hall_codes), 0) then raise exception '선택한 홀 중 사용할 수 없는 홀이 있습니다.'; end if;
  return hall_count;
end;
$$;

create or replace function public.operate_session_admissions(
  p_session_code text, p_seat_ids bigint[], p_mode text,
  p_entrance_name text default '정문', p_reason text default '입장 관리 화면에서 취소'
)
returns integer language sql security invoker set search_path = ''
as $$ select private.operate_session_admissions(p_session_code, p_seat_ids, p_mode, p_entrance_name, p_reason) $$;

create or replace function public.operate_session_ticket(
  p_session_code text, p_ticket_code text, p_entrance_name text default '정문'
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.operate_session_ticket(p_session_code, p_ticket_code, p_entrance_name) $$;

create or replace function public.configure_staff_access(
  p_user_id uuid, p_role text, p_hall_codes text[]
)
returns integer language sql security invoker set search_path = ''
as $$ select private.configure_staff_access(p_user_id, p_role, p_hall_codes) $$;

revoke execute on function private.can_operate_hall(bigint) from public, anon;
grant execute on function private.can_operate_hall(bigint) to authenticated;
revoke execute on function private.operate_session_admissions(text, bigint[], text, text, text) from public, anon;
grant execute on function private.operate_session_admissions(text, bigint[], text, text, text) to authenticated;
revoke execute on function private.operate_session_ticket(text, text, text) from public, anon;
grant execute on function private.operate_session_ticket(text, text, text) to authenticated;
revoke execute on function private.configure_staff_access(uuid, text, text[]) from public, anon;
grant execute on function private.configure_staff_access(uuid, text, text[]) to authenticated;

revoke execute on function public.operate_session_admissions(text, bigint[], text, text, text) from public, anon;
grant execute on function public.operate_session_admissions(text, bigint[], text, text, text) to authenticated;
revoke execute on function public.operate_session_ticket(text, text, text) from public, anon;
grant execute on function public.operate_session_ticket(text, text, text) to authenticated;
revoke execute on function public.configure_staff_access(uuid, text, text[]) from public, anon;
grant execute on function public.configure_staff_access(uuid, text, text[]) to authenticated;

insert into public.staff_hall_access(user_id, hall_id)
select profile.user_id, hall.id
from public.profiles profile
cross join public.halls hall
where profile.role = 'entrance_staff'
  and hall.code = 'haeun'
  and hall.is_active
on conflict (user_id, hall_id) do nothing;
