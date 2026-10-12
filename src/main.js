import { brand, perfumeBrand, products as sampleProducts } from "./data.js";
import { fetchStorefrontData, configurationError, supabase } from "./store.js";
import { generateWhatsAppOrderMessage, generateWhatsAppUrl } from "./whatsapp.js";
import { getProductPricing } from "./pricing.js";
import "./styles.css";

const app = document.querySelector("#app");
const perfumeLinks = [
  ["/perfumes", "Home"],
  ["/perfumes/shop", "Shop"],
  ["/perfumes/collections", "Collections"],
  ["/perfumes/about", "Our point of view"],
  ["/perfumes/contact", "Contact"],
];
let products = sampleProducts;
let categories = [];
let offers = [];
let storeSettings = null;
let productsLoaded = false;
let productsLoading = false;
let galleryState = { images: [], index: 0, title: "" };
let lightboxOpener = null;
let currentQuantity = 1;
let toastTimer;
let introPlayed = false;

const path = () => window.location.pathname.replace(/\/+$/, "") || "/";
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));
const image = (src, alt, className = "", loading = "lazy") =>
  `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="${loading}" decoding="async" />`;
const arrow = '<span aria-hidden="true">↗</span>';

function setMeta(title, description, imageUrl = "") {
  document.title = title;
  document.querySelector('meta[name="description"]').content = description;
  document.querySelector('meta[property="og:title"]').content = title;
  document.querySelector('meta[property="og:description"]').content = description;
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = `${window.location.origin}${path()}`;
  let ogImage = document.querySelector('meta[property="og:image"]');
  if (!ogImage) {
    ogImage = document.createElement("meta");
    ogImage.setAttribute("property", "og:image");
    document.head.append(ogImage);
  }
  if (imageUrl) ogImage.content = imageUrl;
  else ogImage.removeAttribute("content");
  document.querySelector("#product-structured-data")?.remove();
}

function link(to, label, className = "") {
  return `<a class="${className}" href="${to}">${label}</a>`;
}

function logo(inverse = false) {
  return `<a class="wordmark wordmark--perfume${inverse ? " wordmark--light" : ""}" href="/perfumes" aria-label="${escapeHtml(brand.perfumeName)} home"><img class="wordmark__image wordmark__image--perfume" src="${escapeHtml(perfumeBrand.logo)}" alt=""><span class="wordmark__lockup"><span class="wordmark__name">${escapeHtml(brand.perfumeName)}</span><span class="wordmark__descriptor">Fine fragrance</span></span></a>`;
}

function header() {
  const actionHref = brand.whatsapp
    ? generateWhatsAppUrl(brand.whatsapp, "Hi, I would like to know more about your products.")
    : "/perfumes/contact";
  return `<header class="site-header site-header--scent">
    ${logo()}
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-nav" aria-label="Open navigation"><span></span><span></span></button>
    <nav class="primary-nav" id="primary-nav" aria-label="Main navigation">
      ${perfumeLinks.map(([url, label]) => link(url, label, (path() === url || path() === "/" && url === "/perfumes") ? "is-current" : "")).join("")}
      <a href="${actionHref}" ${brand.whatsapp ? 'target="_blank" rel="noreferrer"' : ""} class="button button--small">${brand.whatsapp ? "WhatsApp" : "Contact us"}</a>
    </nav>
  </header>`;
}

