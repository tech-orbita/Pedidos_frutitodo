-- Deleting an order removed the only record of which messages had been read, so the next
-- extraction (the periodic sweep, a help request or the agent) read the day again from
-- midnight and recreated the deleted order. The mark outlives the order: n8n never reads
-- messages at or before it again.
create table if not exists public.contact_read_marks (
  location_id uuid not null references public.locations(id) on delete cascade,
  ghl_contact_id text not null,
  read_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (location_id, ghl_contact_id)
);

alter table public.contact_read_marks enable row level security;
