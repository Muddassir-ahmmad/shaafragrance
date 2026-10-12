import { brand, perfumeBrand } from "./data.js";
import { offerFromRow, offerToRow, productFromRow, productToRow, slugify, supabase } from "./store.js";
import { calculateDiscount } from "./pricing.js";

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const formatDate = (value, timezone = "Asia/Kolkata") => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value))
  : "—";
const slugValue = (name) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const defaultSettingValues = {
  store_name: brand.perfumeName,
  logo_url: perfumeBrand.logo,
  description: perfumeBrand.description,
  whatsapp: brand.whatsapp,
  email: brand.email,
  phone: brand.phone,
  instagram: brand.instagram,
  location: brand.location,
  currency: brand.currency || "INR",
  low_stock_threshold: 5,
  shipping_message: brand.shippingMessage || "We will confirm availability and delivery over WhatsApp.",
  timezone: brand.timezone || "Asia/Kolkata",
};
const productFields = [
  ["name", "Product name", "text", true],
  ["sku", "SKU", "text", true],
  ["category", "Category", "select", true],
  ["size", "Bottle size", "text", true],
  ["shortDescription", "Short description", "textarea", true],
  ["description", "Full description", "textarea", true],
  ["price", "Regular price (₹)", "number", true],
  ["salePrice", "Sale price (optional)", "number", false],
  ["image", "Main product photo", "image", true],
  ["imageGallery", "Additional product photos", "imageGallery", false],
  ["notes", "Fragrance notes (comma separated)", "text", false],
  ["ingredients", "Ingredients (comma separated)", "text", false],
  ["audience", "Suitable audience (if known)", "text", false],
  ["status", "Status", "status", true],
  ["featured", "Feature on home page", "checkbox", false],
  ["isNewArrival", "Mark as new arrival", "checkbox", false],
];

function status(root, message, isError = false) {
  const target = root.querySelector("[data-admin-message]");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("is-error", isError);
}

function showAdminToast(root, message) {
  root.querySelector("[data-admin-toast]")?.remove();
  const toast = document.createElement("div");
  toast.className = "admin-toast";
  toast.dataset.adminToast = "";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;
  root.append(toast);
  window.setTimeout(() => toast.remove(), 5000);
}

function productSaveError(error) {
  if (error?.code === "23514" && error.message?.includes("products_description_check")) {
    return "The full description must contain 1–600 characters. Please update it and save again.";
  }
  return error?.message || "We couldn't save this product. Please try again.";
}

