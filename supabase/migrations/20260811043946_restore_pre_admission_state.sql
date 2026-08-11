-- 입장 취소 시 단순 미입장 전환이 아니라 가장 최근 입장 직전의 배분 상태로 복원한다.
-- 기존 감사 로그는 배분 상태만 저장했으므로 available/held에는 안전한 호환 복원값을 사용한다.

create or replace function private.undo_session_admissions(
  p_session_code text,
  p_seat_ids bigint[],
  p_entrance_name text default '정문',
  p_reason text default '입장 취소'
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
  requested_count integer := coalesce(cardinality(p_seat_ids), 0);
  eligible_count integer;
  processed_count integer;
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name), ''), '정문');
  clean_reason text := coalesce(nullif(btrim(p_reason), ''), '입장 취소');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if requested_count < 1 then raise exception '취소할 좌석을 한 개 이상 선택해 주세요.'; end if;
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
    raise exception '이 회차의 입장을 취소할 권한이 없습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));

  select count(*) into eligible_count
  from (
    select session_seat.id
    from public.session_seats session_seat
    where session_seat.session_id = target_session_id
      and session_seat.seat_id = any(p_seat_ids)
      and session_seat.allocation_status = 'distributed'
      and session_seat.admission_status = 'entered'
    for update
  ) locked_session_seats;

  if eligible_count <> requested_count then
    raise exception '입장 완료 상태가 아닌 좌석이 포함되어 있습니다. 상태를 새로고침해 주세요.';
  end if;

  with targets as materialized (
    select session_seat.*,
           admission_log.before_state as admission_before,
           case
             when admission_log.before_state ->> 'allocation_status' in ('available', 'held', 'distributed')
               then admission_log.before_state ->> 'allocation_status'
             else 'distributed'
           end as restore_allocation_status
    from public.session_seats session_seat
    left join lateral (
      select audit.before_state
      from public.audit_logs audit
      where audit.session_id = target_session_id
        and audit.session_seat_id = session_seat.id
        and audit.action = 'check_in'
      order by audit.id desc
      limit 1
    ) admission_log on true
    where session_seat.session_id = target_session_id
      and session_seat.seat_id = any(p_seat_ids)
  ), updated as (
    update public.session_seats session_seat
    set allocation_status = targets.restore_allocation_status,
        admission_status = 'not_entered',
        ticket_code = case
          when targets.restore_allocation_status = 'available' then null
          when targets.restore_allocation_status = 'held' then coalesce(nullif(targets.admission_before ->> 'ticket_code', ''), session_seat.ticket_code)
          else session_seat.ticket_code
        end,
        assignee_name = case
          when targets.restore_allocation_status = 'available' then null
          when targets.restore_allocation_status = 'held' then coalesce(nullif(targets.admission_before ->> 'assignee_name', ''), '현장 확보')
          else session_seat.assignee_name
        end,
        group_name = case
          when targets.restore_allocation_status = 'available' then null
          when targets.restore_allocation_status = 'held' then coalesce(nullif(targets.admission_before ->> 'group_name', ''), '현장 좌석')
          else session_seat.group_name
        end,
        contact = case
          when targets.restore_allocation_status = 'available' then null
          when targets.restore_allocation_status = 'held' and targets.admission_before ? 'contact' then nullif(targets.admission_before ->> 'contact', '')
          else session_seat.contact
        end,
        note = case
          when targets.restore_allocation_status = 'available' then ''
          when targets.restore_allocation_status = 'held' and targets.admission_before ? 'note' then coalesce(targets.admission_before ->> 'note', '')
          when targets.restore_allocation_status = 'held' then regexp_replace(coalesce(session_seat.note, ''), '(\s*·\s*)?현장 입장$', '')
          else session_seat.note
        end,
        allocated_by = case
          when targets.restore_allocation_status = 'available' then null
          when targets.restore_allocation_status = 'held' and nullif(targets.admission_before ->> 'allocated_by', '') is not null then (targets.admission_before ->> 'allocated_by')::uuid
          else session_seat.allocated_by
        end,
        allocated_at = case
          when targets.restore_allocation_status = 'available' then null
          when targets.restore_allocation_status = 'held' and nullif(targets.admission_before ->> 'allocated_at', '') is not null then (targets.admission_before ->> 'allocated_at')::timestamptz
          else session_seat.allocated_at
        end,
        admitted_by = null,
        admitted_at = null,
        entrance_name = null,
        version = session_seat.version + 1
    from targets
    where session_seat.id = targets.id
    returning session_seat.*
  )
  insert into public.audit_logs (
    session_id, session_seat_id, actor_id, action, entrance_name, reason, before_state, after_state
  )
  select target_session_id, updated.id, caller_id, 'undo_check_in', clean_entrance, clean_reason,
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
           'admitted_by', targets.admitted_by,
           'admitted_at', targets.admitted_at,
           'entrance_name', targets.entrance_name,
           'version', targets.version
         ),
         jsonb_build_object(
           'seat_id', updated.seat_id,
           'allocation_status', updated.allocation_status,
           'admission_status', updated.admission_status,
           'ticket_code', updated.ticket_code,
           'assignee_name', updated.assignee_name,
           'group_name', updated.group_name,
           'contact', updated.contact,
           'note', updated.note,
           'allocated_by', updated.allocated_by,
           'allocated_at', updated.allocated_at,
           'admitted_by', updated.admitted_by,
           'admitted_at', updated.admitted_at,
           'entrance_name', updated.entrance_name,
           'version', updated.version
         )
  from updated join targets on targets.id = updated.id;

  get diagnostics processed_count = row_count;
  if processed_count <> requested_count then
    raise exception '입장 취소 중 좌석 상태가 변경되었습니다. 다시 시도해 주세요.';
  end if;

  update public.event_sessions set status = 'entry_ready'
  where id = target_session_id and status = 'entry_open'
    and not exists (
      select 1 from public.session_seats session_seat
      where session_seat.session_id = target_session_id and session_seat.admission_status = 'entered'
    );

  return processed_count;
end;
$$;

create or replace function public.undo_session_admissions(
  p_session_code text,
  p_seat_ids bigint[],
  p_entrance_name text default '정문',
  p_reason text default '입장 취소'
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.undo_session_admissions(p_session_code, p_seat_ids, p_entrance_name, p_reason)
$$;

revoke execute on function private.undo_session_admissions(text, bigint[], text, text) from public, anon;
revoke execute on function public.undo_session_admissions(text, bigint[], text, text) from public, anon;
grant execute on function private.undo_session_admissions(text, bigint[], text, text) to authenticated;
grant execute on function public.undo_session_admissions(text, bigint[], text, text) to authenticated;
