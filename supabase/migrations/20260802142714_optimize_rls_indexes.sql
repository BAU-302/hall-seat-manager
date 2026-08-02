create index event_sessions_event_hall_idx on public.event_sessions (event_id, hall_id);
create index events_created_by_idx on public.events (created_by);
create index session_seats_allocated_by_idx on public.session_seats (allocated_by);
create index session_seats_admitted_by_idx on public.session_seats (admitted_by);

drop policy halls_admin_all on public.halls;
create policy halls_admin_insert on public.halls for insert to authenticated
with check ((select private.current_app_role()) = 'super_admin');
create policy halls_admin_update on public.halls for update to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');
create policy halls_admin_delete on public.halls for delete to authenticated
using ((select private.current_app_role()) = 'super_admin');

drop policy hall_floors_admin_all on public.hall_floors;
create policy hall_floors_admin_insert on public.hall_floors for insert to authenticated
with check ((select private.current_app_role()) = 'super_admin');
create policy hall_floors_admin_update on public.hall_floors for update to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');
create policy hall_floors_admin_delete on public.hall_floors for delete to authenticated
using ((select private.current_app_role()) = 'super_admin');

drop policy seats_admin_all on public.seats;
create policy seats_admin_insert on public.seats for insert to authenticated
with check ((select private.current_app_role()) = 'super_admin');
create policy seats_admin_update on public.seats for update to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');
create policy seats_admin_delete on public.seats for delete to authenticated
using ((select private.current_app_role()) = 'super_admin');

drop policy staff_hall_access_admin_all on public.staff_hall_access;
create policy staff_hall_access_admin_insert on public.staff_hall_access for insert to authenticated
with check ((select private.current_app_role()) = 'super_admin');
create policy staff_hall_access_admin_update on public.staff_hall_access for update to authenticated
using ((select private.current_app_role()) = 'super_admin')
with check ((select private.current_app_role()) = 'super_admin');
create policy staff_hall_access_admin_delete on public.staff_hall_access for delete to authenticated
using ((select private.current_app_role()) = 'super_admin');

drop policy event_staff_manager_all on public.event_staff;
create policy event_staff_manager_insert on public.event_staff for insert to authenticated
with check (exists (
  select 1 from public.events e
  where e.id = event_id and (select private.can_manage_hall(e.hall_id))
));
create policy event_staff_manager_update on public.event_staff for update to authenticated
using (exists (
  select 1 from public.events e
  where e.id = event_id and (select private.can_manage_hall(e.hall_id))
))
with check (exists (
  select 1 from public.events e
  where e.id = event_id and (select private.can_manage_hall(e.hall_id))
));
create policy event_staff_manager_delete on public.event_staff for delete to authenticated
using (exists (
  select 1 from public.events e
  where e.id = event_id and (select private.can_manage_hall(e.hall_id))
));
