import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Camera, microphone and GPS are only ever requested by this origin, and only after explicit user consent.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['bcryptjs'],
  async headers() {
    const csp = securityHeaders.find((h) => h.key === 'Content-Security-Policy')!;
    return [
      // Uploaded evidence is served under a locked-down policy of its own: no scripts, no plugins, sandboxed
      // even if opened directly. The site-wide CSP would otherwise replace it.
      { source: '/((?!api/evidence/).*)', headers: [csp] },
      { source: '/:path*', headers: securityHeaders.filter((h) => h !== csp) },
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
