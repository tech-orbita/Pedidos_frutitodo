-- Annexes: a customer may keep adding products until the order is dispatched.
-- context_until: date of the last GHL message already read into the order, so n8n only
--   extracts later messages and never re-adds what the order already holds.
-- printed_snapshot: what the last printed ticket said, so a reprint can highlight what the
--   customer added or removed since the picker got it.
alter table public.orders
  add column if not exists context_until timestamptz,
  add column if not exists printed_snapshot jsonb;

create or replace function public.confirm_order_print(
  p_order_id uuid,
  p_location_id uuid,
  p_request_id text,
  p_operator text default null
)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event_id uuid;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and location_id = p_location_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.order_events (order_id, location_id, event_type, request_id, metadata)
  values (
    v_order.id,
    v_order.location_id,
    'print_confirmed',
    p_request_id,
    jsonb_build_object('previous_status', v_order.status, 'operator', nullif(btrim(p_operator), ''))
  )
  on conflict (order_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    update public.orders
    set
      status = case when status = 'pending' then 'printed' else status end,
      first_printed_at = coalesce(first_printed_at, now()),
      last_printed_at = now(),
      print_count = print_count + 1,
      last_printed_by = coalesce(nullif(btrim(p_operator), ''), last_printed_by),
      printed_snapshot = jsonb_build_object('rawOrderText', raw_order_text, 'items', items)
    where id = v_order.id
    returning * into v_order;
  end if;

  return next v_order;
end;
$$;

revoke execute on function public.confirm_order_print(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_order_print(uuid, uuid, text, text) to service_role;
