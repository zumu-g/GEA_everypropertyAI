import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.realestate.com.au" },
      { protocol: "https", hostname: "**.domain.com.au" },
    ],
  },
};

export default nextConfig;
