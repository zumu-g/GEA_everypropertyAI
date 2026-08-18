import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Sampled from live property_listings/property_sales/property_rentals rows
    // (U5) — the actual photo CDN hosts, not the portal marketing domains.
    remotePatterns: [
      { protocol: "https", hostname: "**.realestate.com.au" },
      { protocol: "https", hostname: "**.domain.com.au" },
      { protocol: "https", hostname: "**.domainstatic.com.au" }, // Domain photo CDN (rimh2.domainstatic.com.au)
      { protocol: "https", hostname: "**.reastatic.net" },       // REA photo CDN (i2.au.reastatic.net)
      { protocol: "https", hostname: "**.view.com.au" },         // View.com.au rental photos
      { protocol: "https", hostname: "**.homely.com.au" },       // Homely photos
      { protocol: "https", hostname: "**.allhomes.com.au" },     // Allhomes photos (images.allhomes.com.au)
    ],
  },
};

export default nextConfig;
