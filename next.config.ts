import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Camera, microphone and GPS are only ever requested by this origin, and only after explicit user consent.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['bcryptjs'],
  async headers() {
    // Pages get a per-request nonce CSP from src/proxy.ts. Uploaded evidence is served under a locked-down
    // policy of its own: no scripts, no plugins, sandboxed even if opened directly.
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/api/evidence/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'none'; script-src 'none'; frame-ancestors 'none'; sandbox" },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
