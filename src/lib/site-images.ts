/**
 * Every marketing / UI image on the site, in one place.
 *
 * Files live in public/images. To replace an image, overwrite the file at
 * the same path with the same aspect ratio — no code change needed.
 * Generation brief for each slot: docs/IMAGE_PROMPTS.md.
 */
export interface SiteImage {
  src: string;
  width: number;
  height: number;
  alt: string;
}

const img = (src: string, width: number, height: number, alt: string): SiteImage => ({ src, width, height, alt });

export const SITE_IMAGES = {
  heroBackground: img("/images/hero/hero-background.webp", 2400, 1400, ""),
  showcaseInput: img("/images/showcase/input-product.webp", 800, 1000, "Seller's phone photo of a red dress on a hanger"),
  showcaseOutputs: [
    img("/images/showcase/output-studio.webp", 800, 1000, "Dress on a model in a white studio"),
    img("/images/showcase/output-street.webp", 800, 1000, "Dress on a model on a city street"),
    img("/images/showcase/output-heritage.webp", 800, 1000, "Dress on a model in a heritage courtyard"),
    img("/images/showcase/output-festive.webp", 800, 1000, "Dress on a model at a festive evening setting"),
  ],
  categoryClothing: img("/images/categories/clothing.webp", 1200, 800, "Catalogue photos of Indian clothing"),
  categoryJewellery: img("/images/categories/jewellery.webp", 1200, 800, "Catalogue photos of fine jewellery"),
  loginBackground: img("/images/auth/login-background.webp", 1920, 1200, ""),
  studioEmpty: img("/images/studio/empty-state.webp", 1600, 1000, ""),
  ctaBackground: img("/images/cta/cta-background.webp", 2400, 1000, ""),
} as const;

export const SHOWCASE_LABELS = ["Studio white", "City street", "Heritage", "Festive"] as const;
