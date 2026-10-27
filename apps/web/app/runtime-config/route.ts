/**
 * Public, non-secret settings read at request time, so the same image runs in every
 * environment (nothing environment-specific is baked into the browser bundle).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      // Only shows the form; the API itself refuses dev-login when NODE_ENV=production.
      devLogin: process.env.DEV_LOGIN === 'true',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
