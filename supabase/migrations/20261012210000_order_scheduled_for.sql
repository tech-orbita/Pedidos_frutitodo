-- Day the order is dispatched. The app sets it from the cutoff (7pm, 2pm on holidays), so an
-- order received late is scheduled for the next day. The default only covers direct inserts.
alter table public.orders
  add column if not exists scheduled_for date not null
    default ((now() at time zone 'America/Bogota')::date);

update public.orders
set scheduled_for = (received_at at time zone 'America/Bogota')::date;

create index if not exists orders_location_scheduled_idx
  on public.orders (location_id, scheduled_for);
