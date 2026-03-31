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
    key: "Cross-Origin-Embedder-Policy",
    value: "credentialless",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://lh3.googleusercontent.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebase.google.com wss://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com",
      "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
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
