import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "everypropertyAI — Every Property. Every Detail.",
  description:
    "Search any Australian property and get instant data from 8+ portals. Comprehensive property intelligence for Casey & Cardinia real estate professionals.",
};

// `viewport-fit: cover` enables the iPhone safe-area env() insets used by the safe-area
// utilities in globals.css. User scaling is left enabled (no maximumScale / userScalable:false)
// so pinch-zoom accessibility is preserved.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en-AU"
      className={instrumentSans.variable}
    >
      <body className="min-h-screen bg-[#FBFBFC] font-sans text-[#16181D] antialiased">
        {children}
      </body>
    </html>
  );
}
