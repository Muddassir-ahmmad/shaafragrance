# ShaaFragrance

A responsive perfume storefront with an automatic fragrance intro animation and a separate `/admin` dashboard. The storefront and administrator dashboard use Supabase for shared product, category, inventory, offer, and store-setting data. No service-role key is used in the browser.

## Run locally

1. Install Node.js 20 or newer and run `npm install`.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the public project URL and anon/publishable key.
3. In the Supabase SQL editor, run `supabase/schema.sql`, followed by `supabase/migrations/001_admin_dashboard.sql`, `supabase/migrations/002_product_image_storage.sql`, and `supabase/migrations/003_admin_mark_out_of_stock.sql`.
4. Create a user in **Authentication → Users**, then grant administrator access from the SQL editor using the account email:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'your-admin-email@example.com';
   ```

   Sign out and back in after changing the role so the user's JWT contains the trusted `app_metadata.role` claim.
5. Run `npm run dev` and open `/admin` to sign in. Use the dashboard to manage products, categories, inventory, offers, banners, and public store settings. Active offers automatically show discounted prices and badges for eligible products; enable the banner option to show the customer message across the storefront. Products marked as new arrivals display a badge in the shop. Use the product list's “Mark out of stock” action to set quantity to zero; add stock from Inventory to make the item available again.
6. Run `npm run build` to create the deployable `dist/` folder.

The schema seeds the supplied perfume products when their IDs do not already exist. Public visitors can read active products, active categories, current offers, and public store settings. Row-level security restricts management operations to authenticated users whose trusted `app_metadata.role` is `admin`. Inventory adjustments are recorded with a reason; use the Inventory page after creating a product to set its opening stock.

If you already ran the dashboard migration before the public product `status` column grant was included, run this once in the SQL editor, then hard-refresh the storefront:

```sql
grant select (status) on public.products to anon, authenticated;
```

On the product form, choose a main photo and optional additional photos from your device. Saving uploads them to the public `product-images` Supabase Storage bucket so storefront visitors can see them; only authenticated administrators can upload, update, or delete files. Each image must be JPEG, PNG, WebP, AVIF, or GIF and no larger than 8 MB. Run `002_product_image_storage.sql` in Supabase before using photo uploads. Never put a Supabase service-role key or other secret in the frontend or store settings.

## Current boundaries

- The storefront's WhatsApp ordering flow is an enquiry only. It does not store orders, payments, fulfillment, or sales; the dashboard does not invent order or revenue analytics.
- The contact form is a frontend preview and does not send or store submissions. Connect a protected form service before publishing.
- Supabase must be configured and the schema plus dashboard, image-storage, and out-of-stock migrations applied before all dashboard features can operate. `.env.example` contains placeholders, not working project credentials.
- Deploy to a static host configured to serve `index.html` for nested routes such as `/perfumes/shop` and `/admin`.