async function uploadProductImage(file, productName) {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
  if (!allowedTypes.has(file.type)) throw new Error(`"${file.name}" is not a supported image. Choose JPEG, PNG, WebP, AVIF, or GIF.`);
  if (file.size > 8 * 1024 * 1024) throw new Error(`"${file.name}" is larger than the 8 MB image limit.`);
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif" })[file.type];
  const path = `${slugify(productName) || "fragrance"}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("product-images").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`Could not upload "${file.name}": ${error.message}`);
  return { path, url: supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl };
}

function drawLoading(root, message = "Loading dashboard…") {
  root.innerHTML = `<div class="admin-loading"><span class="admin-spinner" aria-hidden="true"></span><p>${escapeHtml(message)}</p></div>`;
}

function drawError(root, message) {
  root.innerHTML = `<main class="admin-login-wrap"><section class="admin-login"><span class="eyebrow">ShaaFragrance · Admin</span><h1>We could not<br><em>open admin.</em></h1><p class="admin-error-copy">${escapeHtml(message)}</p><a class="button button--dark" href="/perfumes">Return to storefront</a></section></main>`;
}

function drawSetup(root) {
  root.innerHTML = `<main class="admin-login-wrap"><section class="admin-login"><a class="admin-store-link" href="/perfumes">← ShaaFragrance</a><span class="eyebrow">Private workspace</span><h1>Connect your<br><em>product store.</em></h1><p>To activate shared products and administrator sign-in, configure your Supabase project and run the included schema and dashboard migration.</p><p class="admin-error-copy">See the Setup section in README.md. The dashboard will not use browser-only demo storage.</p><a class="button button--dark" href="/perfumes">Visit storefront</a></section></main>`;
}

function adminShell(root, { page, session, active, sidebarOpen = false }) {
  const adminEmail = escapeHtml(session.user.email || "Store administrator");
  const displayName = escapeHtml((session.user.user_metadata?.full_name || session.user.email || "Admin").split("@")[0]);
  root.innerHTML = `<div class="admin-shell ${sidebarOpen ? "admin-shell--nav-open" : ""}">
    <aside class="admin-sidebar" id="admin-sidebar" aria-label="Admin navigation">
      <a class="admin-brand" href="/admin"><img src="${escapeHtml(brand.logo)}" alt=""><span><strong>${escapeHtml(brand.perfumeName)}</strong><small>STORE ADMIN</small></span></a>
      <nav class="admin-sidebar-nav">${[
    ["/admin", "Overview", "OV"],
    ["/admin/products", "Products", "PR"],
    ["/admin/categories", "Categories", "CA"],
    ["/admin/inventory", "Inventory", "IN"],
    ["/admin/offers", "Offers & banners", "OF"],
    ["/admin/orders", "Orders", "OR"],
    ["/admin/analytics", "Analytics", "AN"],
    ["/admin/settings", "Store settings", "ST"],
  ].map(([href, label, icon]) => `<a href="${href}" class="admin-nav-link${active === href ? " is-active" : ""}" ${active === href ? 'aria-current="page"' : ""}><span class="admin-nav-icon">${icon}</span>${label}</a>`).join("")}</nav>
      <div class="admin-sidebar-bottom"><div class="admin-profile"><span class="admin-avatar">${escapeHtml(displayName[0]?.toUpperCase() || "A")}</span><span><strong>${displayName}</strong><small>${adminEmail}</small></span></div><button type="button" class="admin-logout" data-admin-signout>Sign out ↗</button></div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar"><button type="button" class="admin-mobile-menu" aria-label="Toggle admin navigation" aria-expanded="${sidebarOpen}">☰</button><div><span class="admin-topbar-label">STORE MANAGEMENT</span><h2>${escapeHtml(page)}</h2></div><div class="admin-topbar-actions"><a class="admin-store-link" href="/perfumes" target="_blank" rel="noreferrer">Preview storefront ↗</a><span class="admin-avatar admin-avatar--top">${escapeHtml(displayName[0]?.toUpperCase() || "A")}</span></div></header>
      <main class="admin-content">${page === "Overview"
    ? overviewPage()
    : page === "Products"
      ? productsPage()
      : page === "Create product" || page === "Edit product"
        ? productEditor(page, session)
        : page === "Categories"
          ? categoriesPage()
          : page === "Inventory"
            ? inventoryPage()
            : page === "Offers & banners" || page === "Create offer" || page === "Edit offer"
              ? offersPage()
              : page === "Orders"
                ? ordersPage()
                : page === "Analytics"
                  ? analyticsPage()
                  : settingsPage()}</main>
      <p class="admin-global-status admin-message" role="status" aria-live="polite" data-admin-message></p>
    </div>
  </div>`;
}

function overviewPage() {
  return `<section class="admin-page-heading"><div><span class="eyebrow">STORE OVERVIEW</span><h1>Your fragrance<br><em>business.</em></h1><p>A live view of your catalogue and operations.</p></div><a class="button button--dark" href="/admin/products/new">＋ Add perfume</a></section>
    <div class="admin-metric-grid" data-overview-metrics><article class="admin-metric"><span>ACTIVE PRODUCTS</span><strong data-metric="active">—</strong><small>Published on the storefront</small></article><article class="admin-metric"><span>TOTAL PRODUCTS</span><strong data-metric="total">—</strong><small>Includes drafts and archived</small></article><article class="admin-metric"><span>LOW STOCK</span><strong data-metric="low">—</strong><small>At or below your threshold</small></article><article class="admin-metric"><span>OUT OF STOCK</span><strong data-metric="out">—</strong><small>Inventory set to zero</small></article></div>
    <div class="admin-overview-grid"><section class="admin-panel"><div class="admin-panel-heading"><div><span class="eyebrow">CATALOGUE</span><h2>Recently updated</h2></div><a class="text-link" href="/admin/products">All products ↗</a></div><div data-recent-products><p class="admin-skeleton-line"></p><p class="admin-skeleton-line"></p></div></section><section class="admin-panel"><div class="admin-panel-heading"><div><span class="eyebrow">PROMOTIONS</span><h2>Current offers</h2></div><a class="text-link" href="/admin/offers">Manage offers ↗</a></div><div data-current-offers><p class="admin-skeleton-line"></p></div><div class="admin-quick-actions"><a href="/admin/products/new">＋ Add product</a><a href="/admin/offers/new">＋ Create offer</a><a href="/admin/inventory">↗ Update inventory</a><a href="/perfumes">↗ View storefront</a></div></section></div>
    <section class="admin-panel admin-recent-orders"><div class="admin-panel-heading"><div><span class="eyebrow">ORDER TRACKING</span><h2>Orders</h2></div><a class="text-link" href="/admin/orders">Order setup ↗</a></div><p>No order system is connected yet. WhatsApp messages are enquiries, not confirmed or completed sales. No order counts or revenue are shown.</p></section>`;
}

function productsPage() {
  return `<section class="admin-page-heading"><div><span class="eyebrow">CATALOGUE</span><h1>Your <em>products.</em></h1><p>Manage the items published in the ShaaFragrance shop.</p></div><a class="button button--dark" href="/admin/products/new">＋ Create product</a></section>
    <section class="admin-panel"><div class="admin-product-toolbar"><label class="admin-search"><span aria-hidden="true">⌕</span><input type="search" data-product-search placeholder="Search products, SKU, category…" aria-label="Search products"></label><label class="admin-compact-filter">Status<select data-product-status><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select></label><label class="admin-compact-filter">Stock<select data-product-stock><option value="all">All stock</option><option value="instock">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select></label><label class="admin-compact-filter">Sort<select data-product-sort><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Name</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="stock">Stock level</option></select></label></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th><th>UPDATED</th><th></th></tr></thead><tbody data-product-rows></tbody></table></div><div class="admin-mobile-product-list" data-mobile-product-rows></div><div class="admin-pagination"><span data-product-count></span><div><button type="button" data-page-prev aria-label="Previous page">←</button><span data-page-label></span><button type="button" data-page-next aria-label="Next page">→</button></div></div></section>`;
}

function productEditor(page) {
  return `<section class="admin-page-heading"><div><span class="eyebrow">CATALOGUE · ${page === "Edit product" ? "EDIT" : "NEW"}</span><h1>${page === "Edit product" ? "Refine your" : "Create a"}<br><em>fragrance.</em></h1><p>Choose photos from your device. They are uploaded to shared store storage when you save.</p></div><a class="button button--quiet" href="/admin/products">← Back to products</a></section><section class="admin-panel"><form class="admin-editor-form" data-product-editor data-product-id=""><div class="admin-form-grid" data-product-form-fields></div><div class="admin-form-actions"><p class="admin-form-feedback" data-form-feedback role="status" aria-live="polite"></p><a class="button button--quiet" href="/admin/products">Cancel</a><button type="submit" class="button button--dark">Save product ↗</button></div></form></section>`;
}

function categoriesPage() {
  return `<section class="admin-page-heading"><div><span class="eyebrow">CATALOGUE ORGANIZATION</span><h1>Scent <em>families.</em></h1><p>Category changes keep product labels, filters, and the storefront catalogue in sync.</p></div></section><div class="admin-two-column"><section class="admin-panel"><div class="admin-panel-heading"><div><span class="eyebrow">NEW CATEGORY</span><h2>Add a scent family</h2></div></div><form class="admin-stacked-form" data-category-create><label>Name<input name="name" required maxlength="80" placeholder="e.g. Oud"></label><label>Slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="oud"></label><label>Description<textarea name="description" rows="3" maxlength="400"></textarea></label><label>Image URL <span class="optional">(optional)</span><input type="url" name="image_url"></label><button class="button button--dark" type="submit">Create category ↗</button><p class="admin-form-feedback" data-form-feedback role="status"></p></form></section><section class="admin-panel"><div class="admin-panel-heading"><div><span class="eyebrow">STOREFRONT FILTERS</span><h2>Categories</h2></div></div><div data-category-rows></div></section></div>`;
}

function inventoryPage() {
  return `<section class="admin-page-heading"><div><span class="eyebrow">STOCK CONTROL</span><h1>Inventory <em>status.</em></h1><p>Track stock with explicit, reasoned adjustments. WhatsApp enquiries never deduct stock.</p></div></section><div class="admin-metric-grid admin-metric-grid--small"><article class="admin-metric"><span>TRACKED PRODUCTS</span><strong data-inventory-metric="tracked">—</strong></article><article class="admin-metric"><span>LOW STOCK</span><strong data-inventory-metric="low">—</strong></article><article class="admin-metric"><span>OUT OF STOCK</span><strong data-inventory-metric="out">—</strong></article><article class="admin-metric"><span>NOT TRACKED</span><strong data-inventory-metric="untracked">—</strong></article></div><section class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>PRODUCT</th><th>SKU</th><th>QUANTITY</th><th>LOW-STOCK THRESHOLD</th><th>AVAILABILITY</th><th>STATUS</th><th></th></tr></thead><tbody data-inventory-rows></tbody></table></div><div class="admin-mobile-product-list" data-inventory-mobile></div></section><section class="admin-panel admin-history-panel"><div class="admin-panel-heading"><div><span class="eyebrow">AUDIT TRAIL</span><h2>Recent stock adjustments</h2></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>PRODUCT</th><th>CHANGE</th><th>NEW QUANTITY</th><th>REASON</th><th>CHANGED</th></tr></thead><tbody data-inventory-history></tbody></table></div></section>`;
}

function offerEditor(offerId = "") {
  return `<section class="admin-page-heading"><div><span class="eyebrow">OFFERS · ${offerId ? "EDIT" : "NEW"}</span><h1>${offerId ? "Edit your" : "Create an"}<br><em>offer.</em></h1><p>Dates are stored in UTC. Only offers within their start/end window are applied on the shop.</p></div><a class="button button--quiet" href="/admin/offers">← Back to offers</a></section><section class="admin-panel"><form class="admin-editor-form" data-offer-editor data-offer-id="${escapeHtml(offerId)}"><div class="admin-form-grid" data-offer-form-fields></div><div class="admin-form-actions"><p class="admin-form-feedback" data-form-feedback role="status" aria-live="polite"></p><a class="button button--quiet" href="/admin/offers">Cancel</a><button type="submit" class="button button--dark">Save offer ↗</button></div></form></section>`;
}

function offersPage() {
  if (window.location.pathname === "/admin/offers/new") return offerEditor();
  if (window.location.pathname.startsWith("/admin/offers/") && window.location.pathname.endsWith("/edit")) return offerEditor(window.location.pathname.split("/")[3]);
  return `<section class="admin-page-heading"><div><span class="eyebrow">PROMOTIONS</span><h1>Offers & <em>banners.</em></h1><p>Create scheduled fragrance discounts and storefront announcements.</p></div><a class="button button--dark" href="/admin/offers/new">＋ Create offer</a></section><section class="admin-panel"><div class="admin-product-toolbar"><label class="admin-search"><span aria-hidden="true">⌕</span><input type="search" data-offer-search placeholder="Search offers…" aria-label="Search offers"></label><label class="admin-compact-filter">Status<select data-offer-status><option value="all">All offers</option><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="active">Active</option><option value="paused">Paused</option><option value="expired">Expired</option></select></label></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>OFFER</th><th>DISCOUNT</th><th>APPLIES TO</th><th>SCHEDULE</th><th>STATUS</th><th>BANNER</th><th></th></tr></thead><tbody data-offer-rows></tbody></table></div><div class="admin-mobile-product-list" data-offer-mobile></div></section><section class="admin-panel admin-banner-preview" data-banner-preview><div class="admin-panel-heading"><div><span class="eyebrow">STOREFRONT PREVIEW</span><h2>Active announcement</h2></div></div><p data-banner-preview-content></p></section>`;
}

function ordersPage() {
  return `<section class="admin-page-heading"><div><span class="eyebrow">ORDER TRACKING</span><h1>Customer <em>orders.</em></h1><p>Enquiries and completed sales are kept distinct.</p></div></section><section class="admin-honest-empty"><span class="eyebrow">NOT CONNECTED</span><h2>Orders are not stored yet.</h2><p>The current ordering flow opens WhatsApp and does not persist customer, payment, fulfillment, or sale data. Messages are enquiries only. No orders or revenue are invented here.</p><p>To enable order management, connect a trusted order-confirmation and payment workflow with server-side total calculation before representing enquiries as orders.</p></section>`;
}

function analyticsPage() {
  return `<section class="admin-page-heading"><div><span class="eyebrow">BUSINESS REPORTING</span><h1>Store <em>analytics.</em></h1><p>Metrics are shown only when supported by real records.</p></div></section><div class="admin-honest-empty"><span class="eyebrow">CATALOGUE METRICS ONLY</span><h2>No sales analytics source.</h2><p>Product and inventory counts are available in Overview. Sales, revenue, customer, conversion, and best-seller metrics need persisted, confirmed order and payment data. WhatsApp clicks are not counted as sales.</p></div>`;
}

function settingsPage() {
  return `<section class="admin-page-heading"><div><span class="eyebrow">PUBLIC BUSINESS DETAILS</span><h1>Store <em>settings.</em></h1><p>These values feed the public storefront. Never store secrets or API keys here.</p></div></section><section class="admin-panel"><form class="admin-editor-form" data-settings-form><div class="admin-form-grid" data-settings-fields></div><div class="admin-form-actions"><p class="admin-form-feedback" data-form-feedback role="status" aria-live="polite"></p><button type="submit" class="button button--dark">Save settings ↗</button></div></form></section>`;
}

function fieldControl(field, state = {}) {
  const [name, label, type, required] = field;
  const value = state[name];
  const req = required ? "required" : "";
  if (type === "checkbox") return `<label class="admin-check-field"><input type="checkbox" name="${name}" ${value ? "checked" : ""}>${label}</label>`;
  if (type === "image") return `<div class="admin-field admin-field--wide"><span class="admin-label">${label}</span><input type="hidden" name="image" data-product-image-url value="${escapeHtml(value || "")}"><input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" data-product-main-file aria-label="Choose main product photo"><span class="admin-field-help">Choose a photo from your device (up to 8 MB).</span><div class="admin-image-preview" data-main-image-preview>${value ? `<img src="${escapeHtml(value)}" alt="Current main product photo">` : '<span>No main photo selected</span>'}</div><div class="admin-image-preview admin-image-preview--selected" data-selected-main-preview hidden></div></div>`;
  if (type === "imageGallery") {
    const images = String(value || "").split(/\r?\n/).map((image) => image.trim()).filter(Boolean);
    return `<div class="admin-field admin-field--wide"><span class="admin-label">${label}</span><textarea name="imageGallery" data-product-gallery-urls hidden>${escapeHtml(value || "")}</textarea><input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple data-product-gallery-files aria-label="Choose additional product photos"><span class="admin-field-help">Select one or more photos from your device. Existing photos are kept; selected photos are added when you save. Up to 8 MB each.</span><div class="admin-image-gallery-preview" data-gallery-image-preview>${images.length ? images.map((image) => `<img src="${escapeHtml(image)}" alt="Current product gallery photo">`).join("") : "<span>No additional photos selected</span>"}</div><div class="admin-image-gallery-preview admin-image-preview--selected" data-selected-gallery-preview hidden></div></div>`;
  }
  if (type === "textarea") {
    const descriptionRules = name === "description"
      ? 'minlength="1" maxlength="600" aria-describedby="product-description-help"'
      : "";
    const help = name === "description"
      ? '<span class="admin-field-help" id="product-description-help">Required: 1–600 characters. Spaces alone do not count.</span>'
      : "";
    return `<label class="admin-field admin-field--wide">${label}<textarea name="${name}" rows="3" ${req} ${descriptionRules}>${escapeHtml(value || "")}</textarea>${help}</label>`;
  }
  if (type === "select") return `<label class="admin-field">${label}<select name="${name}" ${req}><option value="">Choose a category</option>${(state.categories || []).map((category) => `<option value="${escapeHtml(category.name)}" ${value === category.name ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select></label>`;
  if (type === "status") return `<label class="admin-field">Product status<select name="status" ${req}>${["active", "draft", "archived"].map((item) => `<option value="${item}" ${(value || "active") === item ? "selected" : ""}>${item[0].toUpperCase()}${item.slice(1)}</option>`).join("")}</select></label>`;
  const numeric = type === "number";
  const min = numeric ? `min="0" ${name === "price" || name === "salePrice" ? 'step="0.01"' : 'step="1"'}` : "";
  const extra = name === "slug" ? 'pattern="[a-z0-9]+(-[a-z0-9]+)*"' : "";
  return `<label class="admin-field">${label}<input name="${name}" type="${type}" ${numeric ? min : ""} ${extra} ${req} value="${escapeHtml(value ?? "")}"></label>`;
}

function productStockState(product, inventory, settings) {
  const row = inventory.find((item) => item.product_id === product.id);
  if (row?.quantity == null) return "untracked";
  if (row.quantity === 0) return "out";
  if (row.quantity <= (row.low_stock_threshold ?? settings.low_stock_threshold)) return "low";
  return "instock";
}

function productRowHtml(product, inventory, settings) {
  const stockRow = inventory.find((item) => item.product_id === product.id);
  const quantity = stockRow?.quantity;
  const outOfStock = productStockState(product, inventory, settings) === "out";
  return `<tr><td><span class="admin-table-product"><img src="${escapeHtml(product.image_url)}" alt=""><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.short_description || product.description)}</small></span></span></td><td>${escapeHtml(product.sku || "—")}</td><td>${escapeHtml(product.category)}</td><td>${product.price == null ? "Not set" : money(product.sale_price ?? product.price)}${product.sale_price != null ? `<small class="admin-struck-price">${money(product.price)}</small>` : ""}</td><td>${quantity == null ? "Not tracked" : quantity}</td><td><span class="admin-badge admin-badge--${escapeHtml(product.status)}">${escapeHtml(product.status)}</span></td><td>${formatDate(product.updated_at, settings.timezone)}</td><td><div class="admin-row-actions"><a href="/admin/products/${encodeURIComponent(product.id)}/edit">Edit</a><button type="button" data-product-action="duplicate" data-product-id="${escapeHtml(product.id)}">Duplicate</button><button type="button" data-product-action="${outOfStock ? "mark-in-stock" : "mark-out-of-stock"}" data-product-id="${escapeHtml(product.id)}" ${outOfStock ? 'disabled title="Add stock from Inventory to mark this item in stock"' : ""}>${outOfStock ? "Out of stock" : "Mark out of stock"}</button><button type="button" data-product-action="${product.status === "archived" ? "restore" : "archive"}" data-product-id="${escapeHtml(product.id)}">${product.status === "archived" ? "Restore" : "Archive"}</button></div></td></tr>`;
}

function mobileProductHtml(product, inventory, settings) {
  const quantity = inventory.find((item) => item.product_id === product.id)?.quantity;
  const outOfStock = productStockState(product, inventory, settings) === "out";
  return `<article class="admin-mobile-card"><img src="${escapeHtml(product.image_url)}" alt=""><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.sku || "No SKU")} · ${escapeHtml(product.category)}</span><span>${product.price == null ? "Price not set" : money(product.sale_price ?? product.price)} · ${quantity == null ? "Stock not tracked" : `${quantity} in stock`}</span><span class="admin-badge admin-badge--${escapeHtml(product.status)}">${escapeHtml(product.status)}</span><div class="admin-row-actions"><a href="/admin/products/${encodeURIComponent(product.id)}/edit">Edit</a><button type="button" data-product-action="duplicate" data-product-id="${escapeHtml(product.id)}">Duplicate</button><button type="button" data-product-action="${outOfStock ? "mark-in-stock" : "mark-out-of-stock"}" data-product-id="${escapeHtml(product.id)}" ${outOfStock ? 'disabled title="Add stock from Inventory to mark this item in stock"' : ""}>${outOfStock ? "Out of stock" : "Mark out of stock"}</button><button type="button" data-product-action="${product.status === "archived" ? "restore" : "archive"}" data-product-id="${escapeHtml(product.id)}">${product.status === "archived" ? "Restore" : "Archive"}</button></div></div></article>`;
}

function getOfferStatus(offer) {
  const now = Date.now();
  if (offer.status === "paused") return "paused";
  if (offer.status === "draft") return "draft";
  const endsAt = new Date(offer.endsAt || offer.ends_at).getTime();
  const startsAt = new Date(offer.startsAt || offer.starts_at).getTime();
  if (endsAt <= now) return "expired";
  if (startsAt > now) return "scheduled";
  return "active";
}

function offerDescription(offer, productIds, categoryIds, products, categories) {
  if (offer.scope === "storewide") return "Storewide";
  if (offer.scope === "product") return productIds.map((id) => products.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || "No products";
  return categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ") || "No categories";
}

function collectProductForm(form, categories, original = null, hasMainImage = false) {
  const values = new FormData(form);
  const rawSale = String(values.get("salePrice") || "").trim();
  const notes = String(values.get("notes") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const ingredients = String(values.get("ingredients") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const images = [String(values.get("image") || "").trim(), ...String(values.get("imageGallery") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)];
  const category = String(values.get("category") || "").trim();
  const selectedCategory = categories.find((item) => item.name === category);
  const name = String(values.get("name") || "").trim();
  const description = String(values.get("description") || "").trim();
  const price = Number(values.get("price"));
  const salePrice = rawSale ? Number(rawSale) : null;
  const sku = String(values.get("sku") || "").trim();
  if (!name || !category || !sku) throw new Error("Product name, SKU, and category are required.");
  if (!description) throw new Error("Add a full product description before saving. It must be between 1 and 600 characters.");
  if (Array.from(description).length > 600) throw new Error("The full product description is too long. Keep it within 600 characters.");
  if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid regular price.");
  if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > price)) {
    throw new Error("Sale price must be zero or more and cannot exceed the regular price.");
  }
  if (!images[0] && !hasMainImage) throw new Error("Choose a main product photo from your device.");
  if (images.filter(Boolean).some((url) => !/^https?:\/\//i.test(url) && !url.startsWith("/"))) {
    throw new Error("Product image URLs must use https:// or a site-relative path.");
  }
  return {
    product: {
      id: original?.id || slugify(name),
      name,
      sku,
      category,
      categoryId: selectedCategory?.id || null,
      size: String(values.get("size") || "").trim(),
      shortDescription: String(values.get("shortDescription") || "").trim(),
      description,
      price,
      salePrice,
      image: images[0],
      images,
      notes,
      ingredients,
      audience: String(values.get("audience") || "").trim(),
      status: String(values.get("status") || "active"),
      available: original?.available ?? true,
      availability: original?.availability || "Contact us to confirm availability",
      featured: values.has("featured"),
      isNewArrival: values.has("isNewArrival"),
      productBrand: brand.perfumeName,
      currency: "INR",
      specifications: original?.specifications || {},
      variants: original?.variants || [],
      arrivalDate: original?.arrival_date || "",
    },
    categoryId: selectedCategory?.id || null,
  };
}

function offerEditorFields(offer = {}, context) {
  const productOptions = context.products.map((product) => `<label class="admin-multi-option"><input type="checkbox" name="productIds" value="${escapeHtml(product.id)}" ${(offer.productIds || []).includes(product.id) ? "checked" : ""}>${escapeHtml(product.name)}</label>`).join("");
  const categoryOptions = context.categories.map((category) => `<label class="admin-multi-option"><input type="checkbox" name="categoryIds" value="${escapeHtml(category.id)}" ${(offer.categoryIds || []).includes(category.id) ? "checked" : ""}>${escapeHtml(category.name)}</label>`).join("");
  const localDate = (value) => value ? new Date(value).toISOString().slice(0, 16) : "";
  return `<label class="admin-field">Offer name<input name="name" required maxlength="120" value="${escapeHtml(offer.name || "")}"></label>
    <label class="admin-field admin-field--wide">Internal description<textarea name="internalDescription" rows="2">${escapeHtml(offer.internalDescription || "")}</textarea></label>
    <label class="admin-field admin-field--wide">Customer-facing message<textarea name="customerMessage" rows="2" maxlength="300" placeholder="Save 20% on selected fragrances">${escapeHtml(offer.customerMessage || "")}</textarea></label>
    <label class="admin-field">Discount type<select name="type"><option value="percentage" ${offer.type !== "fixed" ? "selected" : ""}>Percentage (%)</option><option value="fixed" ${offer.type === "fixed" ? "selected" : ""}>Fixed amount (₹)</option></select></label>
    <label class="admin-field">Discount value<input name="discountValue" type="number" min="0.01" step="0.01" required value="${escapeHtml(offer.discountValue ?? "")}"></label>
    <label class="admin-field">Applies to<select name="scope"><option value="storewide" ${(offer.scope || "storewide") === "storewide" ? "selected" : ""}>Storewide</option><option value="product" ${offer.scope === "product" ? "selected" : ""}>Selected products</option><option value="category" ${offer.scope === "category" ? "selected" : ""}>Selected categories</option></select></label>
    <div class="admin-field admin-field--wide" data-offer-target="product" ${offer.scope === "product" ? "" : "hidden"}><span class="admin-label">Applicable products</span><div class="admin-multi-select">${productOptions || "Create products first."}</div></div>
    <div class="admin-field admin-field--wide" data-offer-target="category" ${offer.scope === "category" ? "" : "hidden"}><span class="admin-label">Applicable categories</span><div class="admin-multi-select">${categoryOptions || "Create categories first."}</div></div>
    <label class="admin-field">Starts at (UTC)<input name="startsAt" type="datetime-local" required value="${escapeHtml(localDate(offer.startsAt))}"></label>
    <label class="admin-field">Ends at (UTC)<input name="endsAt" type="datetime-local" required value="${escapeHtml(localDate(offer.endsAt))}"></label>
    <label class="admin-field">Minimum purchase (₹)<span class="admin-field-help">Optional</span><input name="minPurchase" type="number" min="0" step="0.01" value="${escapeHtml(offer.minPurchase ?? "")}"></label>
    <label class="admin-field">Maximum discount (₹)<span class="admin-field-help">Optional</span><input name="maxDiscount" type="number" min="0" step="0.01" value="${escapeHtml(offer.maxDiscount ?? "")}"></label>
    <label class="admin-field">Priority<select name="priority"><option value="0">Normal</option><option value="10" ${Number(offer.priority) === 10 ? "selected" : ""}>High</option></select></label>
    <label class="admin-field">Status<select name="status">${["draft", "active", "paused"].map((item) => `<option value="${item}" ${(offer.status || "draft") === item ? "selected" : ""}>${item[0].toUpperCase()}${item.slice(1)}</option>`).join("")}</select></label>
    <label class="admin-field">Banner button text<input name="ctaLabel" maxlength="40" value="${escapeHtml(offer.ctaLabel || "Shop now")}"></label>
    <label class="admin-field">Banner destination<input name="ctaUrl" required value="${escapeHtml(offer.ctaUrl || "/perfumes/shop")}"></label>
    <label class="admin-check-field admin-field--wide"><input type="checkbox" name="showBanner" ${offer.showBanner ? "checked" : ""}>Show this offer as a storefront banner</label>`;
}

async function setupCategories(context) {
  const { data, error } = await supabase.from("product_categories").select("*").order("sort_order");
  if (error) throw error;
  context.categories = data;
}

async function setupOffers(context) {
  const { data, error } = await supabase.from("store_offers").select("*").order("starts_at", { ascending: false });
  if (error) throw error;
  const [productsResult, categoriesResult] = await Promise.all([
    supabase.from("store_offer_products").select("offer_id,product_id"),
    supabase.from("store_offer_categories").select("offer_id,category_id"),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  context.rawOffers = data;
  context.offers = data.map((row) => offerFromRow(
    row,
    productsResult.data.filter((item) => item.offer_id === row.id).map((item) => item.product_id),
    categoriesResult.data.filter((item) => item.offer_id === row.id).map((item) => item.category_id),
  ));
}

async function loadOverview(root, context) {
  const [{ data: inventory, error: inventoryError }] = await Promise.all([
    supabase.from("product_inventory").select("product_id,quantity,low_stock_threshold"),
  ]);
  if (inventoryError) throw inventoryError;
  const active = context.products.filter((item) => item.status === "active");
  const getState = (product) => productStockState(product, inventory, context.settings);
  root.querySelector('[data-metric="active"]').textContent = String(active.length);
  root.querySelector('[data-metric="total"]').textContent = String(context.products.length);
  root.querySelector('[data-metric="low"]').textContent = String(context.products.filter((item) => getState(item) === "low").length);
  root.querySelector('[data-metric="out"]').textContent = String(context.products.filter((item) => getState(item) === "out").length);
  const recent = [...context.products].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 5);
  root.querySelector("[data-recent-products]").innerHTML = recent.length ? recent.map((item) => `<a class="admin-recent-product" href="/admin/products/${encodeURIComponent(item.id)}/edit"><img src="${escapeHtml(item.image_url)}" alt=""><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku || item.category)}</small></span><span class="admin-badge admin-badge--${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></a>`).join("") : '<p class="admin-empty-copy">No products yet. Add a perfume to get started.</p>';
  const now = new Date();
  const activeOffers = context.offers.filter((offer) => offer.status === "active" && new Date(offer.startsAt) <= now && new Date(offer.endsAt) > now);
  root.querySelector("[data-current-offers]").innerHTML = activeOffers.length ? activeOffers.slice(0, 4).map((offer) => `<p class="admin-current-offer"><strong>${escapeHtml(offer.name)}</strong><span>${offer.type === "percentage" ? `${offer.discountValue}% off` : `${money(offer.discountValue)} off`} · Ends ${formatDate(offer.endsAt, context.settings.timezone)}</span></p>`).join("") : '<p class="admin-empty-copy">There are no offers active right now.</p>';
  const lowStock = context.products.filter((item) => getState(item) === "low" || getState(item) === "out");
  const lowPanel = root.querySelector(".admin-overview-grid");
  if (lowStock.length) {
    lowPanel.insertAdjacentHTML("beforeend", `<section class="admin-panel admin-low-stock"><div class="admin-panel-heading"><div><span class="eyebrow">REORDER REMINDERS</span><h2>Stock to check</h2></div><a class="text-link" href="/admin/inventory">Inventory ↗</a></div>${lowStock.slice(0, 5).map((item) => {
      const record = inventory.find((entry) => entry.product_id === item.id);
      return `<p class="admin-low-row"><span>${escapeHtml(item.name)}</span><strong>${record?.quantity ?? 0} left</strong></p>`;
    }).join("")}</section>`);
  }
}

