import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Question uploads are sent to server actions after parsing in the browser.
      bodySizeLimit: "4mb",
    },
  },
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
