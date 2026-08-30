-- 행사 회차별 사용 제외 좌석을 일괄 설정/해제한다.
-- 실제 좌석 마스터는 유지하고 session_seats의 blocked 상태로만 운영 정원에서 제외한다.

create or replace function private.set_session_seat_block_status(
  p_session_code text,
  p_seat_ids bigint[],
  p_blocked boolean,
  p_reason text default '좌석 사용 제외 설정'
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
  target_status text;
  requested_count integer := coalesce(cardinality(p_seat_ids), 0);
  changed_count integer;
  clean_reason text := coalesce(nullif(btrim(p_reason), ''), case when p_blocked then '좌석 사용 제외 설정' else '좌석 사용 제외 해제' end);
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if requested_count < 1 or requested_count > 694 then raise exception '처리할 좌석을 한 개 이상 선택해 주세요.'; end if;
  if (select count(distinct seat_id) from unnest(p_seat_ids) as seat_id) <> requested_count then
    raise exception '선택 좌석에 중복 값이 있습니다.';
  end if;
  if length(clean_reason) > 500 then raise exception '사유는 500자 이내로 입력해 주세요.'; end if;

  select id, hall_id, status into target_session_id, target_hall_id, target_status
  from public.event_sessions where session_code = p_session_code for update;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_status in ('ended', 'cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_manage_hall(target_hall_id)) then raise exception '좌석 사용 제외를 설정할 권한이 없습니다.'; end if;
  if (select count(*) from public.seats s join public.hall_floors f on f.id = s.hall_floor_id
      where f.hall_id = target_hall_id and s.is_active and s.id = any(p_seat_ids)) <> requested_count then
    raise exception '현재 홀에 속하지 않는 좌석이 포함되어 있습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));

  if p_blocked then
    if (select count(*) from public.session_seats ss where ss.session_id = target_session_id
        and ss.seat_id = any(p_seat_ids) and (ss.allocation_status <> 'available' or ss.admission_status <> 'not_entered')) > 0 then
      raise exception '이미 배분·확보·입장된 좌석이 포함되어 있습니다.';
    end if;

    with targets as materialized (
      select s.id as seat_id from public.seats s join public.hall_floors f on f.id = s.hall_floor_id
      where f.hall_id = target_hall_id and s.is_active and s.id = any(p_seat_ids)
    ), changed as (
      insert into public.session_seats(session_id, seat_id, allocation_status, admission_status, note, allocated_by, allocated_at)
      select target_session_id, seat_id, 'blocked', 'not_entered', clean_reason, caller_id, now() from targets
      on conflict(session_id, seat_id) do update set
        allocation_status = 'blocked', admission_status = 'not_entered', ticket_code = null,
        assignee_name = null, group_name = null, contact = null, note = clean_reason,
        allocated_by = caller_id, allocated_at = now(), admitted_by = null, admitted_at = null,
        entrance_name = null, version = public.session_seats.version + 1
      where public.session_seats.allocation_status = 'available' and public.session_seats.admission_status = 'not_entered'
      returning id, seat_id, version
    )
    insert into public.audit_logs(session_id, session_seat_id, actor_id, action, reason, before_state, after_state)
    select target_session_id, id, caller_id, 'block', clean_reason,
      jsonb_build_object('seat_id', seat_id, 'allocation_status', 'available', 'admission_status', 'not_entered'),
      jsonb_build_object('seat_id', seat_id, 'allocation_status', 'blocked', 'admission_status', 'not_entered', 'version', version)
    from changed;
  else
    if (select count(*) from public.session_seats ss where ss.session_id = target_session_id
        and ss.seat_id = any(p_seat_ids) and ss.allocation_status = 'blocked' and ss.admission_status = 'not_entered') <> requested_count then
      raise exception '사용 제외 상태가 아닌 좌석이 포함되어 있습니다.';
    end if;

    with old as materialized (
      select * from public.session_seats where session_id = target_session_id and seat_id = any(p_seat_ids) for update
    ), changed as (
      update public.session_seats ss set allocation_status = 'available', note = '', allocated_by = null,
        allocated_at = null, version = ss.version + 1 from old where ss.id = old.id
      returning ss.id, ss.seat_id, ss.version
    )
    insert into public.audit_logs(session_id, session_seat_id, actor_id, action, reason, before_state, after_state)
    select target_session_id, changed.id, caller_id, 'unblock', clean_reason,
      jsonb_build_object('seat_id', old.seat_id, 'allocation_status', 'blocked', 'admission_status', old.admission_status, 'version', old.version),
      jsonb_build_object('seat_id', changed.seat_id, 'allocation_status', 'available', 'admission_status', 'not_entered', 'version', changed.version)
    from changed join old on old.id = changed.id;
  end if;

  get diagnostics changed_count = row_count;
  if changed_count <> requested_count then raise exception '좌석 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  return changed_count;
end;
$$;

create or replace function public.set_session_seat_block_status(
  p_session_code text,
  p_seat_ids bigint[],
  p_blocked boolean,
  p_reason text default '좌석 사용 제외 설정'
)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.set_session_seat_block_status(p_session_code, p_seat_ids, p_blocked, p_reason) $$;

revoke execute on function private.set_session_seat_block_status(text, bigint[], boolean, text) from public, anon;
grant execute on function private.set_session_seat_block_status(text, bigint[], boolean, text) to authenticated;
revoke execute on function public.set_session_seat_block_status(text, bigint[], boolean, text) from public, anon;
grant execute on function public.set_session_seat_block_status(text, bigint[], boolean, text) to authenticated;
