import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin-allow-popups",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        http2: false,
        process: false,
        stream: false,
        util: false,
        buffer: false,
        crypto: false,
        path: false,
        os: false,
        http: false,
        https: false,
        zlib: false,
        minio: false,
      };
    }
    return config;
  },
  serverExternalPackages: [
    "firebase-admin",
    "minio",
    "nodemailer",
    "@sendgrid/mail",
    "@sendgrid/helpers",
  ],
  turbopack: {
    resolveAlias: {
      nodemailer: {
        browser: "./src/lib/stubs/nodemailer.stub",
      },
      "@sendgrid/mail": {
        browser: "./src/lib/stubs/nodemailer.stub",
      },
      "@sendgrid/helpers": {
        browser: "./src/lib/stubs/nodemailer.stub",
      },
    },
  },
  output: "standalone",
  experimental: {},
  transpilePackages: [
    "google-gax",
    "protobufjs",
    "@protobufjs/codegen",
    "@protobufjs/inquire",
    "lodash.clonedeep",
    "jwks-rsa",
  ],
};

export default nextConfig;
