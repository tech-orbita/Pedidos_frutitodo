-- Preserve the customer's list exactly, allow orders without an address, and provision a
-- second credential whose API permissions are restricted to delivery operations.
alter table public.orders
  add column if not exists raw_order_text text;

alter table public.orders drop constraint if exists orders_domicilio_address;
alter table public.orders drop constraint if exists orders_raw_order_text_length;
alter table public.orders add constraint orders_raw_order_text_length
  check (raw_order_text is null or char_length(raw_order_text) <= 20000);

alter table public.locations
  add column if not exists courier_token_hash text;
alter table public.locations drop constraint if exists locations_courier_token_hash_format;
alter table public.locations add constraint locations_courier_token_hash_format
  check (courier_token_hash is null or courier_token_hash ~ '^[a-f0-9]{64}$');
create unique index if not exists locations_courier_token_hash_unique
  on public.locations (courier_token_hash)
  where courier_token_hash is not null;
