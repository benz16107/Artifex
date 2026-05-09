import type { Metadata } from "next";
import Script from "next/script";

import "./globals.css";

export const metadata: Metadata = {
  title: "Artifex · Object-first 3D",
  description: "From product description to reference concepts and downloadable 3D assets.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js" />
      </body>
    </html>
  );
}
