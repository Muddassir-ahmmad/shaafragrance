begin;

alter table public.products
  add column if not exists sku text,
  add column if not exists status text not null default 'active',
  add column if not exists short_description text not null default '',
  add column if not exists product_brand text not null default 'ShaaFragrance',
  add column if not exists audience text not null default '',
  add column if not exists currency text not null default 'INR',
  add column if not exists sale_price numeric(10, 2),
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists specifications jsonb not null default '{}'::jsonb,
  add column if not exists is_new_arrival boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.products
set sku = 'SF-' || upper(regexp_replace(id, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || upper(substr(md5(id), 1, 4))
where sku is null;

update public.products
set short_description = description
where short_description = '';

alter table public.products
  alter column sku set not null,
  drop constraint if exists products_status_check,
  drop constraint if exists products_sale_price_check,
  drop constraint if exists products_currency_check,
  add constraint products_status_check check (status in ('draft', 'active', 'archived')),
  add constraint products_sale_price_check check (sale_price is null or sale_price >= 0),
  add constraint products_currency_check check (currency ~ '^[A-Z]{3}$');

create unique index if not exists products_sku_unique on public.products (lower(sku));
create index if not exists products_status_updated_idx on public.products (status, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  image_url text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_categories_name_unique
on public.product_categories (lower(name));

insert into public.product_categories (name, slug, sort_order)
select distinct p.category,
       trim(both '-' from regexp_replace(lower(p.category), '[^a-z0-9]+', '-', 'g')),
       row_number() over (order by p.category)
from public.products p
where trim(p.category) <> ''
on conflict (slug) do nothing;

create table if not exists public.product_inventory (
  product_id text primary key references public.products(id) on delete cascade,
  quantity integer check (quantity is null or quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  product_id text not null references public.products(id) on delete cascade,
  previous_quantity integer,
  adjustment integer not null,
  new_quantity integer not null check (new_quantity >= 0),
  reason text not null check (length(trim(reason)) between 1 and 300),
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_product_date_idx
on public.inventory_movements (product_id, created_at desc);

create or replace function public.initialize_product_inventory()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.product_inventory (product_id, quantity)
  values (new.id, null)
  on conflict (product_id) do nothing;
  return new;
end;
$$;

drop trigger if exists products_initialize_inventory on public.products;
create trigger products_initialize_inventory
after insert on public.products
for each row execute function public.initialize_product_inventory();

insert into public.product_inventory (product_id, quantity)
select id, null from public.products
on conflict (product_id) do nothing;

create or replace function public.admin_adjust_inventory(
  p_product_id text,
  p_adjustment integer,
  p_reason text
)
returns table(previous_quantity integer, quantity integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_quantity integer;
  next_quantity integer;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'Administrator access is required';
  end if;
  if auth.uid() is null then
    raise exception 'Sign in as an administrator first';
  end if;
  if p_adjustment = 0 then
    raise exception 'Adjustment must not be zero';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 300 then
    raise exception 'Enter an adjustment reason (up to 300 characters)';
  end if;

  select i.quantity into old_quantity
  from public.product_inventory i
  where i.product_id = p_product_id
  for update;
  if not found then
    raise exception 'Product inventory record was not found';
  end if;
  next_quantity := coalesce(old_quantity, 0) + p_adjustment;
  if next_quantity < 0 then
    raise exception 'Stock cannot be less than zero';
  end if;

  update public.product_inventory i
  set quantity = next_quantity
  where i.product_id = p_product_id;

  update public.products p
  set available = next_quantity > 0
  where p.id = p_product_id;

  insert into public.inventory_movements
    (product_id, previous_quantity, adjustment, new_quantity, reason, changed_by)
  values
    (p_product_id, old_quantity, p_adjustment, next_quantity, trim(p_reason), auth.uid());

  return query select old_quantity, next_quantity;
end;
$$;

create table if not exists public.store_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  internal_description text not null default '',
  customer_message text not null default '',
  offer_type text not null check (offer_type in ('percentage', 'fixed')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  scope text not null check (scope in ('storewide', 'product', 'category')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  min_purchase numeric(10, 2) check (min_purchase is null or min_purchase >= 0),
  max_discount numeric(10, 2) check (max_discount is null or max_discount >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  priority integer not null default 0,
  show_banner boolean not null default false,
  cta_label text not null default 'Shop now',
  cta_url text not null default '/perfumes/shop',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (offer_type <> 'percentage' or discount_value <= 100)
);

create index if not exists store_offers_schedule_idx
on public.store_offers (status, starts_at, ends_at);

create table if not exists public.store_offer_products (
  offer_id uuid not null references public.store_offers(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  primary key (offer_id, product_id)
);

create table if not exists public.store_offer_categories (
  offer_id uuid not null references public.store_offers(id) on delete cascade,
  category_id uuid not null references public.product_categories(id) on delete cascade,
  primary key (offer_id, category_id)
);

create or replace function public.get_public_store_offers()
returns table (
  id uuid,
  name text,
  customer_message text,
  offer_type text,
  discount_value numeric,
  scope text,
  starts_at timestamptz,
  ends_at timestamptz,
  min_purchase numeric,
  max_discount numeric,
  priority integer,
  show_banner boolean,
  cta_label text,
  cta_url text,
  product_ids text[],
  category_ids uuid[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.name, o.customer_message, o.offer_type, o.discount_value,
         o.scope, o.starts_at, o.ends_at, o.min_purchase, o.max_discount,
         o.priority, o.show_banner, o.cta_label, o.cta_url,
         coalesce((select array_agg(op.product_id order by op.product_id)
                   from public.store_offer_products op where op.offer_id = o.id), '{}'::text[]),
         coalesce((select array_agg(oc.category_id order by oc.category_id)
                   from public.store_offer_categories oc where oc.offer_id = o.id), '{}'::uuid[])
  from public.store_offers o
  where o.status = 'active'
    and o.starts_at <= now()
    and o.ends_at > now()
  order by o.priority desc, o.starts_at desc, o.id;
$$;

create or replace function public.admin_save_store_offer(
  p_offer jsonb,
  p_product_ids text[],
  p_category_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_id uuid;
  item_product_id text;
  item_category_id uuid;
  offer_scope text;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin'
     or auth.uid() is null then
    raise exception 'Administrator access is required';
  end if;

  saved_id := nullif(p_offer ->> 'id', '')::uuid;
  offer_scope := p_offer ->> 'scope';
  if offer_scope = 'product' and coalesce(cardinality(p_product_ids), 0) = 0 then
    raise exception 'Choose at least one product for this offer';
  end if;
  if offer_scope = 'category' and coalesce(cardinality(p_category_ids), 0) = 0 then
    raise exception 'Choose at least one category for this offer';
  end if;

  if saved_id is null then
    insert into public.store_offers (
      name, internal_description, customer_message, offer_type, discount_value,
      scope, starts_at, ends_at, min_purchase, max_discount, status, priority,
      show_banner, cta_label, cta_url
    ) values (
      p_offer ->> 'name',
      coalesce(p_offer ->> 'internal_description', ''),
      coalesce(p_offer ->> 'customer_message', ''),
      p_offer ->> 'offer_type',
      (p_offer ->> 'discount_value')::numeric,
      offer_scope,
      (p_offer ->> 'starts_at')::timestamptz,
      (p_offer ->> 'ends_at')::timestamptz,
      nullif(p_offer ->> 'min_purchase', '')::numeric,
      nullif(p_offer ->> 'max_discount', '')::numeric,
      p_offer ->> 'status',
      coalesce((p_offer ->> 'priority')::integer, 0),
      coalesce((p_offer ->> 'show_banner')::boolean, false),
      coalesce(nullif(p_offer ->> 'cta_label', ''), 'Shop now'),
      coalesce(nullif(p_offer ->> 'cta_url', ''), '/perfumes/shop')
    ) returning id into saved_id;
  else
    update public.store_offers set
      name = p_offer ->> 'name',
      internal_description = coalesce(p_offer ->> 'internal_description', ''),
      customer_message = coalesce(p_offer ->> 'customer_message', ''),
      offer_type = p_offer ->> 'offer_type',
      discount_value = (p_offer ->> 'discount_value')::numeric,
      scope = offer_scope,
      starts_at = (p_offer ->> 'starts_at')::timestamptz,
      ends_at = (p_offer ->> 'ends_at')::timestamptz,
      min_purchase = nullif(p_offer ->> 'min_purchase', '')::numeric,
      max_discount = nullif(p_offer ->> 'max_discount', '')::numeric,
      status = p_offer ->> 'status',
      priority = coalesce((p_offer ->> 'priority')::integer, 0),
      show_banner = coalesce((p_offer ->> 'show_banner')::boolean, false),
      cta_label = coalesce(nullif(p_offer ->> 'cta_label', ''), 'Shop now'),
      cta_url = coalesce(nullif(p_offer ->> 'cta_url', ''), '/perfumes/shop')
    where id = saved_id;
    if not found then raise exception 'Offer not found'; end if;
  end if;

  delete from public.store_offer_products where offer_id = saved_id;
  delete from public.store_offer_categories where offer_id = saved_id;
  foreach item_product_id in array coalesce(p_product_ids, '{}'::text[]) loop
    insert into public.store_offer_products (offer_id, product_id)
    values (saved_id, item_product_id);
  end loop;
  foreach item_category_id in array coalesce(p_category_ids, '{}'::uuid[]) loop
    insert into public.store_offer_categories (offer_id, category_id)
    values (saved_id, item_category_id);
  end loop;
  return saved_id;
end;
$$;

create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  store_name text not null default 'ShaaFragrance',
  logo_url text not null default '/images/shaafragrance-logo.jpg',
  description text not null default 'Fragrance is personal. Explore the collection and find the notes you return to.',
  whatsapp text not null default '',
  email text not null default 'hello@example.com',
  phone text not null default '+91 00000 00000',
  instagram text not null default 'https://instagram.com/',
  location text not null default 'Your city, India',
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  shipping_message text not null default 'We will confirm availability and delivery over WhatsApp.',
  timezone text not null default 'Asia/Kolkata',
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id) values (1) on conflict (id) do nothing;

create or replace function public.rename_product_category(p_category_id uuid, p_new_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_name text;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'Administrator access is required';
  end if;
  if p_new_name is null or length(trim(p_new_name)) not between 1 and 80 then
    raise exception 'Category name must contain 1 to 80 characters';
  end if;
  select c.name into old_name from public.product_categories c where c.id = p_category_id for update;
  if not found then raise exception 'Category not found'; end if;
  update public.products set category = trim(p_new_name) where category = old_name;
  update public.product_categories set name = trim(p_new_name) where id = p_category_id;
end;
$$;

create or replace function public.prevent_category_delete_when_used()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.products p where lower(p.category) = lower(old.name)) then
    raise exception 'Reassign or rename products in this category before deleting it';
  end if;
  return old;
end;
$$;

drop trigger if exists product_categories_prevent_used_delete on public.product_categories;
create trigger product_categories_prevent_used_delete
before delete on public.product_categories
for each row execute function public.prevent_category_delete_when_used();

drop trigger if exists product_categories_set_updated_at on public.product_categories;
create trigger product_categories_set_updated_at
before update on public.product_categories
for each row execute function public.set_updated_at();

drop trigger if exists store_offers_set_updated_at on public.store_offers;
create trigger store_offers_set_updated_at
before update on public.store_offers
for each row execute function public.set_updated_at();

drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at
before update on public.store_settings
for each row execute function public.set_updated_at();

alter table public.product_categories enable row level security;
alter table public.product_inventory enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.store_offers enable row level security;
alter table public.store_offer_products enable row level security;
alter table public.store_offer_categories enable row level security;
alter table public.store_settings enable row level security;

drop policy if exists "Anyone can view fragrances" on public.products;
drop policy if exists "Admins can manage fragrances" on public.products;
drop policy if exists "Public can view active fragrances" on public.products;
drop policy if exists "Admins can manage all fragrances" on public.products;
create policy "Public can view active fragrances" on public.products
for select to anon, authenticated using (status = 'active');
create policy "Admins can manage all fragrances" on public.products
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins manage categories" on public.product_categories;
drop policy if exists "Public read active categories" on public.product_categories;
drop policy if exists "Admins manage inventory" on public.product_inventory;
create policy "Admins manage categories" on public.product_categories
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Public read active categories" on public.product_categories
for select to anon, authenticated using (active = true);

drop policy if exists "Admins read inventory history" on public.inventory_movements;
create policy "Admins manage inventory" on public.product_inventory
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins read inventory history" on public.inventory_movements
for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins manage offers" on public.store_offers;
create policy "Admins manage offers" on public.store_offers
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins manage offer products" on public.store_offer_products;
create policy "Admins manage offer products" on public.store_offer_products
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins manage offer categories" on public.store_offer_categories;
create policy "Admins manage offer categories" on public.store_offer_categories
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Public can read store settings" on public.store_settings;
drop policy if exists "Admins can manage store settings" on public.store_settings;
create policy "Public can read store settings" on public.store_settings
for select to anon, authenticated using (id = 1);
create policy "Admins can manage store settings" on public.store_settings
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

revoke all on public.products from anon;
grant select (id, name, category, size, price, price_label, description, notes,
  image_url, available, availability, ingredients, variants, featured, arrival_date,
  short_description, product_brand, audience, currency, sale_price, status,
  image_urls, specifications, is_new_arrival)
on public.products to anon;
grant all on public.products to authenticated;

revoke all on public.product_categories, public.product_inventory, public.inventory_movements,
  public.store_offers, public.store_offer_products, public.store_offer_categories, public.store_settings
from anon, authenticated;
grant select (id, name, slug, description, image_url, sort_order, active)
on public.product_categories to anon, authenticated;
grant all on public.product_categories to authenticated;
grant select, insert, update, delete on public.product_inventory to authenticated;
grant select on public.inventory_movements to authenticated;
grant usage, select on sequence public.inventory_movements_id_seq to authenticated;
grant select, insert, update, delete on public.store_offers,
  public.store_offer_products, public.store_offer_categories to authenticated;
grant select (id, store_name, logo_url, description, whatsapp, email, phone,
  instagram, location, currency, low_stock_threshold, shipping_message, timezone, updated_at)
on public.store_settings to anon, authenticated;
grant insert, update, delete on public.store_settings to authenticated;

revoke all on function public.admin_adjust_inventory(text, integer, text) from public, anon;
grant execute on function public.admin_adjust_inventory(text, integer, text) to authenticated;
revoke all on function public.rename_product_category(uuid, text) from public, anon;
grant execute on function public.rename_product_category(uuid, text) to authenticated;
revoke all on function public.admin_save_store_offer(jsonb, text[], uuid[]) from public, anon;
grant execute on function public.admin_save_store_offer(jsonb, text[], uuid[]) to authenticated;
revoke all on function public.get_public_store_offers() from public;
grant execute on function public.get_public_store_offers() to anon, authenticated;

commit;
