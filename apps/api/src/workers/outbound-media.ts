/**
 * Deterministic reply-media decision (Task 10 brief): whether the AI reply
 * worker should attach a product photo to a reply, instead of the model
 * deciding. Only fires when the agent's tool run touched exactly one
 * distinct product and that product has at least one stored image; a
 * two-product (or zero-product) turn never gets a photo, since there is no
 * single unambiguous match to attach.
 */
export function pickReplyMedia(
  productIdsSeen: string[],
  imagesByProduct: Record<string, string | undefined>,
): string | null {
  const distinctIds = Array.from(new Set(productIdsSeen));
  const [productId] = distinctIds;
  if (distinctIds.length !== 1 || productId === undefined) {
    return null;
  }
  return imagesByProduct[productId] ?? null;
}
