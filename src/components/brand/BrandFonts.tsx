"use client";

import { useEffect } from "react";

const FONTSHARE =
  "https://api.fontshare.com/v2/css?f[]=sentient@300,400,500,700,301,401,501&f[]=author@400,500,600,401&f[]=ranade@400,500,600,700&display=swap";

/**
 * Loads the brand fonts (Sentient, Author, Ranade — Indian Type Foundry, via
 * Fontshare) without blocking first paint: a slow or unreachable font CDN must
 * never delay rendering or hydration. Fallback fonts show until they arrive.
 */
export function BrandFonts() {
  useEffect(() => {
    if (document.querySelector("link[data-brand-fonts]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTSHARE;
    link.dataset.brandFonts = "";
    document.head.appendChild(link);
  }, []);
  return null;
}
