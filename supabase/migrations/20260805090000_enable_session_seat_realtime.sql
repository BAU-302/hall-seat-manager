do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'session_seats'
  ) then
    alter publication supabase_realtime add table public.session_seats;
  end if;
end
$$;
