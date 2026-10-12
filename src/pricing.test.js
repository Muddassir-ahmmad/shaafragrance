import test from "node:test";
import assert from "node:assert/strict";
import { getProductPricing } from "./pricing.js";

const now = new Date("2026-05-02T12:00:00.000Z");
const activeOffer = {
  status: "active",
  startsAt: "2026-05-01T00:00:00.000Z",
  endsAt: "2026-05-03T00:00:00.000Z",
  scope: "storewide",
  type: "percentage",
  discountValue: 20,
};

test("applies the best applicable offer and caps the resulting discount at the price", () => {
  const product = { id: "oud", category: "Oud", categoryId: "category-1", price: 100 };
  const result = getProductPricing(product, [
    { ...activeOffer, discountValue: 10 },
    { ...activeOffer, scope: "product", productIds: ["oud"], discountValue: 75 },
    { ...activeOffer, scope: "category", categoryIds: ["category-1"], discountValue: 30 },
  ], now);

  assert.equal(result.regularPrice, 100);
  assert.equal(result.finalPrice, 25);
  assert.equal(result.discount, 75);
  assert.equal(result.percentSaved, 75);
});

test("a valid explicit sale price takes precedence over temporary offers", () => {
  const result = getProductPricing(
    { id: "oud", price: 100, salePrice: 60 },
    [{ ...activeOffer, discountValue: 90 }],
    now,
  );

  assert.equal(result.finalPrice, 60);
  assert.equal(result.offer, null);
});

test("ignores inactive, expired, and minimum-purchase-ineligible offers", () => {
  const result = getProductPricing(
    { id: "oud", price: 100 },
    [
      { ...activeOffer, status: "paused", discountValue: 90 },
      { ...activeOffer, endsAt: "2026-05-02T11:59:59.000Z", discountValue: 80 },
      { ...activeOffer, minPurchase: 101, discountValue: 70 },
    ],
    now,
  );

  assert.equal(result.finalPrice, 100);
  assert.equal(result.discount, 0);
});

test("returns no price when the catalogue price is missing", () => {
  const result = getProductPricing({ id: "oud", price: null }, [activeOffer], now);

  assert.equal(result.finalPrice, null);
  assert.equal(result.discount, 0);
});
