import type { Metadata } from "next";
import { IBM_Plex_Mono, Lora, Poppins } from "next/font/google";
import Script from "next/script";

import "./globals.css";

/** Official public palette & type pairing: anthropics/skills `brand-guidelines` (Poppins headings, Lora body). */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-brand-heading",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-brand-body",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Artifex · Object-first 3D",
  description: "From product description to reference concepts and downloadable 3D assets.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${poppins.variable} ${lora.variable} ${plexMono.variable}`}>
      <body>
        {children}
        <Script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js" />
      </body>
    </html>
  );
}