function footer() {
  const contactItems = [];
  if (brand.email && !/@example\./i.test(brand.email)) {
    contactItems.push(`<a href="mailto:${escapeHtml(brand.email)}">${escapeHtml(brand.email)}</a>`);
  }
  const phoneDigits = (brand.phone || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (phoneDigits.length >= 8 && !/^0+$/.test(phoneDigits)) {
    contactItems.push(`<a href="tel:${escapeHtml(brand.phone.replace(/[^\d+]/g, ""))}">${escapeHtml(brand.phone)}</a>`);
  }
  if (brand.location && !/^your city/i.test(brand.location)) {
    contactItems.push(`<span>${escapeHtml(brand.location)}</span>`);
  }
  if (!contactItems.length) {
    contactItems.push(`<p>For fragrance questions, visit our contact page.</p>${link("/perfumes/contact", "Contact us " + arrow)}`);
  }
  return `<footer class="site-footer">
    <div class="footer-main">
      <div class="footer-brand">${logo()}<p>A scent is a memory in the making.</p></div>
      <nav class="footer-links" aria-label="Footer navigation"><span class="eyebrow">Explore</span>${perfumeLinks.map(([url, label]) => link(url, escapeHtml(label))).join("")}</nav>
      <div class="footer-connect"><span class="eyebrow">Stay in the know</span><p>Follow along for new scents and little moments from the house.</p><a href="${escapeHtml(brand.instagram)}" target="_blank" rel="noreferrer">Instagram ${arrow}</a><a class="footer-admin" href="/admin">Admin access ${arrow}</a></div>
      <div class="footer-contact"><span class="eyebrow">Get in touch</span>${contactItems.join("")}</div>
    </div>
    <div class="footer-bottom"><span>© ${new Date().getFullYear()} ${escapeHtml(brand.perfumeName)}</span><span>Made with intention.</span></div>
  </footer>`;
}

function shell(content) {
  app.dataset.section = "perfumes";
  app.innerHTML = `${header()}${activeBanner()}<main id="main-content">${content}</main>${footer()}<div class="toast" role="status" aria-live="polite"></div><div id="dialog-root"></div><div id="transition-root"></div>`;
}

function activeBanner() {
  const offer = offers.find((item) => item.showBanner && isCurrentOffer(item));
  if (!offer?.customerMessage) return "";
  const destination = offer.ctaUrl || "/perfumes/shop";
  const safeDestination = destination.startsWith("/") && !destination.startsWith("//")
    || /^https:\/\//i.test(destination)
    ? destination
    : "/perfumes/shop";
  return `<aside class="store-announcement"><span>${escapeHtml(offer.customerMessage)}</span><a href="${escapeHtml(safeDestination)}">${escapeHtml(offer.ctaLabel || "Shop now")} ↗</a></aside>`;
}

function isCurrentOffer(offer, now = new Date()) {
  return offer.status === "active"
    && new Date(offer.startsAt).getTime() <= now.getTime()
    && new Date(offer.endsAt).getTime() > now.getTime();
}

function displayPrice(pricing, fallbackLabel) {
  if (pricing.regularPrice === null) return escapeHtml(fallbackLabel || "Price to be confirmed");
  if (pricing.discount > 0) return `<span class="price-was">${formatMoney(pricing.regularPrice)}</span><span class="price-now">${formatMoney(pricing.finalPrice)}</span>`;
  return formatMoney(pricing.finalPrice);
}

function formatMoney(amount) {
  const currency = storeSettings?.currency || brand.currency || "INR";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `₹${Number(amount).toLocaleString("en-IN")}`;
  }
}

function perfumeHome() {
  setMeta(`${brand.perfumeName} — Find your own note`, "An independent fragrance collection, presented with care.", products[0]?.image);
  shell(`<section class="scent-hero scent-hero--showcase"><div class="scent-hero__copy"><span class="eyebrow">${escapeHtml(brand.perfumeName)} · Fragrance collection</span><h1>${escapeHtml(perfumeBrand.heroTitle)}<br><em>${escapeHtml(perfumeBrand.heroEmphasis)}</em></h1><p>${escapeHtml(perfumeBrand.description)}</p><div class="button-row">${link("/perfumes/shop", "Explore the collection ↗", "button button--dark")}<button class="text-link whatsapp-trigger" data-order-message="general">Ask us on WhatsApp ↗</button></div><span class="scent-hero__foot">A SIGNATURE SCENT, MADE PERSONAL</span></div><div class="scent-hero__visual">${image("/images/shaafragrance-bottle.jpg", "ShaaFragrance branded perfume bottle", "", "eager")}<span class="scent-hero__seal">SHAA<br>FRAGRANCE</span></div></section>
    <section class="section section--cream scent-featured"><div class="section-heading"><div><span class="eyebrow">The collection</span><h2>Find your <em>note.</em></h2></div>${link("/perfumes/shop", "View all fragrances ↗", "text-link")}</div><div class="product-grid">${products.filter((item) => item.featured).map(productCard).join("")}</div></section>
    <section class="scent-note"><span class="eyebrow">A note from the house</span><p>“A fragrance can make the everyday feel entirely your own.”</p><span>Thoughtfully chosen scents for your own kind of everyday.</span>${link("/perfumes/about", "Our point of view ↗", "text-link")}</section>
    <section class="home-social"><span class="eyebrow">A little more ShaaFragrance</span><h2>Stay close to the <em>scent.</em></h2><p>Follow along for new arrivals, fragrance inspiration, and moments from our house.</p><a class="button button--dark" href="${escapeHtml(brand.instagram)}" target="_blank" rel="noreferrer">Connect with us on Instagram ↗</a></section>`);
  revealHomeProductImages();
}

