create or replace function public.admin_mark_product_out_of_stock(p_product_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_quantity integer;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'Administrator access is required';
  end if;
  if auth.uid() is null then
    raise exception 'Sign in as an administrator first';
  end if;

  select i.quantity into old_quantity
  from public.product_inventory i
  where i.product_id = p_product_id
  for update;
  if not found then
    raise exception 'Product inventory record was not found';
  end if;

  update public.product_inventory
  set quantity = 0
  where product_id = p_product_id;

  update public.products
  set available = false
  where id = p_product_id;

  if old_quantity is distinct from 0 then
    insert into public.inventory_movements
      (product_id, previous_quantity, adjustment, new_quantity, reason, changed_by)
    values
      (p_product_id, old_quantity, -coalesce(old_quantity, 0), 0,
       'Marked out of stock from the product catalogue', auth.uid());
  end if;
end;
$$;

revoke all on function public.admin_mark_product_out_of_stock(text) from public, anon;
grant execute on function public.admin_mark_product_out_of_stock(text) to authenticated;
