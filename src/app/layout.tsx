import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import { BrandFonts } from "@/components/brand/BrandFonts";
import "./globals.css";

// Fallbacks while the brand fonts (Indian Type Foundry, via Fontshare) load or if they're blocked.
const geistSans = Geist({ variable: "--font-fallback-sans", subsets: ["latin"] });
const serifFallback = Instrument_Serif({
  variable: "--font-fallback-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: { default: "Dukaanshot — AI catalogue photos for clothing & jewellery", template: "%s · Dukaanshot" },
  description:
    "Turn one product photo into on-model, lifestyle and studio catalogue images for WhatsApp Business, Instagram and your website in seconds.",
};

export const viewport: Viewport = { themeColor: "#fbf6ec" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${serifFallback.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Brand type: Sentient (display), Author (body), Ranade (UI) — loaded without blocking paint. */}
        <BrandFonts />
        {children}
      </body>
    </html>
  );
}
