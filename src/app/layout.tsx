import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "Castly — AI catalogue photos for clothing & jewellery", template: "%s · Castly" },
  description:
    "Turn one product photo into on-model, lifestyle and studio catalogue images for WhatsApp Business, Instagram and your website in seconds.",
};

export const viewport: Viewport = { themeColor: "#faf8f5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${display.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
