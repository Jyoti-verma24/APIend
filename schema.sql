-- TailorTrack database setup
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.

-- The shop's own details. Just one row, id is always 1.
create table if not exists shop (
  id      int primary key default 1,
  name    text not null,
  phone   text,
  address text
);

create table if not exists customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null unique,
  address    text,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  garment_type text not null,
  description  text,
  -- A plain text column with a CHECK instead of a Postgres enum: easier to
  -- read in the table editor and easier to add a stage to later.
  status       text not null default 'RECEIVED'
               check (status in ('RECEIVED','CUTTING','STITCHING','TRIAL','READY','DELIVERED')),
  total_amount numeric(10,2) not null,
  delivery_date date not null,
  -- The customer's tracking link is built from this. Random, so it cannot be guessed.
  public_token uuid not null unique default gen_random_uuid(),
  photo_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists payments (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  amount   numeric(10,2) not null,
  method   text not null default 'CASH' check (method in ('CASH','UPI','CARD')),
  paid_at  timestamptz not null default now(),
  note     text
);

-- Reminders are written one day before delivery and left for a scheduler to
-- pick up later. Nothing sends them yet; the rows are the record that they are due.
create table if not exists reminders (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  type         text not null default 'delivery',
  scheduled_at timestamptz not null,
  sent         boolean not null default false,
  sent_at      timestamptz
);

create index if not exists orders_customer_id_idx on orders(customer_id);
create index if not exists payments_order_id_idx on payments(order_id);

-- Row Level Security ON with no policies means nobody can read these tables
-- with the public anon key. The API reaches them with the service_role key,
-- which bypasses RLS and must stay in Vercel's environment variables only.
alter table shop      enable row level security;
alter table customers enable row level security;
alter table orders    enable row level security;
alter table payments  enable row level security;
alter table reminders enable row level security;

-- Your shop's details. Change these to the real ones.
insert into shop (id, name, phone, address)
values (1, 'Star Tailors', '+91 12345 67890', 'MG Road, Shop #12')
on conflict (id) do nothing;

-- One customer to try the demo with.
insert into customers (name, phone)
values ('Amit Kumar', '+919876543210')
on conflict (phone) do nothing;
