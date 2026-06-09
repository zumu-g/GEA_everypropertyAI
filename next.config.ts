import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev-server requests from the local network (e.g. testing on a LAN IP).
  // Dev-only; has no effect on production builds.
  allowedDevOrigins: ["192.168.20.112"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.realestate.com.au" },
      { protocol: "https", hostname: "**.domain.com.au" },
    ],
  },
};

export default nextConfig;
