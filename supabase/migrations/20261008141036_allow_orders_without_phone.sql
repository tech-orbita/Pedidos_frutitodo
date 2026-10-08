-- WhatsApp/GHL may omit profile data. The order must still be captured and the
-- missing contact details can be completed when the customer replies or by an operator.
alter table public.orders
  alter column customer_name drop not null,
  alter column customer_phone drop not null;

alter table public.orders drop constraint if exists orders_customer_name_length;
alter table public.orders add constraint orders_customer_name_length
  check (customer_name is null or char_length(customer_name) between 1 and 160);

alter table public.orders drop constraint if exists orders_customer_phone_length;
alter table public.orders add constraint orders_customer_phone_length
  check (customer_phone is null or char_length(customer_phone) between 3 and 40);
