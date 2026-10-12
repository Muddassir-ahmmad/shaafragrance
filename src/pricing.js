export function isOfferActive(offer, now = new Date()) {
  return offer.status === "active"
    && new Date(offer.startsAt).getTime() <= now.getTime()
    && new Date(offer.endsAt).getTime() > now.getTime();
}

export function calculateDiscount(price, offer, purchaseAmount = price) {
  const regularPrice = Number(price);
  const eligibleTotal = Number(purchaseAmount);
  const value = Number(offer.discountValue);
  const minimum = offer.minPurchase == null ? 0 : Number(offer.minPurchase);
  const maximum = offer.maxDiscount == null ? Infinity : Number(offer.maxDiscount);
  if (!Number.isFinite(regularPrice) || regularPrice < 0
    || !Number.isFinite(eligibleTotal) || eligibleTotal < 0
    || !Number.isFinite(value) || value <= 0
    || eligibleTotal < minimum) return 0;
  if (offer.type === "percentage" && value > 100) return 0;
  if (offer.type !== "percentage" && offer.type !== "fixed") return 0;
  const calculated = offer.type === "percentage" ? regularPrice * value / 100 : value;
  return Math.min(regularPrice, calculated, maximum);
}

export function getProductPricing(product, offers = [], now = new Date()) {
  const regularPrice = product.price === null ? null : Number(product.price);
  if (regularPrice === null || !Number.isFinite(regularPrice) || regularPrice < 0) {
    return { regularPrice: null, finalPrice: null, discount: 0, offer: null, percentSaved: 0 };
  }

  const salePrice = product.salePrice == null ? null : Number(product.salePrice);
  if (salePrice !== null && Number.isFinite(salePrice) && salePrice >= 0 && salePrice < regularPrice) {
    return {
      regularPrice,
      finalPrice: salePrice,
      discount: regularPrice - salePrice,
      offer: null,
      percentSaved: Math.round(((regularPrice - salePrice) / regularPrice) * 100),
    };
  }

  const matches = offers
    .filter((offer) => isOfferActive(offer, now) && offerMatchesProduct(offer, product))
    .map((offer) => ({
      offer,
      specificity: offer.scope === "product" ? 3 : offer.scope === "category" ? 2 : 1,
      discount: calculateDiscount(regularPrice, offer),
    }))
    .filter((entry) => entry.discount > 0)
    .sort((a, b) => b.specificity - a.specificity
      || Number(b.offer.priority || 0) - Number(a.offer.priority || 0)
      || b.discount - a.discount
      || new Date(a.offer.startsAt) - new Date(b.offer.startsAt));
  const winner = matches[0];
  const discount = winner?.discount || 0;
  return {
    regularPrice,
    finalPrice: regularPrice - discount,
    discount,
    offer: winner?.offer || null,
    percentSaved: discount ? Math.round(discount / regularPrice * 100) : 0,
  };
}

function offerMatchesProduct(offer, product) {
  if (offer.scope === "storewide") return true;
  if (offer.scope === "product") return (offer.productIds || []).includes(product.id);
  if (offer.scope === "category") {
    return (offer.categoryIds || []).includes(product.categoryId)
      || (offer.categoryNames || []).includes(product.category);
  }
  return false;
}