async function loadProductList(root, context, page = 1) {
  const [{ data: inventory, error: inventoryError }] = await Promise.all([
    supabase.from("product_inventory").select("product_id,quantity,low_stock_threshold"),
  ]);
  if (inventoryError) throw inventoryError;
  const search = root.querySelector("[data-product-search]").value.trim().toLowerCase();
  const statusFilter = root.querySelector("[data-product-status]").value;
  const stockFilter = root.querySelector("[data-product-stock]").value;
  const sorting = root.querySelector("[data-product-sort]").value;
  let filtered = context.products.filter((item) => {
    const searchable = `${item.name} ${item.sku || ""} ${item.category}`.toLowerCase();
    const state = productStockState(item, inventory, context.settings);
    return searchable.includes(search)
      && (statusFilter === "all" || item.status === statusFilter)
      && (stockFilter === "all" || state === stockFilter);
  });
  filtered.sort((a, b) => {
    if (sorting === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (sorting === "name") return a.name.localeCompare(b.name);
    if (sorting === "price-low") return (a.sale_price ?? a.price ?? Infinity) - (b.sale_price ?? b.price ?? Infinity);
    if (sorting === "price-high") return (b.sale_price ?? b.price ?? -Infinity) - (a.sale_price ?? a.price ?? -Infinity);
    if (sorting === "stock") return (inventory.find((i) => i.product_id === a.id)?.quantity ?? Infinity) - (inventory.find((i) => i.product_id === b.id)?.quantity ?? Infinity);
    return new Date(b.created_at) - new Date(a.created_at);
  });
  const size = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const activePage = Math.min(page, totalPages);
  const shown = filtered.slice((activePage - 1) * size, activePage * size);
  root.querySelector("[data-product-rows]").innerHTML = shown.length
    ? shown.map((item) => productRowHtml(item, inventory, context.settings)).join("")
    : '<tr><td colspan="8" class="admin-empty-cell">No matching products. Adjust your filters or create a product.</td></tr>';
  root.querySelector("[data-mobile-product-rows]").innerHTML = shown.map((item) => mobileProductHtml(item, inventory, context.settings)).join("");
  root.querySelector("[data-product-count]").textContent = `Showing ${shown.length ? (activePage - 1) * size + 1 : 0}–${Math.min(activePage * size, filtered.length)} of ${filtered.length}`;
  root.querySelector("[data-page-label]").textContent = `${activePage} / ${totalPages}`;
  root.querySelector("[data-page-prev]").disabled = activePage <= 1;
  root.querySelector("[data-page-next]").disabled = activePage >= totalPages;
  root.dataset.productPage = String(activePage);
}

async function loadCategories(root, context) {
  const { data: counts, error: countError } = await supabase.from("products").select("category");
  if (countError) throw countError;
  const container = root.querySelector("[data-category-rows]");
  container.innerHTML = context.categories.length ? context.categories.map((category) => {
    const count = counts.filter((row) => row.category.toLowerCase() === category.name.toLowerCase()).length;
    return `<article class="admin-category-row"><div><strong>${escapeHtml(category.name)}</strong><span>/${escapeHtml(category.slug)} · ${count} ${count === 1 ? "product" : "products"}</span><small>${escapeHtml(category.description || "No description")}</small></div><label class="admin-category-visible"><input type="checkbox" data-category-active="${category.id}" ${category.active ? "checked" : ""}>Visible</label><div class="admin-row-actions"><button type="button" data-category-edit="${category.id}">Edit</button><button type="button" data-category-delete="${category.id}" ${count ? "disabled title='Reassign products first'" : ""}>Delete</button></div></article>`;
  }).join("") : '<p class="admin-empty-copy">No categories yet. Add real product families using the form.</p>';
}

async function loadInventory(root, context) {
  const [inventoryResult, historyResult] = await Promise.all([
    supabase.from("product_inventory").select("*").order("updated_at", { ascending: false }),
    supabase.from("inventory_movements").select("*").order("created_at", { ascending: false }).limit(30),
  ]);
  if (inventoryResult.error) throw inventoryResult.error;
  if (historyResult.error) throw historyResult.error;
  const tracked = inventoryResult.data.filter((item) => item.quantity !== null);
  const low = tracked.filter((item) => item.quantity > 0 && item.quantity <= item.low_stock_threshold);
  const out = tracked.filter((item) => item.quantity === 0);
  const untracked = inventoryResult.data.length - tracked.length;
  root.querySelector('[data-inventory-metric="tracked"]').textContent = String(tracked.length);
  root.querySelector('[data-inventory-metric="low"]').textContent = String(low.length);
  root.querySelector('[data-inventory-metric="out"]').textContent = String(out.length);
  root.querySelector('[data-inventory-metric="untracked"]').textContent = String(untracked);
  const render = (item, mobile = false) => {
    const product = context.products.find((entry) => entry.id === item.product_id);
    if (!product) return "";
    const state = item.quantity == null ? "Not tracked" : item.quantity === 0 ? "Out of stock" : item.quantity <= item.low_stock_threshold ? "Low stock" : "In stock";
    const outOfStockAction = item.quantity === 0
      ? '<span class="admin-stock-status admin-stock-status--out">Out of stock</span>'
      : `<button class="text-link" type="button" data-mark-out-of-stock="${escapeHtml(product.id)}">Mark out of stock</button>`;
    if (mobile) return `<article class="admin-mobile-card"><img src="${escapeHtml(product.image_url)}" alt=""><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.sku || "No SKU")}</span><span>Quantity: ${item.quantity ?? "Not tracked"} · Threshold: ${item.low_stock_threshold}</span><span>${state}</span><button class="button button--quiet" type="button" data-stock-adjust="${escapeHtml(product.id)}">Adjust stock</button>${outOfStockAction}</div></article>`;
    return `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.sku || "—")}</td><td><strong>${item.quantity ?? "Not tracked"}</strong></td><td>${item.low_stock_threshold}</td><td>${item.quantity === 0 ? "Currently unavailable" : product.availability || "Available"}</td><td><span class="admin-stock-status admin-stock-status--${item.quantity == null ? "unknown" : item.quantity === 0 ? "out" : item.quantity <= item.low_stock_threshold ? "low" : "in"}">${state}</span></td><td><div class="admin-row-actions"><button class="text-link" type="button" data-stock-adjust="${escapeHtml(product.id)}">Adjust</button>${outOfStockAction}</div></td></tr>`;
  };
  root.querySelector("[data-inventory-rows]").innerHTML = inventoryResult.data.map((item) => render(item)).join("");
  root.querySelector("[data-inventory-mobile]").innerHTML = inventoryResult.data.map((item) => render(item, true)).join("");
  const productName = (id) => context.products.find((item) => item.id === id)?.name || "Removed product";
  root.querySelector("[data-inventory-history]").innerHTML = historyResult.data.length
    ? historyResult.data.map((item) => `<tr><td>${escapeHtml(productName(item.product_id))}</td><td>${item.adjustment > 0 ? "+" : ""}${item.adjustment}</td><td>${item.new_quantity}</td><td>${escapeHtml(item.reason)}</td><td>${formatDate(item.created_at, context.settings.timezone)}</td></tr>`).join("")
    : '<tr><td colspan="5" class="admin-empty-cell">Inventory adjustments will appear here.</td></tr>';
}

async function renderOffers(root, context, editId = null) {
  await setupOffers(context);
  if (editId || context.editingOffer || window.location.pathname === "/admin/offers/new") {
    const offer = editId
      ? context.offers.find((item) => item.id === editId)
      : context.editingOffer || null;
    const target = root.querySelector("[data-offer-form-fields]");
    if (target) {
      target.innerHTML = offerEditorFields(offer || {}, context);
      root.querySelector("[data-offer-editor]").dataset.offerId = editId || "";
    }
    const banners = context.offers.filter((item) => item.showBanner && getOfferStatus(item) === "active");
    const preview = root.querySelector("[data-banner-preview]");
    if (preview) {
      preview.hidden = !banners.length;
      root.querySelector("[data-banner-preview-content]").textContent = banners[0]?.customerMessage || "No current public announcement.";
    }
    return;
  }
  const rows = context.offers.map((offer) => {
    const record = context.rawOffers.find((item) => item.id === offer.id);
    const state = getOfferStatus(offer);
    return { offer, state, applies: offerDescription(record, offer.productIds, offer.categoryIds, context.products.map(productFromRow), context.categories) };
  });
  const filtered = rows.filter(({ offer, state }) => {
    const query = root.querySelector("[data-offer-search]").value.toLowerCase();
    const filter = root.querySelector("[data-offer-status]").value;
    return `${offer.name} ${offer.customerMessage}`.toLowerCase().includes(query) && (filter === "all" || state === filter);
  });
  const rowHtml = ({ offer, state, applies }) => `<tr><td><strong>${escapeHtml(offer.name)}</strong><small>${escapeHtml(offer.customerMessage || offer.internalDescription)}</small></td><td>${offer.type === "percentage" ? `${offer.discountValue}%` : money(offer.discountValue)} off</td><td>${escapeHtml(applies)}</td><td>${formatDate(offer.startsAt, context.settings.timezone)}<small>to ${formatDate(offer.endsAt, context.settings.timezone)}</small></td><td><span class="admin-badge admin-badge--${state}">${state}</span></td><td>${offer.showBanner ? "Enabled" : "—"}</td><td><div class="admin-row-actions"><a href="/admin/offers/${offer.id}/edit">Edit</a>${state === "paused" || state === "draft" || state === "scheduled" ? `<button type="button" data-offer-state="active" data-offer-id="${offer.id}">Activate</button>` : `<button type="button" data-offer-state="paused" data-offer-id="${offer.id}">Pause</button>`}<button type="button" data-offer-delete="${offer.id}">Delete</button></div></td></tr>`;
  root.querySelector("[data-offer-rows]").innerHTML = filtered.length
    ? filtered.map(rowHtml).join("")
    : '<tr><td colspan="7" class="admin-empty-cell">No offers match this filter.</td></tr>';
  root.querySelector("[data-offer-mobile]").innerHTML = filtered.map(({ offer, state }) => `<article class="admin-mobile-card"><div><strong>${escapeHtml(offer.name)}</strong><span>${offer.type === "percentage" ? `${offer.discountValue}%` : money(offer.discountValue)} off · ${state}</span><span>${formatDate(offer.startsAt, context.settings.timezone)} – ${formatDate(offer.endsAt, context.settings.timezone)}</span><div class="admin-row-actions"><a href="/admin/offers/${offer.id}/edit">Edit</a><button type="button" data-offer-state="${state === "active" ? "paused" : "active"}" data-offer-id="${offer.id}">${state === "active" ? "Pause" : "Activate"}</button></div></div></article>`).join("");
  const activeBanners = filtered.filter(({ offer, state }) => offer.showBanner && state === "active");
  root.querySelector("[data-banner-preview]").hidden = activeBanners.length === 0;
  root.querySelector("[data-banner-preview-content]").textContent = activeBanners[0]?.offer.customerMessage || "";
}

function settingsField(name, label, type, value, wide = false) {
  return type === "textarea"
    ? `<label class="admin-field ${wide ? "admin-field--wide" : ""}">${label}<textarea name="${name}" rows="3">${escapeHtml(value ?? "")}</textarea></label>`
    : `<label class="admin-field ${wide ? "admin-field--wide" : ""}">${label}<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" ${name === "whatsapp" ? 'inputmode="numeric" pattern="[0-9]{8,15}"' : ""} required></label>`;
}

async function hydratePage(root, context, active, current) {
  if (active === "/admin") {
    await setupOffers(context);
    return loadOverview(root, context);
  }
  if (active === "/admin/products" && current === "/admin/products") {
    const productStatus = root.querySelector("[data-product-status]");
    const stock = root.querySelector("[data-product-stock]");
    const sort = root.querySelector("[data-product-sort]");
    const search = root.querySelector("[data-product-search]");
    const reload = () => loadProductList(root, context, 1).catch((error) => status(root, error.message, true));
    for (const control of [productStatus, stock, sort, search]) {
      control.addEventListener(control === search ? "input" : "change", reload);
    }
    root.querySelector("[data-page-prev]").addEventListener("click", () => loadProductList(root, context, Number(root.dataset.productPage) - 1));
    root.querySelector("[data-page-next]").addEventListener("click", () => loadProductList(root, context, Number(root.dataset.productPage) + 1));
    return loadProductList(root, context);
  }
  if (current === "/admin/products/new" || current.startsWith("/admin/products/") && current.endsWith("/edit")) {
    await setupCategories(context);
    const editing = current !== "/admin/products/new";
    const id = editing ? current.split("/")[3] : null;
    const product = id ? context.products.find((item) => item.id === id) : null;
    if (id && !product) {
      drawError(root, "That product does not exist, or it has been removed.");
      return;
    }
    const productData = product ? productFromRow(product) : {};
    const initial = {
      ...productData,
      category: productData.category,
      imageGallery: (productData.images || []).slice(1).join("\n"),
      notes: (productData.notes || []).join(", "),
      ingredients: (productData.ingredients || []).join(", "),
      categories: context.categories,
      featured: productData.featured ?? false,
      isNewArrival: productData.isNewArrival ?? false,
    };
    root.querySelector("[data-product-form-fields]").innerHTML = productFields.map((field) => fieldControl(field, initial)).join("");
    const form = root.querySelector("[data-product-editor]");
    form.dataset.productId = id || "";
    const mainFileInput = form.querySelector("[data-product-main-file]");
    const selectedMainPreview = form.querySelector("[data-selected-main-preview]");
    const galleryFileInput = form.querySelector("[data-product-gallery-files]");
    const selectedGalleryPreview = form.querySelector("[data-selected-gallery-preview]");
    let mainPreviewUrl = "";
    let galleryPreviewUrls = [];
    mainFileInput.addEventListener("change", () => {
      const [file] = mainFileInput.files;
      if (mainPreviewUrl) URL.revokeObjectURL(mainPreviewUrl);
      selectedMainPreview.replaceChildren();
      selectedMainPreview.hidden = !file;
      if (file) {
        const image = document.createElement("img");
        mainPreviewUrl = URL.createObjectURL(file);
        image.src = mainPreviewUrl;
        image.alt = "Selected main product photo";
        selectedMainPreview.append(image);
      }
    });
    galleryFileInput.addEventListener("change", () => {
      for (const previewUrl of galleryPreviewUrls) URL.revokeObjectURL(previewUrl);
      galleryPreviewUrls = [];
      selectedGalleryPreview.replaceChildren();
      const files = [...galleryFileInput.files];
      selectedGalleryPreview.hidden = files.length === 0;
      for (const file of files) {
        const image = document.createElement("img");
        const previewUrl = URL.createObjectURL(file);
        galleryPreviewUrls.push(previewUrl);
        image.src = previewUrl;
        image.alt = `Selected photo: ${file.name}`;
        selectedGalleryPreview.append(image);
      }
    });
    const currentFormState = () => JSON.stringify([
      [...new FormData(form).entries()],
      [...mainFileInput.files, ...galleryFileInput.files].map(({ name, size, lastModified }) => [name, size, lastModified]),
    ]);
    const original = currentFormState();
    window.addEventListener("beforeunload", (event) => {
      if (!form.dataset.saving && currentFormState() !== original) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    return;
  }
  if (active === "/admin/categories") {
    await setupCategories(context);
    return loadCategories(root, context);
  }
  if (active === "/admin/inventory") return loadInventory(root, context);
  if (active === "/admin/offers" || active.startsWith("/admin/offers/")) return renderOffers(root, context);
  if (active === "/admin/settings") {
    const { data, error } = await supabase.from("store_settings").select("*").eq("id", 1).single();
    if (error) throw error;
    context.settings = data;
    root.querySelector("[data-settings-fields]").innerHTML = [
      settingsField("store_name", "Store name", "text", data.store_name),
      settingsField("logo_url", "Logo URL", "url", data.logo_url),
      settingsField("description", "Store description", "textarea", data.description, true),
      settingsField("whatsapp", "WhatsApp number · country code + digits", "tel", data.whatsapp),
      settingsField("email", "Contact email", "email", data.email),
      settingsField("phone", "Contact phone", "tel", data.phone),
      settingsField("instagram", "Instagram URL", "url", data.instagram),
      settingsField("location", "Store location", "text", data.location),
      settingsField("currency", "Currency code", "text", data.currency),
      settingsField("low_stock_threshold", "Default low-stock threshold", "number", data.low_stock_threshold),
      settingsField("shipping_message", "Default delivery message", "textarea", data.shipping_message, true),
      `<label class="admin-field">Admin timezone<select name="timezone">${["Asia/Kolkata", "UTC", "Europe/London", "America/New_York", "Australia/Sydney"].map((zone) => `<option ${data.timezone === zone ? "selected" : ""}>${zone}</option>`).join("")}</select></label>`,
    ].join("");
    return;
  }
  if (active === "/admin/orders") return;
  if (active === "/admin/analytics") return;
}

function getActivePath(current) {
  if (current.startsWith("/admin/products/")) {
    return current === "/admin/products/new" ? current : "/admin/products";
  }
  if (current.startsWith("/admin/offers/")) return "/admin/offers";
  return current;
}

function pageTitle(active, current) {
  if (current === "/admin/products/new") return "Create product";
  if (current.startsWith("/admin/products/") && current.endsWith("/edit")) return "Edit product";
  if (current === "/admin/offers/new") return "Create offer";
  if (current.startsWith("/admin/offers/") && current.endsWith("/edit")) return "Edit offer";
  return ({
    "/admin": "Overview",
    "/admin/products": "Products",
    "/admin/categories": "Categories",
    "/admin/inventory": "Inventory",
    "/admin/offers": "Offers & banners",
    "/admin/orders": "Orders",
    "/admin/analytics": "Analytics",
    "/admin/settings": "Store settings",
  })[active] || "Overview";
}

export async function renderAdmin(root, currentPath = window.location.pathname) {
  if (!supabase) {
    drawSetup(root);
    return;
  }
  if (root.dataset.adminInitialized !== "true") {
    root.dataset.adminInitialized = "true";
    root.addEventListener("submit", async (event) => {
      const loginForm = event.target.closest("[data-admin-login]");
      if (!loginForm) return;
      event.preventDefault();
      const button = loginForm.querySelector("[type=submit]");
      button.disabled = true;
      const values = new FormData(loginForm);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.get("email"),
        password: values.get("password"),
      });
      button.disabled = false;
      if (error) return status(root, error.message, true);
      if (data.session?.user?.app_metadata?.role !== "admin") {
        await supabase.auth.signOut();
        return status(root, "This account is not assigned the administrator role.", true);
      }
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    root.addEventListener("submit", handleAdminSubmit);
    root.addEventListener("click", handleAdminClick);
    root.addEventListener("change", handleAdminChange);
  }
  drawLoading(root, "Checking administrator session…");
  const { data, error } = await supabase.auth.getSession();
  if (error) return drawError(root, error.message);
  if (!data.session) {
    root.innerHTML = `<main class="admin-login-wrap"><section class="admin-login"><a class="admin-store-link" href="/perfumes">← ShaaFragrance</a><span class="eyebrow">SECURE ADMINISTRATION</span><h1>Welcome <em>back.</em></h1><p>Sign in with the administrator account for this store.</p><form class="admin-stacked-form" data-admin-login><label>Email address<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button button--dark" type="submit">Sign in ↗</button><p class="admin-message" data-admin-message role="status" aria-live="polite"></p></form></section></main>`;
    return;
  }
  if (data.session.user.app_metadata?.role !== "admin") {
    root.innerHTML = `<main class="admin-login-wrap"><section class="admin-login"><span class="eyebrow">ACCESS RESTRICTED</span><h1>Admin access<br><em>required.</em></h1><p>This signed-in account does not have the trusted administrator role.</p><button class="button button--dark" type="button" data-admin-signout>Sign out</button></section></main>`;
    return;
  }
  const current = currentPath.replace(/\/+$/, "") || "/";
  const active = getActivePath(current);
  const title = pageTitle(active, current);
  const context = { products: [], categories: [], offers: [], rawOffers: [], settings: { ...defaultSettingValues }, timezone: defaultSettingValues.timezone };
  adminShell(root, { page: title, session: data.session, active });
  if (active !== "/admin/offers" && !active.startsWith("/admin/offers/")) {
    const [{ data: products, error: productError }, { data: settings, error: settingsError }] = await Promise.all([
      supabase.from("products").select("*").order("updated_at", { ascending: false }),
      supabase.from("store_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (productError) return drawError(root, productError.message);
    if (settingsError) return drawError(root, settingsError.message);
    context.products = products;
    context.settings = settings || defaultSettingValues;
    context.timezone = context.settings.timezone;
  }
  if (active === "/admin/offers") {
    const [offersResult, productsResult, settingsResult, categoriesResult] = await Promise.all([
      supabase.from("store_offers").select("*").order("starts_at", { ascending: false }),
      supabase.from("products").select("*"),
      supabase.from("store_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("product_categories").select("*").order("sort_order"),
    ]);
    for (const result of [offersResult, productsResult, settingsResult, categoriesResult]) {
      if (result.error) return drawError(root, result.error.message);
    }
    context.rawOffers = offersResult.data;
    context.products = productsResult.data;
    context.categories = categoriesResult.data;
    context.settings = settingsResult.data || defaultSettingValues;
    context.timezone = context.settings.timezone;
  } else {
    const categoriesResult = await supabase.from("product_categories").select("*").order("sort_order");
    if (categoriesResult.error) return drawError(root, categoriesResult.error.message);
    context.categories = categoriesResult.data;
  }
  if (current === "/admin/products/new") {
    const editor = root.querySelector("[data-product-editor]");
    editor?.setAttribute("data-editor-current", "new");
  } else if (current.startsWith("/admin/products/") && current.endsWith("/edit")) {
    const id = current.split("/")[3];
    const editor = root.querySelector("[data-product-editor]");
    editor?.setAttribute("data-product-id", id);
    if (!context.products.some((product) => product.id === id)) return drawError(root, "Product not found.");
  }
  if (active.startsWith("/admin/offers/") && current !== "/admin/offers/new" && current.endsWith("/edit")) {
    const id = current.split("/")[3];
    const offersResult = await supabase.from("store_offers").select("*");
    if (offersResult.error) return drawError(root, offersResult.error.message);
    context.rawOffers = offersResult.data;
    const offerProducts = await supabase.from("store_offer_products").select("*");
    const offerCategories = await supabase.from("store_offer_categories").select("*");
    if (offerProducts.error) return drawError(root, offerProducts.error.message);
    if (offerCategories.error) return drawError(root, offerCategories.error.message);
    context.offers = context.rawOffers.map((offer) => offerFromRow(
      offer,
      offerProducts.data.filter((item) => item.offer_id === offer.id).map((item) => item.product_id),
      offerCategories.data.filter((item) => item.offer_id === offer.id).map((item) => item.category_id),
    ));
    context.editingOffer = context.offers.find((offer) => offer.id === id);
    if (!context.editingOffer) return drawError(root, "Offer not found.");
  }
  root._adminContext = context;
  root._adminCurrent = current;
  try {
    await hydratePage(root, context, active, current);
    const createdProduct = new URLSearchParams(window.location.search).get("created");
    if (active === "/admin/products" && createdProduct) {
      showAdminToast(root, `“${createdProduct}” was added successfully.`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  } catch (loadError) {
    drawError(root, loadError.message);
  }
}

async function handleAdminSubmit(event) {
  const root = event.currentTarget;
  const context = root._adminContext;
  if (!context) return;
  const productForm = event.target.closest("[data-product-editor]");
  if (productForm) {
    event.preventDefault();
    if (!productForm.reportValidity()) return;
    const button = productForm.querySelector('[type="submit"]');
    button.disabled = true;
    productForm.dataset.saving = "true";
    const original = context.products.find((item) => item.id === productForm.dataset.productId);
    const uploadedPaths = [];
    try {
      const mainFile = productForm.querySelector("[data-product-main-file]").files[0];
      const galleryFiles = [...productForm.querySelector("[data-product-gallery-files]").files];
      const { product } = collectProductForm(productForm, context.categories, original, Boolean(mainFile));
      const feedback = productForm.querySelector("[data-form-feedback]");
      feedback.textContent = "";
      feedback.classList.remove("is-error");
      if (mainFile) {
        const uploaded = await uploadProductImage(mainFile, product.name);
        uploadedPaths.push(uploaded.path);
        product.image = uploaded.url;
        product.images[0] = uploaded.url;
      }
      for (const file of galleryFiles) {
        const uploaded = await uploadProductImage(file, product.name);
        uploadedPaths.push(uploaded.path);
        product.images.push(uploaded.url);
      }
      const row = productToRow(product);
      row.category_id = undefined;
      let result;
      if (original) result = await supabase.from("products").update(row).eq("id", original.id);
      else result = await supabase.from("products").insert(row);
      if (result.error) throw result.error;
      window.dispatchEvent(new Event("products-updated"));
      const destination = original
        ? "/admin/products"
        : `/admin/products?created=${encodeURIComponent(product.name)}`;
      window.location.assign(destination);
    } catch (error) {
      let messageText = productSaveError(error);
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage.from("product-images").remove(uploadedPaths);
        if (cleanupError) messageText += ` Image cleanup also failed: ${cleanupError.message}`;
      }
      productForm.dataset.saving = "";
      const message = productForm.querySelector("[data-form-feedback]");
      message.textContent = messageText;
      message.classList.add("is-error");
      button.disabled = false;
    }
    return;
  }
  const offerForm = event.target.closest("[data-offer-editor]");
  if (offerForm) {
    event.preventDefault();
    if (!offerForm.reportValidity()) return;
    const button = offerForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const values = new FormData(offerForm);
      const startsAt = new Date(`${String(values.get("startsAt"))}:00Z`);
      const endsAt = new Date(`${String(values.get("endsAt"))}:00Z`);
      const value = Number(values.get("discountValue"));
      if (endsAt <= startsAt) throw new Error("The end date must be after the start date.");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Discount value must be greater than zero.");
      if (values.get("type") === "percentage" && value > 100) throw new Error("Percentage discounts cannot exceed 100%.");
      const scope = String(values.get("scope"));
      const productIds = values.getAll("productIds").map(String);
      const categoryIds = values.getAll("categoryIds").map(String);
      const ctaUrl = String(values.get("ctaUrl") || "/perfumes/shop").trim();
      if (scope === "product" && !productIds.length) throw new Error("Select at least one product for this offer.");
      if (scope === "category" && !categoryIds.length) throw new Error("Select at least one category for this offer.");
      if (!ctaUrl.startsWith("/") || ctaUrl.startsWith("//")) {
        let destination;
        try {
          destination = new URL(ctaUrl);
        } catch {
          throw new Error("Use a site-relative path or a secure https:// banner destination.");
        }
        if (destination.protocol !== "https:") throw new Error("Use a site-relative path or a secure https:// banner destination.");
      }
      const id = offerForm.dataset.offerId || null;
      const offer = {
        ...(id ? { id } : {}),
        name: String(values.get("name")).trim(),
        internalDescription: String(values.get("internalDescription") || "").trim(),
        customerMessage: String(values.get("customerMessage") || "").trim(),
        type: String(values.get("type")),
        discountValue: value,
        scope,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        minPurchase: values.get("minPurchase") === "" ? null : Number(values.get("minPurchase")),
        maxDiscount: values.get("maxDiscount") === "" ? null : Number(values.get("maxDiscount")),
        status: String(values.get("status")),
        priority: Number(values.get("priority")),
        showBanner: values.has("showBanner"),
        ctaLabel: String(values.get("ctaLabel") || "Shop now"),
        ctaUrl,
      };
      if (offer.minPurchase !== null && (!Number.isFinite(offer.minPurchase) || offer.minPurchase < 0)) throw new Error("Minimum purchase must be zero or more.");
      if (offer.maxDiscount !== null && (!Number.isFinite(offer.maxDiscount) || offer.maxDiscount < 0)) throw new Error("Maximum discount must be zero or more.");
      const { error } = await supabase.rpc("admin_save_store_offer", {
        p_offer: { ...(id ? { id } : {}), ...offerToRow(offer) },
        p_product_ids: productIds,
        p_category_ids: categoryIds,
      });
      if (error) throw error;
      window.dispatchEvent(new Event("offers-updated"));
      window.location.assign("/admin/offers");
    } catch (error) {
      const feedback = offerForm.querySelector("[data-form-feedback]");
      feedback.textContent = error.message;
      feedback.classList.add("is-error");
      button.disabled = false;
    }
    return;
  }
  const categoryForm = event.target.closest("[data-category-create]");
  if (categoryForm) {
    event.preventDefault();
    const values = new FormData(categoryForm);
    const name = String(values.get("name")).trim();
    const slug = String(values.get("slug") || slugValue(name)).trim();
    const { error } = await supabase.from("product_categories").insert({
      name, slug, description: String(values.get("description") || "").trim(),
      image_url: String(values.get("image_url") || "").trim(), sort_order: context.categories.length,
    });
    if (error) return formFeedback(categoryForm, error.message);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  const settingsForm = event.target.closest("[data-settings-form]");
  if (settingsForm) {
    event.preventDefault();
    if (!settingsForm.reportValidity()) return;
    const values = new FormData(settingsForm);
    const number = String(values.get("whatsapp") || "");
    if (number && !/^[0-9]{8,15}$/.test(number)) return formFeedback(settingsForm, "Enter a WhatsApp number with country code using digits only.");
    const threshold = Number(values.get("low_stock_threshold"));
    if (!Number.isInteger(threshold) || threshold < 0) return formFeedback(settingsForm, "Low-stock threshold must be a non-negative whole number.");
    const payload = Object.fromEntries(values.entries());
    payload.low_stock_threshold = threshold;
    const { error } = await supabase.from("store_settings").update(payload).eq("id", 1);
    if (error) return formFeedback(settingsForm, error.message);
    window.dispatchEvent(new Event("store-settings-updated"));
    formFeedback(settingsForm, "Settings saved to the shared storefront.");
    window.setTimeout(() => window.location.reload(), 700);
  }
}

function formFeedback(form, message) {
  const target = form.querySelector("[data-form-feedback]");
  if (target) {
    target.textContent = message;
    target.classList.toggle("is-error", !message.includes("saved"));
  }
}

async function adjustStock(root, productId) {
  const context = root._adminContext;
  const product = context.products.find((item) => item.id === productId);
  if (!product) return;
  const adjustmentText = window.prompt(`Enter stock change for ${product.name} (for example +5 or -2):`);
  if (adjustmentText === null) return;
  if (!/^[+-]?\d+$/.test(adjustmentText.trim()) || Number(adjustmentText) === 0) return status(root, "Enter a non-zero whole-number adjustment, such as +5 or -2.", true);
  const reason = window.prompt("Why is stock changing? This is saved to the inventory history.");
  if (reason === null) return;
  if (!reason.trim()) return status(root, "Enter a reason to record this adjustment.", true);
  const { error } = await supabase.rpc("admin_adjust_inventory", {
    p_product_id: productId,
    p_adjustment: Number(adjustmentText),
    p_reason: reason.trim(),
  });
  if (error) return status(root, error.message, true);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function markOutOfStock(root, productId) {
  const product = root._adminContext.products.find((item) => item.id === productId);
  if (!product) return;
  if (!window.confirm(`Mark ${product.name} as out of stock? Its quantity will be set to zero and saved in inventory history.`)) return;
  const { error } = await supabase.rpc("admin_mark_product_out_of_stock", { p_product_id: product.id });
  if (error) {
    const missingFunction = error.code === "PGRST202" || /admin_mark_product_out_of_stock.*(?:not found|schema cache)|could not find the function/i.test(error.message);
    return status(root, missingFunction
      ? "Out-of-stock action needs the latest Supabase migration. Run supabase/migrations/003_admin_mark_out_of_stock.sql in the Supabase SQL Editor, then refresh Admin."
      : error.message, true);
  }
  window.dispatchEvent(new Event("products-updated"));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function handleAdminClick(event) {
  const root = event.currentTarget;
  if (event.target.closest(".admin-mobile-menu")) {
    root.querySelector(".admin-shell")?.classList.toggle("admin-shell--nav-open");
    return;
  }
  if (event.target.closest("[data-admin-signout]")) {
    const { error } = await supabase.auth.signOut();
    if (error) return status(root, error.message, true);
    window.location.assign("/admin");
    return;
  }
  const stock = event.target.closest("[data-stock-adjust]");
  if (stock) return adjustStock(root, stock.dataset.stockAdjust);
  const inventoryOutOfStock = event.target.closest("[data-mark-out-of-stock]");
  if (inventoryOutOfStock) return markOutOfStock(root, inventoryOutOfStock.dataset.markOutOfStock);
  const productAction = event.target.closest("[data-product-action]");
  if (productAction) {
    const product = root._adminContext.products.find((item) => item.id === productAction.dataset.productId);
    if (!product) return;
    const action = productAction.dataset.productAction;
    if (action === "mark-in-stock") {
      return status(root, "Use the Inventory page to add stock and mark this product available.");
    }
    if (action === "mark-out-of-stock") {
      return markOutOfStock(root, product.id);
    }
    const confirmMessage = action === "duplicate"
      ? `Duplicate ${product.name}? A new product draft will be created.`
      : action === "archive"
        ? `Archive ${product.name}? It will disappear from the public storefront.`
        : `Restore ${product.name} as a draft?`;
    if (!window.confirm(confirmMessage)) return;
    if (action === "duplicate") {
      const copy = productFromRow(product);
      copy.id = `${slugify(copy.name)}-copy-${Date.now().toString().slice(-5)}`;
      copy.name = `${copy.name} (copy)`;
      copy.sku = `${copy.sku || "SF"}-COPY-${Date.now().toString().slice(-4)}`;
      copy.status = "draft";
      copy.featured = false;
      const { error } = await supabase.from("products").insert(productToRow(copy));
      if (error) return status(root, error.message, true);
    } else {
      const { error } = await supabase.from("products").update({ status: action === "archive" ? "archived" : "draft", featured: false, archived_at: action === "archive" ? new Date().toISOString() : null }).eq("id", product.id);
      if (error) return status(root, error.message, true);
    }
    window.dispatchEvent(new Event("products-updated"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  const categoryEdit = event.target.closest("[data-category-edit]");
  if (categoryEdit) {
    const item = root._adminContext.categories.find((category) => category.id === categoryEdit.dataset.categoryEdit);
    if (!item) return;
    const newName = window.prompt("Category name:", item.name);
    if (newName === null || !newName.trim()) return;
    const newSlug = slugify(window.prompt("Category URL slug:", item.slug) || item.slug);
    const description = window.prompt("Short category description:", item.description || "");
    if (description === null) return;
    const image = window.prompt("Public category image URL (optional):", item.image_url || "");
    if (image === null) return;
    const { error } = await supabase.rpc("rename_product_category", { p_category_id: item.id, p_new_name: newName.trim() });
    if (error) return status(root, error.message, true);
    const update = await supabase.from("product_categories").update({ slug: newSlug, description: description.trim(), image_url: image.trim() }).eq("id", item.id);
    if (update.error) return status(root, update.error.message, true);
    return window.dispatchEvent(new PopStateEvent("popstate"));
  }
  const categoryDelete = event.target.closest("[data-category-delete]");
  if (categoryDelete) {
    const item = root._adminContext.categories.find((category) => category.id === categoryDelete.dataset.categoryDelete);
    if (!item || !window.confirm(`Delete the unused category "${item.name}"?`)) return;
    const { error } = await supabase.from("product_categories").delete().eq("id", item.id);
    if (error) return status(root, error.message, true);
    return window.dispatchEvent(new PopStateEvent("popstate"));
  }
  const offerAction = event.target.closest("[data-offer-state]");
  if (offerAction) {
    const offer = root._adminContext.offers.find((item) => item.id === offerAction.dataset.offerId);
    if (!offer) {
      const record = root._adminContext.rawOffers.find((item) => item.id === offerAction.dataset.offerId);
      if (!record) return;
      const next = offerAction.dataset.offerState;
      const { error } = await supabase.from("store_offers").update({ status: next }).eq("id", record.id);
      if (error) return status(root, error.message, true);
      return window.dispatchEvent(new PopStateEvent("popstate"));
    }
    const { error } = await supabase.from("store_offers").update({ status: offerAction.dataset.offerState }).eq("id", offer.id);
    if (error) return status(root, error.message, true);
    return window.dispatchEvent(new PopStateEvent("popstate"));
  }
  const offerDelete = event.target.closest("[data-offer-delete]");
  if (offerDelete) {
    const offer = root._adminContext.rawOffers.find((item) => item.id === offerDelete.dataset.offerDelete);
    if (!offer || !window.confirm(`Delete the offer "${offer.name}"?`)) return;
    const { error } = await supabase.from("store_offers").delete().eq("id", offer.id);
    if (error) return status(root, error.message, true);
    return window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

async function handleAdminChange(event) {
  const root = event.currentTarget;
  const category = event.target.closest("[data-category-active]");
  if (category) {
    const { error } = await supabase.from("product_categories").update({ active: category.checked }).eq("id", category.dataset.categoryActive);
    if (error) {
      category.checked = !category.checked;
      return status(root, error.message, true);
    }
  }
  const offerForm = event.target.closest("[data-offer-editor]");
  if (offerForm && event.target.name === "scope") {
    root.querySelector('[data-offer-target="product"]').hidden = event.target.value !== "product";
    root.querySelector('[data-offer-target="category"]').hidden = event.target.value !== "category";
  }
}

export function isCurrentOffer(offer, now = new Date()) {
  return offer.status === "active" && new Date(offer.starts_at || offer.startsAt) <= now && new Date(offer.ends_at || offer.endsAt) > now;
}

export function dashboardOfferDiscount(price, offer, purchaseTotal = price) {
  return calculateDiscount(price, {
    type: offer.offer_type || offer.type,
    discountValue: offer.discount_value ?? offer.discountValue,
    minPurchase: offer.min_purchase ?? offer.minPurchase,
    maxDiscount: offer.max_discount ?? offer.maxDiscount,
  }, purchaseTotal);
}
