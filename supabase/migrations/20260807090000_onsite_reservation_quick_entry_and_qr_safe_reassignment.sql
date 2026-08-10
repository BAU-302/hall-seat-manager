-- 현장 좌석 확보, 미배정 좌석 입장, QR 보존 재배정을 하나의 원자적 운영 흐름으로 묶는다.

create or replace function private.reserve_onsite_session_seats(
  p_session_code text,
  p_seat_ids bigint[],
  p_note text default '현장 운영용 사전 확보'
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
  clean_note text := coalesce(nullif(btrim(p_note), ''), '현장 운영용 사전 확보');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if requested_count < 1 or requested_count > 694 then raise exception '확보할 좌석을 1석 이상 선택해 주세요.'; end if;
  if (select count(distinct value) from unnest(p_seat_ids) as value) <> requested_count then raise exception '선택 좌석에 중복 값이 있습니다.'; end if;
  if length(clean_note) > 500 then raise exception '메모는 500자 이내로 입력해 주세요.'; end if;

  select id, hall_id, status into target_session_id, target_hall_id, target_status
  from public.event_sessions where session_code = p_session_code for update;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_status in ('ended', 'cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_manage_hall(target_hall_id)) then raise exception '현장 좌석을 확보할 권한이 없습니다.'; end if;
  if (select count(*) from public.seats s join public.hall_floors f on f.id=s.hall_floor_id where f.hall_id=target_hall_id and s.is_active and s.id=any(p_seat_ids)) <> requested_count then
    raise exception '현재 홀에 속하지 않는 좌석이 포함되어 있습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));

  with targets as materialized (
    select s.id as seat_id, s.seat_code
    from public.seats s join public.hall_floors f on f.id=s.hall_floor_id
    where f.hall_id=target_hall_id and s.id=any(p_seat_ids)
  ), changed as (
    insert into public.session_seats (
      session_id, seat_id, allocation_status, admission_status, ticket_code,
      assignee_name, group_name, note, allocated_by, allocated_at
    )
    select target_session_id, seat_id, 'held', 'not_entered', p_session_code || ':' || seat_code,
           '현장 확보', '현장 좌석', clean_note, caller_id, now()
    from targets
    on conflict (session_id, seat_id) do update
      set allocation_status='held', admission_status='not_entered',
          ticket_code=excluded.ticket_code, assignee_name='현장 확보', group_name='현장 좌석',
          contact=null, note=excluded.note, allocated_by=caller_id, allocated_at=now(),
          admitted_by=null, admitted_at=null, entrance_name=null,
          version=public.session_seats.version+1
      where public.session_seats.allocation_status='available'
        and public.session_seats.admission_status='not_entered'
    returning id, seat_id, version
  )
  insert into public.audit_logs(session_id,session_seat_id,actor_id,action,reason,before_state,after_state)
  select target_session_id,id,caller_id,'hold',clean_note,
         jsonb_build_object('seat_id',seat_id,'allocation_status','available','admission_status','not_entered'),
         jsonb_build_object('seat_id',seat_id,'allocation_status','held','admission_status','not_entered','version',version)
  from changed;
  get diagnostics changed_count = row_count;
  if changed_count <> requested_count then raise exception '이미 사용 중인 좌석이 포함되어 있습니다. 상태를 새로고침해 주세요.'; end if;
  update public.event_sessions set status='allocation' where id=target_session_id and status='scheduled';
  return changed_count;
end;
$$;

create or replace function private.admit_session_seat(
  p_session_code text,
  p_seat_id bigint,
  p_entrance_name text default '태블릿 좌석표'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_session_id bigint; target_hall_id bigint; target_status text;
  target_seat_code text; target_floor_name text;
  old_record public.session_seats%rowtype;
  saved_record public.session_seats%rowtype;
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name),''),'태블릿 좌석표');
  onsite boolean := false;
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_seat_id is null then raise exception '좌석을 선택해 주세요.'; end if;
  if length(clean_entrance)>100 then raise exception '입구 이름이 너무 깁니다.'; end if;
  select id,hall_id,status into target_session_id,target_hall_id,target_status
  from public.event_sessions where session_code=p_session_code for update;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_status in ('ended','cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_operate_hall(target_hall_id)) then raise exception '이 회차의 입장을 처리할 권한이 없습니다.'; end if;
  select s.seat_code,f.name into target_seat_code,target_floor_name
  from public.seats s join public.hall_floors f on f.id=s.hall_floor_id
  where s.id=p_seat_id and s.is_active and f.hall_id=target_hall_id;
  if target_seat_code is null then raise exception '현재 홀에서 사용할 수 없는 좌석입니다.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text, 0));
  select * into old_record from public.session_seats
  where session_id=target_session_id and seat_id=p_seat_id for update;
  if old_record.admission_status='entered' then raise exception '이미 입장 완료된 좌석입니다.'; end if;
  if old_record.allocation_status='blocked' then raise exception '사용 중지된 좌석입니다.'; end if;
  onsite := old_record.id is null or old_record.allocation_status in ('available','held');

  insert into public.session_seats(
    session_id,seat_id,allocation_status,admission_status,ticket_code,
    assignee_name,group_name,contact,note,allocated_by,allocated_at,
    admitted_by,admitted_at,entrance_name
  ) values (
    target_session_id,p_seat_id,'distributed','entered',p_session_code || ':' || target_seat_code,
    '현장 입장',null,null,'좌석표 현장 입장',caller_id,now(),caller_id,now(),clean_entrance
  )
  on conflict(session_id,seat_id) do update set
    allocation_status='distributed', admission_status='entered',
    ticket_code=coalesce(public.session_seats.ticket_code,excluded.ticket_code),
    assignee_name=case when public.session_seats.allocation_status in ('available','held') then '현장 입장' else public.session_seats.assignee_name end,
    group_name=case when public.session_seats.allocation_status='available' then null else public.session_seats.group_name end,
    note=case when public.session_seats.allocation_status in ('available','held') then concat_ws(' · ',nullif(public.session_seats.note,''),'현장 입장') else public.session_seats.note end,
    allocated_by=coalesce(public.session_seats.allocated_by,caller_id),
    allocated_at=coalesce(public.session_seats.allocated_at,now()),
    admitted_by=caller_id, admitted_at=now(), entrance_name=clean_entrance,
    version=public.session_seats.version+1
  where public.session_seats.allocation_status in ('available','held','distributed')
    and public.session_seats.admission_status='not_entered'
  returning * into saved_record;
  if saved_record.id is null then raise exception '좌석 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;

  insert into public.audit_logs(session_id,session_seat_id,actor_id,action,entrance_name,reason,before_state,after_state)
  values(target_session_id,saved_record.id,caller_id,'check_in',clean_entrance,
    case when onsite then '좌석표에서 현장 배정 후 입장' else '좌석표 입장' end,
    jsonb_build_object('seat_id',p_seat_id,'allocation_status',coalesce(old_record.allocation_status,'available'),'admission_status',coalesce(old_record.admission_status,'not_entered'),'version',coalesce(old_record.version,0)),
    jsonb_build_object('seat_id',p_seat_id,'allocation_status','distributed','admission_status','entered','onsite',onsite,'version',saved_record.version));
  update public.event_sessions set status='entry_open' where id=target_session_id and status not in ('ended','cancelled');
  return jsonb_build_object('status',case when onsite then 'onsite_admitted' else 'admitted' end,
    'seat_id',p_seat_id,'seat_code',target_seat_code,'floor_name',target_floor_name,
    'assignee_name',saved_record.assignee_name,'group_name',saved_record.group_name,
    'entrance_name',clean_entrance,'admitted_at',saved_record.admitted_at);
end;
$$;

create or replace function private.reassign_session_seat(
  p_session_code text,
  p_from_seat_id bigint,
  p_to_seat_id bigint,
  p_reason text default '현장 좌석 변경'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_session_id bigint; target_hall_id bigint; target_status text;
  source_record public.session_seats%rowtype; target_record public.session_seats%rowtype; saved_record public.session_seats%rowtype;
  source_code text; target_code text; source_floor text; target_floor text;
  clean_reason text := coalesce(nullif(btrim(p_reason),''),'현장 좌석 변경');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_from_seat_id is null or p_to_seat_id is null or p_from_seat_id=p_to_seat_id then raise exception '서로 다른 기존 좌석과 새 좌석을 선택해 주세요.'; end if;
  if length(clean_reason)>500 then raise exception '재배정 사유는 500자 이내로 입력해 주세요.'; end if;
  select id,hall_id,status into target_session_id,target_hall_id,target_status from public.event_sessions where session_code=p_session_code for update;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_status in ('ended','cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_manage_hall(target_hall_id)) then raise exception '현장 재배정 권한이 없습니다.'; end if;
  select s.seat_code,f.name into source_code,source_floor from public.seats s join public.hall_floors f on f.id=s.hall_floor_id where s.id=p_from_seat_id and s.is_active and f.hall_id=target_hall_id;
  select s.seat_code,f.name into target_code,target_floor from public.seats s join public.hall_floors f on f.id=s.hall_floor_id where s.id=p_to_seat_id and s.is_active and f.hall_id=target_hall_id;
  if source_code is null or target_code is null then raise exception '현재 홀에 속하지 않는 좌석입니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text,0));
  perform 1 from public.session_seats where session_id=target_session_id and seat_id in (p_from_seat_id,p_to_seat_id) order by seat_id for update;
  select * into source_record from public.session_seats where session_id=target_session_id and seat_id=p_from_seat_id;
  select * into target_record from public.session_seats where session_id=target_session_id and seat_id=p_to_seat_id;
  if source_record.id is null or source_record.allocation_status<>'distributed' then raise exception '기존 좌석은 배분된 좌석이어야 합니다.'; end if;
  if target_record.id is not null and target_record.allocation_status<>'available' then raise exception '새 좌석이 이미 배분 또는 확보되어 있습니다.'; end if;

  -- 고유 QR 충돌을 피하기 위해 원본 행에서 코드를 먼저 비운 뒤 동일 트랜잭션 안에서 새 좌석으로 이동한다.
  update public.session_seats set allocation_status='available',admission_status='not_entered',ticket_code=null,
    assignee_name=null,group_name=null,contact=null,note='',allocated_by=null,allocated_at=null,
    admitted_by=null,admitted_at=null,entrance_name=null,version=version+1
  where id=source_record.id;

  insert into public.session_seats(session_id,seat_id,allocation_status,admission_status,ticket_code,
    assignee_name,group_name,contact,note,allocated_by,allocated_at,admitted_by,admitted_at,entrance_name,version)
  values(target_session_id,p_to_seat_id,source_record.allocation_status,source_record.admission_status,source_record.ticket_code,
    source_record.assignee_name,source_record.group_name,source_record.contact,
    concat_ws(' · ',nullif(source_record.note,''),clean_reason),source_record.allocated_by,source_record.allocated_at,
    source_record.admitted_by,source_record.admitted_at,source_record.entrance_name,1)
  on conflict(session_id,seat_id) do update set
    allocation_status=excluded.allocation_status,admission_status=excluded.admission_status,ticket_code=excluded.ticket_code,
    assignee_name=excluded.assignee_name,group_name=excluded.group_name,contact=excluded.contact,note=excluded.note,
    allocated_by=excluded.allocated_by,allocated_at=excluded.allocated_at,admitted_by=excluded.admitted_by,
    admitted_at=excluded.admitted_at,entrance_name=excluded.entrance_name,version=public.session_seats.version+1
  where public.session_seats.allocation_status='available'
  returning * into saved_record;
  if saved_record.id is null then raise exception '새 좌석 상태가 변경되었습니다. 다시 시도해 주세요.'; end if;
  insert into public.audit_logs(session_id,session_seat_id,actor_id,action,reason,before_state,after_state)
  values(target_session_id,saved_record.id,caller_id,'reassign',clean_reason,
    jsonb_build_object('seat_id',p_from_seat_id,'seat_code',source_code,'ticket_code',source_record.ticket_code,'allocation_status',source_record.allocation_status,'admission_status',source_record.admission_status),
    jsonb_build_object('seat_id',p_to_seat_id,'seat_code',target_code,'ticket_code',source_record.ticket_code,'ticket_code_preserved',true,'allocation_status',saved_record.allocation_status,'admission_status',saved_record.admission_status));
  return jsonb_build_object('status','reassigned','from_seat_id',p_from_seat_id,'from_seat_code',source_code,
    'to_seat_id',p_to_seat_id,'to_seat_code',target_code,'floor_name',target_floor,
    'ticket_code',source_record.ticket_code,'ticket_code_preserved',true,
    'admission_status',saved_record.admission_status);
end;
$$;

-- QR은 좌석 문자열이 아니라 저장된 ticket_code를 먼저 찾는다. 따라서 재배정 후에도 인쇄 QR은 그대로 유효하다.
create or replace function private.operate_session_ticket(p_session_code text,p_ticket_code text,p_entrance_name text default '정문')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  caller_id uuid := (select auth.uid());
  target_session_id bigint; target_hall_id bigint; target_status text;
  target_seat_id bigint; target_seat_code text; target_floor_name text;
  target_allocation text; target_admission text;
  clean_code text := nullif(btrim(p_ticket_code),'');
  clean_entrance text := coalesce(nullif(btrim(p_entrance_name),''),'정문');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if clean_code is null or length(clean_code)>300 then raise exception '올바른 QR 티켓 코드를 입력해 주세요.'; end if;
  select id,hall_id,status into target_session_id,target_hall_id,target_status from public.event_sessions where session_code=p_session_code;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_status in ('ended','cancelled') then raise exception '종료되거나 취소된 회차는 처리할 수 없습니다.'; end if;
  if not (select private.can_operate_hall(target_hall_id)) then raise exception '이 회차의 입장을 처리할 권한이 없습니다.'; end if;

  select ss.seat_id,s.seat_code,f.name,ss.allocation_status,ss.admission_status
  into target_seat_id,target_seat_code,target_floor_name,target_allocation,target_admission
  from public.session_seats ss join public.seats s on s.id=ss.seat_id join public.hall_floors f on f.id=s.hall_floor_id
  where ss.session_id=target_session_id and ss.ticket_code=clean_code and f.hall_id=target_hall_id;

  if target_seat_id is null then
    select s.id,s.seat_code,f.name into target_seat_id,target_seat_code,target_floor_name
    from public.seats s join public.hall_floors f on f.id=s.hall_floor_id
    where f.hall_id=target_hall_id and s.is_active and clean_code=p_session_code || ':' || s.seat_code;
    if target_seat_id is null then raise exception '현재 회차에서 사용할 수 없는 QR입니다.'; end if;
    return jsonb_build_object('status','onsite_confirmation_required','seat_id',target_seat_id,
      'seat_code',target_seat_code,'floor_name',target_floor_name,'entrance_name',clean_entrance);
  end if;
  if target_admission='entered' then raise exception '이미 입장 완료된 QR입니다.'; end if;
  if target_allocation='blocked' then raise exception '사용 중지된 좌석의 QR입니다.'; end if;
  return private.admit_session_seat(p_session_code,target_seat_id,clean_entrance);
end;
$$;

create or replace function private.confirm_onsite_ticket(p_session_code text,p_ticket_code text,p_entrance_name text default '정문',p_assignee_name text default '현장 입장')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_session_id bigint; target_hall_id bigint; target_seat_id bigint;
  clean_code text := nullif(btrim(p_ticket_code),'');
begin
  if (select auth.uid()) is null then raise exception '로그인이 필요합니다.'; end if;
  select id,hall_id into target_session_id,target_hall_id from public.event_sessions where session_code=p_session_code;
  select s.id into target_seat_id from public.seats s join public.hall_floors f on f.id=s.hall_floor_id
  where f.hall_id=target_hall_id and s.is_active and clean_code=p_session_code || ':' || s.seat_code;
  if target_seat_id is null then raise exception '현재 회차에서 사용할 수 없는 QR입니다.'; end if;
  return private.admit_session_seat(p_session_code,target_seat_id,p_entrance_name);
end;
$$;

-- 현장 확보(held) 좌석도 입장 전에는 확보를 해제할 수 있다.
create or replace function private.release_session_seats(p_session_code text,p_seat_ids bigint[],p_reason text default '배분 취소')
returns integer language plpgsql security definer set search_path='' as $$
declare
  caller_id uuid := (select auth.uid()); target_session_id bigint; target_hall_id bigint; target_status text;
  requested_count integer := coalesce(cardinality(p_seat_ids),0); changed_count integer;
  clean_reason text := coalesce(nullif(btrim(p_reason),''),'배분 취소');
begin
  if caller_id is null then raise exception '로그인이 필요합니다.'; end if;
  if requested_count<1 or requested_count>694 then raise exception '취소할 좌석을 한 개 이상 선택해 주세요.'; end if;
  if (select count(distinct value) from unnest(p_seat_ids) value)<>requested_count then raise exception '선택 좌석에 중복 값이 있습니다.'; end if;
  if length(clean_reason)>500 then raise exception '취소 사유는 500자 이내로 입력해 주세요.'; end if;
  select id,hall_id,status into target_session_id,target_hall_id,target_status from public.event_sessions where session_code=p_session_code for update;
  if target_session_id is null then raise exception '행사 회차를 찾을 수 없습니다.'; end if;
  if target_status in ('ended','cancelled') then raise exception '종료되거나 취소된 회차의 배분은 취소할 수 없습니다.'; end if;
  if not (select private.can_manage_hall(target_hall_id)) then raise exception '이 회차의 배분을 취소할 권한이 없습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('session-seat-allocation:' || target_session_id::text,0));
  if (select count(*) from public.session_seats where session_id=target_session_id and seat_id=any(p_seat_ids)
      and allocation_status in ('distributed','held') and admission_status='not_entered')<>requested_count then
    raise exception '배분·확보되지 않았거나 이미 입장한 좌석이 포함되어 있습니다.';
  end if;
  with old as materialized(select * from public.session_seats where session_id=target_session_id and seat_id=any(p_seat_ids) for update),
  changed as (update public.session_seats ss set allocation_status='available',admission_status='not_entered',ticket_code=null,
    assignee_name=null,group_name=null,contact=null,note='',allocated_by=null,allocated_at=null,admitted_by=null,admitted_at=null,
    entrance_name=null,version=ss.version+1 from old where ss.id=old.id returning ss.id,ss.seat_id,ss.version)
  insert into public.audit_logs(session_id,session_seat_id,actor_id,action,reason,before_state,after_state)
  select target_session_id,changed.id,caller_id,'release',clean_reason,
    jsonb_build_object('seat_id',old.seat_id,'allocation_status',old.allocation_status,'admission_status',old.admission_status,'ticket_code',old.ticket_code,'assignee_name',old.assignee_name,'group_name',old.group_name,'version',old.version),
    jsonb_build_object('seat_id',changed.seat_id,'allocation_status','available','admission_status','not_entered','version',changed.version)
  from changed join old on old.id=changed.id;
  get diagnostics changed_count=row_count;
  if changed_count<>requested_count then raise exception '좌석 상태가 변경되었습니다. 다시 시도해 주세요.'; end if;
  return changed_count;
end;
$$;

create or replace function public.reserve_onsite_session_seats(p_session_code text,p_seat_ids bigint[],p_note text default '현장 운영용 사전 확보')
returns integer language sql security invoker set search_path='' as $$ select private.reserve_onsite_session_seats(p_session_code,p_seat_ids,p_note) $$;
create or replace function public.admit_session_seat(p_session_code text,p_seat_id bigint,p_entrance_name text default '태블릿 좌석표')
returns jsonb language sql security invoker set search_path='' as $$ select private.admit_session_seat(p_session_code,p_seat_id,p_entrance_name) $$;
create or replace function public.reassign_session_seat(p_session_code text,p_from_seat_id bigint,p_to_seat_id bigint,p_reason text default '현장 좌석 변경')
returns jsonb language sql security invoker set search_path='' as $$ select private.reassign_session_seat(p_session_code,p_from_seat_id,p_to_seat_id,p_reason) $$;

revoke execute on function private.reserve_onsite_session_seats(text,bigint[],text) from public,anon;
revoke execute on function private.admit_session_seat(text,bigint,text) from public,anon;
revoke execute on function private.reassign_session_seat(text,bigint,bigint,text) from public,anon;
grant execute on function private.reserve_onsite_session_seats(text,bigint[],text) to authenticated;
grant execute on function private.admit_session_seat(text,bigint,text) to authenticated;
grant execute on function private.reassign_session_seat(text,bigint,bigint,text) to authenticated;
revoke execute on function public.reserve_onsite_session_seats(text,bigint[],text) from public,anon;
revoke execute on function public.admit_session_seat(text,bigint,text) from public,anon;
revoke execute on function public.reassign_session_seat(text,bigint,bigint,text) from public,anon;
grant execute on function public.reserve_onsite_session_seats(text,bigint[],text) to authenticated;
grant execute on function public.admit_session_seat(text,bigint,text) to authenticated;
grant execute on function public.reassign_session_seat(text,bigint,bigint,text) to authenticated;
