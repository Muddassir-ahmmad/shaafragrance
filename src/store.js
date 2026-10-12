import { createClient } from "@supabase/supabase-js";
import { brand, perfumeBrand, products as sampleProducts } from "./data.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || "";

export const configurationError = Boolean(supabaseUrl) !== Boolean(supabaseAnonKey);
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function productFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    size: row.size,
    price: row.price === null ? null : Number(row.price),
    salePrice: row.sale_price === null || row.sale_price === undefined ? null : Number(row.sale_price),
    priceLabel: row.price_label,
    sku: row.sku || "",
    status: row.status || "active",
    shortDescription: row.short_description || row.description,
    productBrand: row.product_brand || brand.perfumeName,
    audience: row.audience || "",
    currency: row.currency || "INR",
    description: row.description,
    notes: row.notes || [],
    image: row.image_url,
    images: row.image_urls?.length ? row.image_urls : row.image_url ? [row.image_url] : [],
    categoryId: row.category_id || null,
    specifications: row.specifications || {},
    isNewArrival: Boolean(row.is_new_arrival),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    available: row.available,
    availability: row.availability,
    ingredients: row.ingredients || [],
    variants: row.variants || [],
    featured: row.featured,
    isPlaceholder: false,
    arrivalDate: row.arrival_date || "",
  };
}

export function productToRow(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    size: product.size,
    price: product.price,
    sale_price: product.salePrice ?? null,
    price_label: product.price === null ? "Price to be confirmed" : "",
    sku: product.sku,
    status: product.status || "active",
    short_description: product.shortDescription || product.description,
    product_brand: product.productBrand || brand.perfumeName,
    audience: product.audience || "",
    currency: product.currency || "INR",
    description: product.description,
    notes: product.notes,
    image_url: product.image,
    image_urls: product.images?.length ? product.images : [product.image],
    specifications: product.specifications || {},
    is_new_arrival: Boolean(product.isNewArrival),
    available: product.available,
    availability: product.availability,
    ingredients: product.ingredients || [],
    variants: product.variants || [],
    featured: product.featured,
    arrival_date: product.arrivalDate || null,
  };
}

export async function fetchStorefrontData() {
  if (!supabase) return { products: sampleProducts, categories: [], offers: [], settings: null };
  const [productResult, categoryResult, offerResult, settingsResult] = await Promise.all([
    supabase.from("products")
      .select("id,name,category,size,price,sale_price,price_label,description,short_description,notes,image_url,image_urls,available,availability,ingredients,variants,featured,is_new_arrival,arrival_date,product_brand,audience,currency,specifications")
      .eq("status", "active")
      .order("name"),
    supabase.from("product_categories")
      .select("id,name,slug,description,image_url,sort_order,active")
      .eq("active", true)
      .order("sort_order"),
    supabase.rpc("get_public_store_offers"),
    supabase.from("store_settings")
      .select("store_name,logo_url,description,whatsapp,email,phone,instagram,location,currency,low_stock_threshold,shipping_message,timezone")
      .eq("id", 1)
      .maybeSingle(),
  ]);
  for (const result of [productResult, categoryResult, offerResult, settingsResult]) {
    if (result.error) throw result.error;
  }
  const categories = categoryResult.data.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image: row.image_url,
    sortOrder: row.sort_order,
  }));
  const categoryIds = new Map(categories.map((category) => [category.name.toLowerCase(), category.id]));
  const products = productResult.data.map((row) => productFromRow({
    ...row,
    category_id: categoryIds.get(row.category.toLowerCase()) || null,
  }));
  const offers = offerResult.data.map((row) => ({
    id: row.id,
    name: row.name,
    customerMessage: row.customer_message,
    type: row.offer_type,
    discountValue: Number(row.discount_value),
    scope: row.scope,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: "active",
    minPurchase: row.min_purchase === null ? null : Number(row.min_purchase),
    maxDiscount: row.max_discount === null ? null : Number(row.max_discount),
    priority: row.priority,
    showBanner: row.show_banner,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    productIds: row.product_ids || [],
    categoryIds: row.category_ids || [],
  }));
  const settings = settingsResult.data;
  if (settings) {
    brand.name = settings.store_name;
    brand.perfumeName = settings.store_name;
    brand.logo = settings.logo_url;
    brand.whatsapp = settings.whatsapp;
    brand.email = settings.email;
    brand.phone = settings.phone;
    brand.instagram = settings.instagram;
    brand.location = settings.location;
    brand.currency = settings.currency;
    brand.shippingMessage = settings.shipping_message;
    brand.timezone = settings.timezone;
    perfumeBrand.logo = settings.logo_url;
    perfumeBrand.description = settings.description;
  }
  return { products, categories, offers, settings };
}

export async function fetchProducts() {
  if (!supabase) return sampleProducts;
  const { data, error } = await supabase.from("products").select("*").order("name");
  if (error) throw error;
  return data.map(productFromRow);
}

export function offerToRow(offer) {
  return {
    name: offer.name,
    internal_description: offer.internalDescription || "",
    customer_message: offer.customerMessage || "",
    offer_type: offer.type,
    discount_value: offer.discountValue,
    scope: offer.scope,
    starts_at: offer.startsAt,
    ends_at: offer.endsAt,
    min_purchase: offer.minPurchase ?? null,
    max_discount: offer.maxDiscount ?? null,
    status: offer.status,
    priority: offer.priority || 0,
    show_banner: Boolean(offer.showBanner),
    cta_label: offer.ctaLabel || "Shop now",
    cta_url: offer.ctaUrl || "/perfumes/shop",
  };
}

export function offerFromRow(row, productIds = [], categoryIds = []) {
  return {
    id: row.id,
    name: row.name,
    internalDescription: row.internal_description,
    customerMessage: row.customer_message,
    type: row.offer_type,
    discountValue: Number(row.discount_value),
    scope: row.scope,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    minPurchase: row.min_purchase === null ? null : Number(row.min_purchase),
    maxDiscount: row.max_discount === null ? null : Number(row.max_discount),
    status: row.status,
    priority: row.priority,
    showBanner: row.show_banner,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    productIds,
    categoryIds,
  };
}

export function slugify(value) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Product names must include at least one letter or number.");
  return slug;
}
