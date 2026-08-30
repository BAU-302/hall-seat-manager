-- Remove preview-only events while preserving the real hall, floor, and seat catalog.
delete from public.events
where created_by is null
  and (name, description) in (
    ('2026 여름음악회', '하은홀 운영 예시 행사'),
    ('신입생 오리엔테이션', '아트홀 운영 예시 행사'),
    ('학부모 설명회', '예랑홀 운영 예시 행사')
  );

update public.halls set note = '등록 행사 0건';

create or replace function private.claim_initial_super_admin()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  assigned_role text;
begin
  if caller_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  perform pg_advisory_xact_lock(hashtext('hall-seat-manager:first-super-admin'));

  if not exists (
    select 1 from public.profiles where role = 'super_admin'
  ) then
    update public.profiles
    set role = 'super_admin'
    where user_id = caller_id;
  end if;

  select role into assigned_role
  from public.profiles
  where user_id = caller_id;

  return coalesce(assigned_role, 'entrance_staff');
end;
$$;

create or replace function public.claim_initial_admin()
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.claim_initial_super_admin()
$$;

create or replace function private.create_event_with_session(
  p_hall_code text,
  p_event_name text,
  p_round_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_description text default ''
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_hall_id bigint;
  new_event_id bigint;
  new_session_code text;
begin
  if caller_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if nullif(btrim(p_event_name), '') is null or nullif(btrim(p_round_name), '') is null then
    raise exception '행사명과 회차명을 입력해 주세요.';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception '종료 시각은 시작 시각보다 늦어야 합니다.';
  end if;

  select id into target_hall_id
  from public.halls
  where code = p_hall_code and is_active;

  if target_hall_id is null then
    raise exception '사용 가능한 홀이 아닙니다.';
  end if;
  if not (select private.can_manage_hall(target_hall_id)) then
    raise exception '이 홀의 행사를 등록할 권한이 없습니다.';
  end if;

  if exists (
    select 1
    from public.event_sessions
    where hall_id = target_hall_id
      and status <> 'cancelled'
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception '같은 홀에 시간이 겹치는 회차가 있습니다.';
  end if;

  insert into public.events (hall_id, name, description, status, created_by)
  values (target_hall_id, btrim(p_event_name), coalesce(btrim(p_description), ''), 'published', caller_id)
  returning id into new_event_id;

  new_session_code := p_hall_code || '-' || to_char(p_starts_at at time zone 'Asia/Seoul', 'YYYYMMDD-HH24MI') || '-' || new_event_id::text;

  insert into public.event_sessions (
    event_id, hall_id, session_code, round_name, starts_at, ends_at, status
  ) values (
    new_event_id, target_hall_id, new_session_code, btrim(p_round_name), p_starts_at, p_ends_at, 'scheduled'
  );

  return new_session_code;
end;
$$;

create or replace function public.create_event_with_session(
  p_hall_code text,
  p_event_name text,
  p_round_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_description text default ''
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.create_event_with_session(
    p_hall_code, p_event_name, p_round_name, p_starts_at, p_ends_at, p_description
  )
$$;

create or replace function private.delete_unused_event(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_hall_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if (select private.current_app_role()) <> 'super_admin' then
    raise exception '관리자만 행사를 영구 삭제할 수 있습니다.';
  end if;

  select hall_id into target_hall_id
  from public.events
  where id = p_event_id
  for update;

  if target_hall_id is null then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.event_sessions session
    left join public.session_seats ss on ss.session_id = session.id
    left join public.audit_logs log on log.session_id = session.id
    where session.event_id = p_event_id
      and (
        log.id is not null
        or ss.allocation_status <> 'available'
        or ss.admission_status <> 'not_entered'
      )
  ) then
    raise exception '배분 또는 입장 이력이 있는 행사는 삭제할 수 없습니다. 종료 상태로 보관해 주세요.';
  end if;

  delete from public.events where id = p_event_id;
end;
$$;

create or replace function public.delete_unused_event(p_event_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_unused_event(p_event_id)
$$;

revoke execute on function private.claim_initial_super_admin() from public, anon;
revoke execute on function private.create_event_with_session(text, text, text, timestamptz, timestamptz, text) from public, anon;
revoke execute on function private.delete_unused_event(bigint) from public, anon;
grant execute on function private.claim_initial_super_admin() to authenticated;
grant execute on function private.create_event_with_session(text, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function private.delete_unused_event(bigint) to authenticated;

revoke execute on function public.claim_initial_admin() from public, anon;
revoke execute on function public.create_event_with_session(text, text, text, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.delete_unused_event(bigint) from public, anon;
grant execute on function public.claim_initial_admin() to authenticated;
grant execute on function public.create_event_with_session(text, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.delete_unused_event(bigint) to authenticated;