function revealHomeProductImages() {
  const cards = [...document.querySelectorAll(".scent-featured .product-card")];
  if (!cards.length) return;
  if (!("IntersectionObserver" in window)) {
    cards.forEach((card) => card.classList.add("product-card--revealing"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("product-card--revealing");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.18 });
  cards.forEach((card, index) => {
    card.style.setProperty("--card-index", String(index));
    observer.observe(card);
  });
}

function productCard(product) {
  const id = escapeHtml(product.id);
  const name = escapeHtml(product.name);
  const category = escapeHtml(product.category);
  const size = escapeHtml(product.size);
  const availability = escapeHtml(product.available ? product.availability || "Available" : "Out of stock");
  const pricing = getProductPricing(product, offers);
  return `<a class="product-card" href="/perfumes/product/${encodeURIComponent(product.id)}" aria-label="View ${name}, ${size}">
    <span class="product-card__image">${image(product.image, `Product image for ${name}`)}<span class="product-card__open">View fragrance ↗</span><span class="product-card__badges">${product.isNewArrival ? '<span class="new-arrival-badge">New arrival</span>' : ""}${pricing.discount ? `<span class="offer-badge">${pricing.percentSaved}% off</span>` : ""}${!product.available ? '<span class="stock-badge">Out of stock</span>' : ""}</span></span>
    <span class="product-card__details"><span class="product-card__name">${name}</span><span class="product-card__category">${category} · ${size}</span><span class="product-card__description">${escapeHtml(product.description)}</span><span class="product-card__availability">${availability}</span><span class="product-card__price">${displayPrice(pricing, product.priceLabel)}</span></span>
  </a>`;
}

function shopPage() {
  setMeta(`Fragrances — Shop | ${brand.perfumeName}`, "Browse fragrances by scent family and availability.", products[0]?.image);
  const categoryNames = [...new Set([...categories.filter((item) => item.active !== false).map((item) => item.name), ...products.map((product) => product.category)])];
  const requestedCategory = new URLSearchParams(window.location.search).get("category");
  const activeCategory = categoryNames.includes(requestedCategory) ? requestedCategory : "all";
  shell(`<section class="shop-intro"><span class="eyebrow">The ShaaFragrance collection</span><h1>Find what<br><em>feels like you.</em></h1><p>Explore by scent family and open a fragrance to see its details.</p></section>
    <section class="shop-section"><div class="shop-tools"><label class="search-field"><span>Search the collection</span><input type="search" id="product-search" placeholder="Name, description, notes or family" aria-label="Search products by name, description, notes, or category"><span aria-hidden="true">⌕</span></label><button class="filter-toggle" type="button" aria-expanded="false" aria-controls="product-filters">Filter products</button><div class="shop-filters" id="product-filters"><button class="filter-close" type="button" aria-label="Close product filters">Done</button><label class="select-filter">Family<select id="product-category"><option value="all">All families</option>${categoryNames.map((category) => `<option value="${escapeHtml(category)}" ${category === activeCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label><label class="select-filter">Size<select id="product-size"><option value="all">All sizes</option>${[...new Set(products.map((product) => product.size))].map((size) => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join("")}</select></label><label class="select-filter">Sort<select id="product-sort"><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="new">New arrivals</option></select></label><label class="availability-filter"><input type="checkbox" id="available-only"> Available now</label><label class="price-range"><span>Price range · ₹</span><span><input type="number" min="0" id="product-price-min" placeholder="Min" aria-label="Minimum price"><input type="number" min="0" id="product-price-max" placeholder="Max" aria-label="Maximum price"></span></label></div></div><p class="results-count" id="results-count" aria-live="polite"></p><div class="product-grid" id="product-grid">${products.map(productCard).join("")}</div><div class="empty-results" id="empty-results" hidden>No fragrances found.</div></section>`);
  filterProducts();
}

function collectionsPage() {
  const categoryNames = [...new Set([...categories.filter((item) => item.active !== false).map((item) => item.name), ...products.map((product) => product.category)])];
  setMeta(`Collections — Fragrance | ${brand.perfumeName}`, "Explore available fragrance collections.", products[0]?.image);
  shell(`<section class="shop-intro"><span class="eyebrow">Scent families</span><h1>Explore the<br><em>collections.</em></h1><p>Browse scent families represented in the current catalogue.</p></section><section class="section section--cream collection-grid">${categoryNames.map((category) => {
    const firstProduct = products.find((product) => product.category === category);
    const count = products.filter((product) => product.category === category).length;
    return `<a class="collection-card" href="/perfumes/shop?category=${encodeURIComponent(category)}">${image(firstProduct.image, `${category} fragrance product image`)}<span class="collection-card__meta"><span class="eyebrow">${count} ${count === 1 ? "fragrance" : "fragrances"}</span><strong>${escapeHtml(category)}</strong><span>Explore family ↗</span></span></a>`;
  }).join("")}</section>`);
}

function productPage(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return notFound("Product not found", "/perfumes/shop", "Back to Shop");
  currentQuantity = 1;
  const pricing = getProductPricing(product, offers);
  setMeta(`${product.name} — Fragrance | ${brand.perfumeName}`, product.description, product.image);
  if (product.price !== null) {
    const schema = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description: product.description,
      image: product.images || [product.image],
      offers: { "@type": "Offer", priceCurrency: "INR", price: pricing.finalPrice, availability: product.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
    };
    const script = document.createElement("script");
    script.id = "product-structured-data";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(schema);
    document.head.append(script);
  }
  const images = product.images?.length ? product.images : [product.image];
  const name = escapeHtml(product.name);
  const price = displayPrice(pricing, product.priceLabel);
  galleryState = { images, index: 0, title: product.name };
  shell(`<section class="product-detail"><div class="product-detail__visual"><button class="product-detail__image-button" type="button" data-product-lightbox aria-label="View a larger image of ${name}">${image(images[0], `Product image for ${name}`, "product-main-image", "eager")}</button><span class="product-detail__image-note">VIEW IMAGE ↗</span>${product.isNewArrival ? '<span class="new-arrival-badge new-arrival-badge--detail">New arrival</span>' : ""}${pricing.discount ? `<span class="offer-badge offer-badge--detail">${pricing.percentSaved}% off</span>` : ""}${images.length > 1 ? `<div class="product-detail__thumbs" aria-label="Product images">${images.map((src, index) => `<button class="product-detail__thumb${index === 0 ? " is-active" : ""}" type="button" data-product-image="${index}" aria-label="Show product image ${index + 1}">${image(src, "")}</button>`).join("")}</div>` : ""}</div><div class="product-detail__copy"><span class="eyebrow">${escapeHtml(product.category)} · ${escapeHtml(product.size)}</span><h1>${name}</h1><p class="product-detail__price">${price}</p>${pricing.offer ? `<p class="product-offer-terms">${escapeHtml(pricing.offer.customerMessage)}</p>` : ""}<p class="product-detail__description">${escapeHtml(product.description)}</p>${product.notes?.length ? `<div class="product-notes"><span class="eyebrow">Fragrance notes</span><ul>${product.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div>` : ""}${product.ingredients?.length ? `<div class="product-notes"><span class="eyebrow">Ingredients</span><ul>${product.ingredients.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>` : ""}${product.variants?.length ? `<label class="variant-select">Size / variant<select id="product-variant">${product.variants.map((variant) => `<option value="${escapeHtml(variant.size)}" data-price="${variant.price ?? ""}">${escapeHtml(variant.size)}${variant.price == null ? "" : ` · ${formatMoney(variant.price)}`}</option>`).join("")}</select></label>` : ""}<p class="availability">${escapeHtml(product.available ? product.availability || "Available" : "Out of stock")}</p><div class="quantity-row"><span>Quantity</span><div class="quantity-control"><button type="button" data-quantity="-1" aria-label="Decrease quantity">−</button><output id="quantity-output" aria-live="polite">1</output><button type="button" data-quantity="1" aria-label="Increase quantity">+</button></div></div><button class="button button--dark order-button" data-order-product="${escapeHtml(product.id)}" ${!product.available ? "disabled" : ""}>Order on WhatsApp ↗</button><p class="order-note">${escapeHtml(storeSettings?.shipping_message || "No online payment. We’ll confirm availability and delivery over WhatsApp.")}</p><p class="form-result" aria-live="polite"></p></div></section><section class="section section--cream related-section"><div class="section-heading"><div><span class="eyebrow">Continue exploring</span><h2>More to <em>discover.</em></h2></div>${link("/perfumes/shop", "All fragrances ↗", "text-link")}</div><div class="product-grid">${products.filter((item) => item.id !== product.id).slice(0, 2).map(productCard).join("")}</div></section>`);
}

function perfumeAbout() {
  setMeta(`Our point of view — Fragrance | ${brand.perfumeName}`, "The story behind ShaaFragrance: your scent, your signature, your story.");
  shell(`<section class="scent-about"><div class="scent-about__visual">${image("/images/ourpointofview.png", "ShaaFragrance perfume bottle", "", "eager")}<span class="scent-about__image-caption">SHAAFRAGRANCE <i>·</i> YOUR SIGNATURE</span><span class="scent-about__image-mark" aria-hidden="true">S</span></div><div class="scent-about__copy"><span class="eyebrow">The house · Est. with feeling</span><h1>The Story<br>Behind <em>ShaaFragrance.</em></h1><p class="lead">More than a fragrance.<br><em>A feeling that stays.</em></p><p>Every person has a story. Every memory has a feeling. And sometimes, a single fragrance is enough to bring it all back.</p><a class="scent-about__scroll" href="#our-belief">Discover our point of view <span aria-hidden="true">↓</span></a></div></section>
    <section class="story-content" id="our-belief"><div class="story-content__inner">
      <header class="story-content__intro"><span class="eyebrow">01 / What we believe</span><h2>A scent should feel<br><em>like you.</em></h2><p>ShaaFragrance was created with one simple belief: a fragrance should be more than a scent — it should be a part of who you are.</p></header>
      <div class="story-content__chapters">
        <article class="story-chapter"><span class="story-chapter__number">01</span><div><span class="eyebrow">For the moments</span><h3>Make the ordinary<br>unforgettable.</h3><p>We believe that the right perfume can transform an ordinary moment into something unforgettable. It can give you confidence before an important meeting, add elegance to a special occasion, or leave a beautiful impression long after you've left the room.</p></div></article>
        <article class="story-chapter"><span class="story-chapter__number">02</span><div><span class="eyebrow">For your own story</span><h3>Find the feeling<br>that fits.</h3><p>At ShaaFragrance, we bring you fragrances chosen to complement your personality, match your mood, and make every moment feel special. Whether you prefer something fresh and subtle, warm and captivating, or deep and sophisticated, there's a fragrance waiting to become part of your story.</p></div></article>
      </div>
      <blockquote class="story-quote"><span class="eyebrow">A different kind of luxury</span><p>“It's about how you feel, the confidence you carry, and the memories you leave behind.”</p><cite>The ShaaFragrance point of view</cite></blockquote>
    </div></section>
    <section class="story-ending"><div class="story-ending__inner"><span class="eyebrow">02 / Our vision</span><h2>Make every impression<br><em>unforgettable.</em></h2><p>One fragrance at a time.</p><span class="story-ending__signature">ShaaFragrance <i>—</i> Your scent. Your signature. Your story.</span>${link("/perfumes/shop", "Explore the collection ↗", "button button--dark")}</div></section>`);
}

function contactPage() {
  setMeta(`Contact — Fragrance | ${brand.perfumeName}`, "Get in touch with the ShaaFragrance team.");
  shell(`<section class="page-intro page-intro--scent"><span class="eyebrow">Questions about fragrance</span><h1>We’d love to<br><em>hear from you.</em></h1><p>For product questions and orders, WhatsApp is the quickest route. This demo form does not transmit submissions.</p></section>
    <section class="contact-layout"><div class="contact-details"><span class="eyebrow">A good place to begin</span><a href="mailto:${escapeHtml(brand.email)}">${escapeHtml(brand.email)} ↗</a><span>${escapeHtml(brand.phone)}</span><span>${escapeHtml(brand.location)}</span><a href="${escapeHtml(brand.instagram)}" target="_blank" rel="noreferrer">Instagram ↗</a><button class="text-link whatsapp-trigger" data-order-message="general">Message us on WhatsApp ↗</button></div>
    <form class="contact-form" data-demo-form><div class="form-heading"><span class="eyebrow">The enquiry form</span><h2>Tell us a little.</h2></div><label>Your name<input name="name" autocomplete="name" required placeholder="Name"></label><div class="form-pair"><label>Email address<input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label><label>Phone <span class="optional">(optional)</span><input type="tel" name="phone" autocomplete="tel" placeholder="+91"></label></div><label>Your message<textarea name="message" required rows="4" placeholder="A few details to help us get started..."></textarea></label><button class="button button--dark" type="submit">Send enquiry ↗</button><p class="form-note">Demo only: details are not sent or saved. Connect a form service before going live.</p><p class="form-result" aria-live="polite"></p></form></section>`);
}

function notFound(title = "Page not found", target = "/perfumes", label = "Return to the perfume shop") {
  setMeta(`${title} | ${brand.perfumeName}`, "That page could not be found.");
  shell(`<section class="not-found"><span class="eyebrow">404 · Not found</span><h1>${escapeHtml(title)}</h1><p>We couldn’t find that page. Use the link below to continue browsing.</p>${link(target, `${label} ↗`, "button button--dark")}</section>`);
}

function showProductError(error) {
  app.dataset.section = "perfumes";
  app.innerHTML = `<main class="not-found"><span class="eyebrow">Catalogue unavailable</span><h1>We couldn’t load<br><em>the fragrances.</em></h1><p>${escapeHtml(error.message || "Please check the Supabase connection and products table.")}</p><button class="button button--dark" type="button" data-retry-products>Try again ↗</button></main>`;
}

async function route() {
  const current = path();
  if (current === "/admin" || current.startsWith("/admin/")) {
    app.dataset.section = "admin";
    setMeta(`Admin — ${brand.perfumeName}`, "Private ShaaFragrance product management.");
    app.innerHTML = '<main class="admin-page"><p class="admin-status">Opening secure admin…</p></main>';
    const { renderAdmin } = await import("./admin.js");
    return renderAdmin(app, current);
  }
  if (configurationError) {
    return showProductError(new Error("Set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file."));
  }
  if (supabase && !productsLoaded) {
    if (productsLoading) return;
    productsLoading = true;
    app.dataset.section = "perfumes";
    app.innerHTML = '<main class="not-found"><p>Loading the fragrance collection…</p></main>';
    try {
      const storefront = await fetchStorefrontData();
      products = storefront.products;
      categories = storefront.categories;
      offers = storefront.offers;
      storeSettings = storefront.settings;
      productsLoaded = true;
    } catch (error) {
      productsLoading = false;
      return showProductError(error);
    }
    productsLoading = false;
    return route();
  }
  if (current === "/") {
    perfumeHome();
    playIntroAnimation();
    return;
  }
  if (current === "/perfumes") return perfumeHome();
  if (current === "/perfumes/shop") return shopPage();
  if (current === "/perfumes/collections") return collectionsPage();
  if (current.startsWith("/perfumes/product/")) return productPage(decodeURIComponent(current.split("/").pop()));
  if (current === "/perfumes/about") return perfumeAbout();
  if (current === "/perfumes/contact") return contactPage();
  return notFound();
}

function navigate(url) {
  window.history.pushState({}, "", url);
  route();
  window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

function playIntroAnimation() {
  if (introPlayed || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  introPlayed = true;
  const transitionRoot = document.querySelector("#transition-root") || document.createElement("div");
  transitionRoot.id = "transition-root";
  if (!transitionRoot.isConnected) app.append(transitionRoot);
  transitionRoot.innerHTML = `<div class="experience-transition experience-transition--perfumes" role="status" aria-live="polite">
    <span class="experience-transition__brand">${escapeHtml(brand.perfumeName)}</span>
    <div class="transition-art" aria-hidden="true"><svg class="transition-bottle" viewBox="0 0 140 190" fill="none"><path d="M53 19h34v25H53z" fill="#38382f"/><path d="M47 14h46v9H47z" fill="#978668"/><rect class="transition-bottle__glass" x="25" y="42" width="90" height="133" rx="19" fill="url(#bottle-glass)" stroke="#fffaf0" stroke-width="2"/><path d="M34 53q2-7 10-7v112q-8-4-10-13z" fill="#fff" fill-opacity=".35"/><rect x="38" y="85" width="64" height="48" fill="#eee6d8" fill-opacity=".9"/><path d="M50 101h40" stroke="#827660"/><path d="M57 112h26" stroke="#aaa08e"/><defs><linearGradient id="bottle-glass" x1="25" y1="42" x2="115" y2="175" gradientUnits="userSpaceOnUse"><stop stop-color="#c4a780" stop-opacity=".64"/><stop offset="1" stop-color="#695c48" stop-opacity=".9"/></linearGradient></defs></svg></div>
    <span class="experience-transition__label">Discovering the fragrance collection</span>
    <span class="experience-transition__line"><i></i></span>
  </div>`;
  requestAnimationFrame(() => transitionRoot.querySelector(".experience-transition")?.classList.add("is-active"));
  window.setTimeout(() => {
    const transition = transitionRoot.querySelector(".experience-transition");
    transition?.classList.remove("is-active");
    window.setTimeout(() => transitionRoot.remove(), 260);
  }, 1050);
}

function notify(message) {
  const toast = document.querySelector(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("toast--visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("toast--visible"), 4200);
}

function whatsappUrl(message) {
  const url = generateWhatsAppUrl(brand.whatsapp, message);
  if (!url) notify("Add your WhatsApp number in src/data.js before enabling WhatsApp orders.");
  return url;
}

function openLightbox(index) {
  galleryState.index = index;
  const root = document.querySelector("#dialog-root");
  if (!root) return;
  lightboxOpener = document.activeElement;
  const src = galleryState.images[index];
  root.innerHTML = `<div class="lightbox" role="dialog" aria-modal="true" aria-label="${escapeHtml(galleryState.title)} image gallery"><button class="lightbox__close" data-close-lightbox aria-label="Close gallery">×</button><button class="lightbox__nav lightbox__prev" data-gallery-step="-1" aria-label="Previous image">←</button>${image(src, `${galleryState.title}, image ${index + 1}`, "lightbox__image", "eager")}<button class="lightbox__nav lightbox__next" data-gallery-step="1" aria-label="Next image">→</button><span class="lightbox__counter">${String(index + 1).padStart(2, "0")} / ${String(galleryState.images.length).padStart(2, "0")}</span></div>`;
  root.querySelector(".lightbox__close").focus();
}

function closeLightbox() {
  document.querySelector("#dialog-root").innerHTML = "";
  lightboxOpener?.focus();
  lightboxOpener = null;
}

function updateLightbox(step) {
  const length = galleryState.images.length;
  if (!length) return;
  galleryState.index = (galleryState.index + step + length) % length;
  const dialog = document.querySelector(".lightbox");
  if (!dialog) return;
  dialog.querySelector(".lightbox__image").src = galleryState.images[galleryState.index];
  dialog.querySelector(".lightbox__image").alt = `${galleryState.title}, image ${galleryState.index + 1}`;
  dialog.querySelector(".lightbox__counter").textContent = `${String(galleryState.index + 1).padStart(2, "0")} / ${String(length).padStart(2, "0")}`;
}

function filterProducts() {
  const grid = document.querySelector("#product-grid");
  if (!grid) return;
  const query = (document.querySelector("#product-search")?.value || "").trim().toLowerCase();
  const category = document.querySelector("#product-category")?.value || "all";
  const size = document.querySelector("#product-size")?.value || "all";
  const sort = document.querySelector("#product-sort")?.value || "featured";
  const availableOnly = document.querySelector("#available-only")?.checked || false;
  const minPrice = Number(document.querySelector("#product-price-min")?.value || 0);
  const maxPriceInput = document.querySelector("#product-price-max")?.value || "";
  const maxPrice = maxPriceInput === "" ? Infinity : Number(maxPriceInput);
  const validPriceRange = minPrice <= maxPrice;
  const filtered = products.filter((product) => {
    const searchable = [product.name, product.description, product.category, ...(product.notes || [])].join(" ").toLowerCase();
    const price = getProductPricing(product, offers).finalPrice;
    const inPriceRange = price !== null && price >= minPrice && price <= maxPrice;
    return validPriceRange && searchable.includes(query) && (category === "all" || product.category === category) && (size === "all" || product.size === size) && (!availableOnly || product.available) && (minPrice === 0 && maxPrice === Infinity || inPriceRange);
  });
  if (sort === "low") filtered.sort((a, b) => (getProductPricing(a, offers).finalPrice ?? Infinity) - (getProductPricing(b, offers).finalPrice ?? Infinity));
  if (sort === "high") filtered.sort((a, b) => (getProductPricing(b, offers).finalPrice ?? -Infinity) - (getProductPricing(a, offers).finalPrice ?? -Infinity));
  if (sort === "new") filtered.sort((a, b) => Number(b.isNewArrival) - Number(a.isNewArrival) || (b.arrivalDate || "").localeCompare(a.arrivalDate || ""));
  else if (sort === "featured") filtered.sort((a, b) => Number(b.featured) - Number(a.featured));
  grid.innerHTML = filtered.map(productCard).join("");
  document.querySelector("#results-count").textContent = `${filtered.length} ${filtered.length === 1 ? "fragrance" : "fragrances"}`;
  document.querySelector("#empty-results").hidden = filtered.length !== 0;
}

app.addEventListener("click", (event) => {
  const anchor = event.target.closest("a");
  if (anchor && anchor.origin === window.location.origin && !anchor.hasAttribute("target")) {
    event.preventDefault();
    navigate(`${anchor.pathname}${anchor.search}${anchor.hash}`);
    return;
  }
  if (event.target.closest("[data-retry-products]")) {
    productsLoaded = false;
    productsLoading = false;
    route();
    return;
  }
  const menuButton = event.target.closest(".menu-toggle");
  if (menuButton) {
    const expanded = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!expanded));
    menuButton.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
    document.querySelector(".primary-nav")?.classList.toggle("primary-nav--open", !expanded);
    return;
  }
  const filterToggle = event.target.closest(".filter-toggle");
  if (filterToggle) {
    const expanded = filterToggle.getAttribute("aria-expanded") === "true";
    filterToggle.setAttribute("aria-expanded", String(!expanded));
    document.querySelector("#product-filters")?.classList.toggle("shop-filters--open", !expanded);
    return;
  }
  if (event.target.closest(".filter-close")) {
    document.querySelector(".filter-toggle")?.setAttribute("aria-expanded", "false");
    document.querySelector("#product-filters")?.classList.remove("shop-filters--open");
    return;
  }
  if (event.target.closest("[data-product-lightbox]")) {
    openLightbox(0);
    return;
  }
  if (event.target.closest("[data-close-lightbox]") || event.target.classList.contains("lightbox")) {
    closeLightbox();
    return;
  }
  const step = event.target.closest("[data-gallery-step]");
  if (step) {
    updateLightbox(Number(step.dataset.galleryStep));
    return;
  }
  const quantity = event.target.closest("[data-quantity]");
  if (quantity) {
    currentQuantity = Math.min(20, Math.max(1, currentQuantity + Number(quantity.dataset.quantity)));
    document.querySelector("#quantity-output").textContent = String(currentQuantity);
    return;
  }
  const productImageButton = event.target.closest("[data-product-image]");
  if (productImageButton) {
    const product = products.find((item) => path() === `/perfumes/product/${item.id}`);
    const src = product?.images?.[Number(productImageButton.dataset.productImage)];
    if (src) {
      document.querySelector(".product-main-image").src = src;
      document.querySelectorAll(".product-detail__thumb").forEach((thumbnail) => thumbnail.classList.toggle("is-active", thumbnail === productImageButton));
    }
    return;
  }
  const orderButton = event.target.closest("[data-order-product]");
  if (orderButton) {
    const baseProduct = products.find((item) => item.id === orderButton.dataset.orderProduct);
    if (!baseProduct) return;
    const variant = document.querySelector("#product-variant")?.selectedOptions[0];
    const selectedProduct = variant
      ? { ...baseProduct, size: variant.value, price: variant.dataset.price ? Number(variant.dataset.price) : baseProduct.price, salePrice: null }
      : baseProduct;
    const price = getProductPricing(selectedProduct, offers).finalPrice;
    const product = price === null ? selectedProduct : { ...selectedProduct, price, salePrice: null };
    const message = generateWhatsAppOrderMessage(product, currentQuantity);
    const url = whatsappUrl(message);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const generalOrder = event.target.closest("[data-order-message]");
  if (generalOrder) {
    const url = whatsappUrl("Hi, I would like to know more about your products.");
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".shop-filters, .filter-toggle")) return;
  document.querySelector(".filter-toggle")?.setAttribute("aria-expanded", "false");
  document.querySelector("#product-filters")?.classList.remove("shop-filters--open");
});

app.addEventListener("input", (event) => {
  if (event.target.matches("#product-search, #product-price-min, #product-price-max")) filterProducts();
});
app.addEventListener("change", (event) => {
  if (event.target.matches("#product-category, #product-size, #product-sort, #available-only, #product-price-min, #product-price-max")) filterProducts();
  if (event.target.matches("#product-variant")) {
    const product = products.find((item) => path() === `/perfumes/product/${item.id}`);
    const variant = event.target.selectedOptions[0];
    if (product) {
      const price = variant.dataset.price ? Number(variant.dataset.price) : product.price;
      const variantPricing = getProductPricing({ ...product, price, salePrice: null }, offers);
      document.querySelector(".product-detail__price").innerHTML = displayPrice(variantPricing, product.priceLabel);
    }
  }
});
app.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-demo-form]");
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  form.querySelector(".form-result").textContent = "Thanks for trying the form. This is a preview—your enquiry has not been sent. Connect a form service before publishing.";
  form.reset();
});

app.addEventListener("error", (event) => {
  const failedImage = event.target;
  if (!(failedImage instanceof HTMLImageElement) || failedImage.dataset.failed) return;
  failedImage.dataset.failed = "true";
  const fallback = document.createElement("span");
  fallback.className = `${failedImage.className} image-error-state`;
  fallback.setAttribute("role", "img");
  fallback.setAttribute("aria-label", `Image unavailable: ${failedImage.alt}`);
  fallback.textContent = "Image unavailable";
  failedImage.replaceWith(fallback);
}, true);

window.addEventListener("products-updated", () => {
  productsLoaded = false;
  if (path() !== "/admin" && !path().startsWith("/admin/")) route();
});
window.addEventListener("popstate", route);
window.addEventListener("keydown", (event) => {
  const dialog = document.querySelector(".lightbox");
  if (event.key === "Escape" && dialog) closeLightbox();
  if (dialog && event.key === "Tab") {
    const controls = [...dialog.querySelectorAll("button")];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (dialog && event.key === "ArrowRight") updateLightbox(1);
  if (dialog && event.key === "ArrowLeft") updateLightbox(-1);
});

route();
