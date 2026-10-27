/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

export default {
  reactStrictMode: true,
  output: 'standalone',
  // The browser talks only to this origin; /api/* is proxied to the Nest admin API,
  // so the session cookie stays first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/admin/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
