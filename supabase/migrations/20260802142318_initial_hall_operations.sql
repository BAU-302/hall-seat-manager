create schema if not exists private;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'entrance_staff'
    check (role in ('super_admin', 'event_manager', 'entrance_staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.halls (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  floor_summary text not null,
  capacity integer not null check (capacity > 0),
  note text not null default '',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hall_floors (
  id bigint generated always as identity primary key,
  hall_id bigint not null references public.halls(id) on delete cascade,
  floor_code text not null,
  name text not null,
  capacity integer not null check (capacity > 0),
  sort_order integer not null default 0,
  layout_status text not null default 'pending'
    check (layout_status in ('verified', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hall_id, floor_code)
);

create table public.seats (
  id bigint generated always as identity primary key,
  hall_floor_id bigint not null references public.hall_floors(id) on delete cascade,
  seat_code text not null,
  row_label text not null,
  seat_number integer not null check (seat_number > 0),
  seat_kind text not null default 'standard'
    check (seat_kind in ('standard', 'wheelchair', 'companion', 'reserved')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hall_floor_id, seat_code),
  unique (hall_floor_id, row_label, seat_number)
);

create table public.events (
  id bigint generated always as identity primary key,
  hall_id bigint not null references public.halls(id) on delete restrict,
  name text not null,
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, hall_id)
);

create table public.event_sessions (
  id bigint generated always as identity primary key,
  event_id bigint not null,
  hall_id bigint not null references public.halls(id) on delete restrict,
  session_code text not null unique,
  round_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'allocation', 'entry_ready', 'entry_open', 'ended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, hall_id) references public.events(id, hall_id) on delete cascade,
  unique (event_id, starts_at),
  check (ends_at > starts_at)
);

create table public.staff_hall_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  hall_id bigint not null references public.halls(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, hall_id)
);

create table public.event_staff (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade,
  assignment_role text not null
    check (assignment_role in ('event_manager', 'entrance_staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table public.session_seats (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.event_sessions(id) on delete cascade,
  seat_id bigint not null references public.seats(id) on delete restrict,
  allocation_status text not null default 'available'
    check (allocation_status in ('available', 'held', 'distributed', 'blocked')),
  admission_status text not null default 'not_entered'
    check (admission_status in ('not_entered', 'entered')),
  ticket_code text,
  assignee_name text,
  group_name text,
  contact text,
  note text not null default '',
  allocated_by uuid references auth.users(id) on delete set null,
  allocated_at timestamptz,
  admitted_by uuid references auth.users(id) on delete set null,
  admitted_at timestamptz,
  entrance_name text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, seat_id),
  unique (session_id, ticket_code),
  check (
    (admission_status = 'not_entered' and admitted_at is null)
    or (admission_status = 'entered' and admitted_at is not null)
  )
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  session_id bigint references public.event_sessions(id) on delete set null,
  session_seat_id bigint references public.session_seats(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('allocate', 'hold', 'release', 'check_in', 'undo_check_in', 'reassign', 'block', 'unblock')),
  entrance_name text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index hall_floors_hall_id_idx on public.hall_floors (hall_id);
create index seats_hall_floor_id_idx on public.seats (hall_floor_id);
create index seats_floor_row_number_idx on public.seats (hall_floor_id, row_label, seat_number);
create index events_hall_id_status_idx on public.events (hall_id, status);
create index event_sessions_hall_start_idx on public.event_sessions (hall_id, starts_at);
create index event_sessions_event_id_idx on public.event_sessions (event_id);
create index staff_hall_access_hall_id_idx on public.staff_hall_access (hall_id);
create index event_staff_event_id_idx on public.event_staff (event_id);
create index session_seats_session_status_idx on public.session_seats (session_id, allocation_status, admission_status);
create index session_seats_seat_id_idx on public.session_seats (seat_id);
create index audit_logs_session_created_idx on public.audit_logs (session_id, created_at desc);
create index audit_logs_session_seat_id_idx on public.audit_logs (session_seat_id);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger halls_set_updated_at before update on public.halls
for each row execute function private.set_updated_at();
create trigger hall_floors_set_updated_at before update on public.hall_floors
for each row execute function private.set_updated_at();
create trigger seats_set_updated_at before update on public.seats
for each row execute function private.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function private.set_updated_at();
create trigger event_sessions_set_updated_at before update on public.event_sessions
for each row execute function private.set_updated_at();
create trigger session_seats_set_updated_at before update on public.session_seats
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where (select auth.uid()) is not null
    and p.user_id = (select auth.uid())
$$;

create or replace function private.can_access_hall(target_hall_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    (select private.current_app_role()) = 'super_admin'
    or exists (
      select 1
      from public.staff_hall_access access
      where access.user_id = (select auth.uid())
        and access.hall_id = target_hall_id
    )
  )
$$;

create or replace function private.can_manage_hall(target_hall_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.current_app_role()) = 'super_admin'
    or (
      (select private.current_app_role()) = 'event_manager'
      and (select private.can_access_hall(target_hall_id))
    )
$$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.can_access_hall(bigint) to authenticated;
grant execute on function private.can_manage_hall(bigint) to authenticated;

alter table public.profiles enable row level security;
alter table public.halls enable row level security;
alter table public.hall_floors enable row level security;
alter table public.seats enable row level security;
alter table public.events enable row level security;
alter table public.event_sessions enable row level security;
alter table public.staff_hall_access enable row level security;
alter table public.event_staff enable row level security;
alter table public.session_seats enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select on public.profiles for select to authenticated
using (user_id = (select auth.uid()) or (select private.current_app_role()) = 'super_admin');
create policy profiles_update_self on public.profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy halls_anon_read on public.halls for select to anon
using (is_active);
create policy halls_authenticated_read on public.halls for select to authenticated
using (is_active or (select private.current_app_role()) = 'super_admin');
create policy halls_admin_all on public.halls for all to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');

create policy hall_floors_public_read on public.hall_floors for select to anon, authenticated
using (exists (select 1 from public.halls h where h.id = hall_id and h.is_active));
create policy hall_floors_admin_all on public.hall_floors for all to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');

create policy seats_public_read on public.seats for select to anon, authenticated
using (is_active and exists (
  select 1 from public.hall_floors f
  join public.halls h on h.id = f.hall_id
  where f.id = hall_floor_id and h.is_active
));
create policy seats_admin_all on public.seats for all to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');

create policy events_anon_read on public.events for select to anon
using (status = 'published');
create policy events_authenticated_read on public.events for select to authenticated
using (status = 'published' or (select private.can_access_hall(hall_id)));
create policy events_manager_insert on public.events for insert to authenticated
with check ((select private.can_manage_hall(hall_id)) and created_by = (select auth.uid()));
create policy events_manager_update on public.events for update to authenticated
using ((select private.can_manage_hall(hall_id)))
with check ((select private.can_manage_hall(hall_id)));
create policy events_admin_delete on public.events for delete to authenticated
using ((select private.current_app_role()) = 'super_admin');

create policy sessions_anon_read on public.event_sessions for select to anon
using (exists (select 1 from public.events e where e.id = event_id and e.status = 'published'));
create policy sessions_authenticated_read on public.event_sessions for select to authenticated
using (
  exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  or (select private.can_access_hall(hall_id))
);
create policy sessions_manager_insert on public.event_sessions for insert to authenticated
with check ((select private.can_manage_hall(hall_id)));
create policy sessions_manager_update on public.event_sessions for update to authenticated
using ((select private.can_manage_hall(hall_id)))
with check ((select private.can_manage_hall(hall_id)));
create policy sessions_admin_delete on public.event_sessions for delete to authenticated
using ((select private.current_app_role()) = 'super_admin');

create policy staff_hall_access_read on public.staff_hall_access for select to authenticated
using (user_id = (select auth.uid()) or (select private.current_app_role()) = 'super_admin');
create policy staff_hall_access_admin_all on public.staff_hall_access for all to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');

create policy event_staff_read on public.event_staff for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.events e
    where e.id = event_id and (select private.can_manage_hall(e.hall_id))
  )
);
create policy event_staff_manager_all on public.event_staff for all to authenticated
using (exists (
  select 1 from public.events e
  where e.id = event_id and (select private.can_manage_hall(e.hall_id))
))
with check (exists (
  select 1 from public.events e
  where e.id = event_id and (select private.can_manage_hall(e.hall_id))
));

create policy session_seats_staff_read on public.session_seats for select to authenticated
using (exists (
  select 1 from public.event_sessions s
  where s.id = session_id and (select private.can_access_hall(s.hall_id))
));

create policy audit_logs_staff_read on public.audit_logs for select to authenticated
using (exists (
  select 1 from public.event_sessions s
  where s.id = session_id and (select private.can_access_hall(s.hall_id))
));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.halls, public.hall_floors, public.seats, public.events, public.event_sessions to anon, authenticated;
grant select on public.profiles, public.staff_hall_access, public.event_staff, public.session_seats, public.audit_logs to authenticated;
grant insert, update, delete on public.halls, public.hall_floors, public.seats, public.events, public.event_sessions, public.staff_hall_access, public.event_staff to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant usage, select on all sequences in schema public to authenticated;

insert into public.halls (code, name, floor_summary, capacity, note, display_order)
values
  ('haeun', '하은홀', '1층 · 2층', 694, '등록 행사 1건', 1),
  ('art', '아트홀', '1층', 370, '등록 행사 1건', 2),
  ('yerang', '예랑홀', '1층', 200, '등록 행사 1건', 3);

insert into public.hall_floors (hall_id, floor_code, name, capacity, sort_order, layout_status)
values
  ((select id from public.halls where code = 'haeun'), '1F', '1층', 506, 1, 'verified'),
  ((select id from public.halls where code = 'haeun'), '2F', '2층', 188, 2, 'verified'),
  ((select id from public.halls where code = 'art'), '1F', '1층', 370, 1, 'pending'),
  ((select id from public.halls where code = 'yerang'), '1F', '1층', 200, 1, 'pending');

with seat_ranges(floor_code, row_label, start_no, end_no) as (
  values
    ('1F','A',7,14),('1F','A',15,22),
    ('1F','B',1,6),('1F','B',7,14),('1F','B',15,22),
    ('1F','C',1,6),('1F','C',7,14),('1F','C',15,22),('1F','C',23,26),
    ('1F','D',3,6),('1F','D',7,14),('1F','D',15,22),('1F','D',23,26),
    ('1F','E',3,6),('1F','E',7,14),('1F','E',15,22),('1F','E',23,26),
    ('1F','F',1,6),('1F','F',7,14),('1F','F',15,22),('1F','F',23,28),
    ('1F','G',1,6),('1F','G',7,14),('1F','G',15,22),('1F','G',23,28),
    ('1F','H',1,6),('1F','H',7,14),('1F','H',15,22),('1F','H',23,28),
    ('1F','I',1,6),('1F','I',7,14),('1F','I',15,22),('1F','I',23,28),
    ('1F','J',3,4),('1F','J',7,14),('1F','J',15,22),('1F','J',23,26),
    ('1F','K',3,4),('1F','K',7,14),('1F','K',15,22),('1F','K',23,26),
    ('1F','L',1,6),('1F','L',7,14),('1F','L',15,22),('1F','L',23,28),
    ('1F','M',1,6),('1F','M',7,14),('1F','M',15,22),('1F','M',23,28),
    ('1F','N',1,6),('1F','N',7,14),('1F','N',15,22),('1F','N',23,28),
    ('1F','O',1,6),('1F','O',7,14),('1F','O',15,22),('1F','O',23,28),
    ('1F','P',3,6),('1F','P',7,14),('1F','P',15,22),('1F','P',23,26),
    ('1F','Q',2,6),('1F','Q',7,14),('1F','Q',15,22),('1F','Q',23,27),
    ('1F','R',1,6),('1F','R',7,14),('1F','R',15,22),('1F','R',23,28),
    ('1F','S',1,6),('1F','S',7,14),('1F','S',15,22),('1F','S',23,28),
    ('1F','T',7,14),('1F','T',15,22),
    ('2F','A',4,14),('2F','A',21,31),
    ('2F','B',3,32),
    ('2F','C',1,34),('2F','D',1,34),('2F','E',1,34),('2F','F',1,34)
), expanded as (
  select floor_code, row_label, generate_series(start_no, end_no) as seat_number
  from seat_ranges
)
insert into public.seats (hall_floor_id, seat_code, row_label, seat_number)
select
  f.id,
  expanded.floor_code || '-' || expanded.row_label || '-' || lpad(expanded.seat_number::text, 3, '0'),
  expanded.row_label,
  expanded.seat_number
from expanded
join public.hall_floors f on f.floor_code = expanded.floor_code
join public.halls h on h.id = f.hall_id and h.code = 'haeun';

insert into public.events (hall_id, name, description, status)
values
  ((select id from public.halls where code = 'haeun'), '2026 여름음악회', '하은홀 운영 예시 행사', 'published'),
  ((select id from public.halls where code = 'art'), '신입생 오리엔테이션', '아트홀 운영 예시 행사', 'published'),
  ((select id from public.halls where code = 'yerang'), '학부모 설명회', '예랑홀 운영 예시 행사', 'published');

insert into public.event_sessions (event_id, hall_id, session_code, round_name, starts_at, ends_at, status)
values
  ((select id from public.events where name = '2026 여름음악회'), (select id from public.halls where code = 'haeun'), 'haeun-20260815-1400', '1회차', '2026-08-15 14:00:00+09', '2026-08-15 16:00:00+09', 'ended'),
  ((select id from public.events where name = '2026 여름음악회'), (select id from public.halls where code = 'haeun'), 'haeun-20260815-1900', '2회차', '2026-08-15 19:00:00+09', '2026-08-15 21:00:00+09', 'entry_ready'),
  ((select id from public.events where name = '신입생 오리엔테이션'), (select id from public.halls where code = 'art'), 'art-20260820-1000', '오전 회차', '2026-08-20 10:00:00+09', '2026-08-20 12:00:00+09', 'entry_open'),
  ((select id from public.events where name = '신입생 오리엔테이션'), (select id from public.halls where code = 'art'), 'art-20260820-1400', '오후 회차', '2026-08-20 14:00:00+09', '2026-08-20 16:00:00+09', 'allocation'),
  ((select id from public.events where name = '학부모 설명회'), (select id from public.halls where code = 'yerang'), 'yerang-20260822-1100', '1회차', '2026-08-22 11:00:00+09', '2026-08-22 13:00:00+09', 'entry_ready');
