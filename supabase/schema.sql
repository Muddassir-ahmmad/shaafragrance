create table if not exists public.products (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 1 and 100),
  category text not null check (length(trim(category)) between 1 and 80),
  size text not null check (length(trim(size)) between 1 and 60),
  price numeric(10, 2) check (price is null or price >= 0),
  price_label text not null default 'Price to be confirmed',
  description text not null check (length(trim(description)) between 1 and 600),
  notes text[] not null default '{}',
  image_url text not null check (length(trim(image_url)) > 0),
  available boolean not null default true,
  availability text not null default 'Contact us to confirm availability',
  ingredients text[] not null default '{}',
  variants jsonb not null default '[]'::jsonb,
  featured boolean not null default false,
  arrival_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

drop policy if exists "Anyone can view fragrances" on public.products;
create policy "Anyone can view fragrances"
  on public.products for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can manage fragrances" on public.products;
create policy "Admins can manage fragrances"
  on public.products for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into public.products
  (id, name, category, size, price, description, notes, image_url, available, availability, variants, featured)
values
  ('cr7', 'CR7', 'Citrus & woody', '8 ml', null,
   'An eau de parfum with citrus freshness and a woody base.',
   array['Citrus freshness', 'Woody base'], '/images/cr7.jpg', true,
   'Contact us to confirm availability', '[]'::jsonb, true),
  ('rich-chocolate', 'Rich Chocolate Fragrance', 'Gourmand', '8 ml / 20 ml', null,
   'A rich chocolate fragrance with warm cocoa, vanilla and sweet cream.',
   array['Warm cocoa', 'Vanilla', 'Sweet cream'], '/images/rich-chocolate-fragrance.jpg', true,
   'Contact us to confirm availability',
   '[{"size":"8 ml","price":null},{"size":"20 ml","price":null}]'::jsonb, true),
  ('shabaya', 'Shabaya', 'Oriental', 'Size to be confirmed', null,
   'An oriental luxury perfume.', '{}', '/images/shabaya.jpg', true,
   'Contact us to confirm availability', '[]'::jsonb, true)
on conflict (id) do nothing;

