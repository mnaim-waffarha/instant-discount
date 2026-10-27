import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the Nest admin API: /api/<path> → $API_URL/admin/v1/<path>.
 * Runs at request time, so one image works in every environment. Cookies, status codes and
 * binary bodies (PDF/CSV downloads) pass through unchanged.
 */
export const dynamic = 'force-dynamic';

const FORWARD_REQUEST = ['cookie', 'content-type', 'accept', 'user-agent', 'x-request-id'];
const FORWARD_RESPONSE = [
  'content-type',
  'content-disposition',
  'set-cookie',
  'x-request-id',
  'cache-control',
];

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
  const target = `${apiUrl}/admin/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // The API rate-limits and records sessions by client IP (set TRUST_PROXY=true there).
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
  if (ip) headers.set('x-forwarded-for', ip);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { error: { code: 'API_UNREACHABLE', message: 'The API is not reachable' } },
      { status: 502 },
    );
  }

  const out = new Headers();
  for (const h of FORWARD_RESPONSE) {
    if (h === 'set-cookie')
      for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
    else {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
