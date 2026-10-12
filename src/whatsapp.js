export function generateWhatsAppOrderMessage(product, quantity) {
  const price = product.price === null
    ? "Please confirm price"
    : `₹${product.price.toLocaleString("en-IN")}`;
  return `Hi, I would like to order:\n\nProduct: ${product.name}\nSize: ${product.size}\nPrice: ${price}\nQuantity: ${quantity}\n\nPlease confirm availability and delivery details.`;
}

export function generateWhatsAppUrl(phone, message) {
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
