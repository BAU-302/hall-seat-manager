with missing_seats(row_label, seat_number) as (
  values ('J', 5), ('J', 6), ('K', 5), ('K', 6)
)
insert into public.seats (hall_floor_id, seat_code, row_label, seat_number)
select
  floor.id,
  '1F-' || missing_seats.row_label || '-' || lpad(missing_seats.seat_number::text, 3, '0'),
  missing_seats.row_label,
  missing_seats.seat_number
from missing_seats
join public.halls hall on hall.code = 'haeun'
join public.hall_floors floor on floor.hall_id = hall.id and floor.floor_code = '1F'
on conflict (hall_floor_id, row_label, seat_number) do nothing;
