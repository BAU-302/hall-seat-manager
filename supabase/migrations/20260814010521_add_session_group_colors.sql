-- 회차별 단체 색상을 좌석 상태와 분리해 관리한다.
-- 재배정·입장 취소 시에도 group_name만 유지되면 동일 색상을 복원할 수 있다.
create table public.session_group_colors (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.event_sessions(id) on delete cascade,
  group_name text not null,
  group_name_key text generated always as (lower(btrim(group_name))) stored,
  color_hex text not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, group_name_key),
  check (group_name = btrim(group_name) and length(group_name) between 1 and 150),
  check (color_hex in (
    '#D9C2F0', '#B9DDF8', '#BCE8D3', '#FFD1B8', '#F7C4D8',
    '#F6E7A7', '#D5E8B0', '#E7D3B5', '#E8B8B8', '#C7D2E3'
  ))
);

create index session_group_colors_created_by_idx on public.session_group_colors (created_by);
create index session_group_colors_updated_by_idx on public.session_group_colors (updated_by);

create trigger session_group_colors_set_updated_at
before update on public.session_group_colors
for each row execute function private.set_updated_at();

alter table public.session_group_colors enable row level security;

create policy session_group_colors_staff_read
on public.session_group_colors for select to authenticated
using (exists (
  select 1
  from public.event_sessions session
  where session.id = session_id
    and (select private.can_access_hall(session.hall_id))
));

revoke all on public.session_group_colors from anon, authenticated;
revoke all on sequence public.session_group_colors_id_seq from anon, authenticated;
grant select on public.session_group_colors to authenticated;

alter table public.audit_logs drop constraint audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check
check (action in ('allocate', 'hold', 'release', 'check_in', 'undo_check_in', 'reassign', 'block', 'unblock', 'group_color'));

create or replace function private.set_session_group_color(
  p_session_code text,
  p_group_name text,
  p_color_hex text
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
  clean_group_name text := nullif(btrim(p_group_name), '');
  clean_color_hex text := upper(btrim(p_color_hex));
  previous_color text;
  saved public.session_group_colors%rowtype;
begin
  if caller_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if clean_group_name is null or length(clean_group_name) > 150 then
    raise exception '단체명을 확인해 주세요.';
  end if;
  if clean_color_hex not in (
    '#D9C2F0', '#B9DDF8', '#BCE8D3', '#FFD1B8', '#F7C4D8',
    '#F6E7A7', '#D5E8B0', '#E7D3B5', '#E8B8B8', '#C7D2E3'
  ) then
    raise exception '선택할 수 없는 단체 색상입니다.';
  end if;

  select session.id, session.hall_id
  into target_session_id, target_hall_id
  from public.event_sessions session
  where session.session_code = p_session_code
  for update;

  if target_session_id is null then
    raise exception '행사 회차를 찾을 수 없습니다.';
  end if;
  if not (select private.can_manage_hall(target_hall_id)) then
    raise exception '이 회차의 단체 색상을 설정할 권한이 없습니다.';
  end if;

  select color.color_hex
  into previous_color
  from public.session_group_colors color
  where color.session_id = target_session_id
    and color.group_name_key = lower(clean_group_name);

  insert into public.session_group_colors (
    session_id, group_name, color_hex, created_by, updated_by
  ) values (
    target_session_id, clean_group_name, clean_color_hex, caller_id, caller_id
  )
  on conflict (session_id, group_name_key) do update
  set group_name = excluded.group_name,
      color_hex = excluded.color_hex,
      updated_by = caller_id
  returning * into saved;

  if previous_color is distinct from saved.color_hex then
    insert into public.audit_logs (
      session_id, actor_id, action, reason, before_state, after_state
    ) values (
      target_session_id,
      caller_id,
      'group_color',
      '단체 좌석 표시 색상 설정',
      case when previous_color is null then null else jsonb_build_object(
        'group_name', clean_group_name,
        'color_hex', previous_color
      ) end,
      jsonb_build_object(
        'group_name', saved.group_name,
        'color_hex', saved.color_hex
      )
    );
  end if;

  return jsonb_build_object(
    'session_id', saved.session_id,
    'group_name', saved.group_name,
    'color_hex', saved.color_hex
  );
end;
$$;

create or replace function public.set_session_group_color(
  p_session_code text,
  p_group_name text,
  p_color_hex text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_session_group_color(p_session_code, p_group_name, p_color_hex)
$$;

revoke execute on function private.set_session_group_color(text, text, text) from public, anon;
grant execute on function private.set_session_group_color(text, text, text) to authenticated;
revoke execute on function public.set_session_group_color(text, text, text) from public, anon;
grant execute on function public.set_session_group_color(text, text, text) to authenticated;

-- 이미 배분된 단체에도 예측 가능한 파스텔 색상을 한 번만 지정한다.
with ranked_groups as (
  select
    session_seat.session_id,
    btrim(session_seat.group_name) as group_name,
    min(session_seat.allocated_by::text)::uuid as created_by,
    row_number() over (
      partition by session_seat.session_id
      order by lower(btrim(session_seat.group_name))
    ) as color_rank
  from public.session_seats session_seat
  where session_seat.group_name is not null
    and btrim(session_seat.group_name) <> ''
  group by session_seat.session_id, btrim(session_seat.group_name)
)
insert into public.session_group_colors (
  session_id, group_name, color_hex, created_by, updated_by
)
select
  group_row.session_id,
  group_row.group_name,
  (array[
    '#D9C2F0', '#B9DDF8', '#BCE8D3', '#FFD1B8', '#F7C4D8',
    '#F6E7A7', '#D5E8B0', '#E7D3B5', '#E8B8B8', '#C7D2E3'
  ])[((group_row.color_rank - 1) % 10) + 1],
  group_row.created_by,
  group_row.created_by
from ranked_groups group_row
on conflict (session_id, group_name_key) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'session_group_colors'
    ) then
    alter publication supabase_realtime add table public.session_group_colors;
  end if;
end;
$$;
