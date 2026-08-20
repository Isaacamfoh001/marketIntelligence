import type { NextConfig } from "next";

// GSE import uploads go through a Server Action (see
// data-centre/import/actions.ts), which defaults to a 1MB request body
// limit — too small for a multi-year daily security-price CSV. Raised to
// 10MB to match MAX_UPLOAD_BYTES in gse-import-templates.ts (kept as one
// documented, cross-referenced limit rather than two numbers that could
// drift apart).
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
