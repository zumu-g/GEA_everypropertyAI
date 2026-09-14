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
      // View.com.au rental photos. The feed stores BARE-host URLs
      // (https://view.com.au/viewstatic/...) and `**.` only matches subdomains,
      // so both entries are needed — without the bare one the optimizer 400s
      // ("url" parameter is not allowed) and every View photo renders blank.
      { protocol: "https", hostname: "view.com.au" },
      { protocol: "https", hostname: "**.view.com.au" },
      { protocol: "https", hostname: "**.homely.com.au" },       // Homely photos
      { protocol: "https", hostname: "**.allhomes.com.au" },     // Allhomes photos (images.allhomes.com.au)
    ],
  },
};

export default nextConfig;
