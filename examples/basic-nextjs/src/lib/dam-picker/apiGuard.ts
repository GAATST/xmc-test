/**
 * Access control for the DAM proxy routes. Layers:
 *
 * 1. Kill switch: DAM_PICKER_ENABLED=false disables the routes entirely —
 *    set this on deployments that don't host authoring (e.g. the delivery
 *    site on Vercel).
 * 2. Access key: when DAM_PICKER_ACCESS_KEY is set, search/asset requests
 *    must carry it (x-dam-key header or ?key=). The key is delivered to
 *    authors via the Cloud Portal Deployment URL path (/dam-picker/k-<key>),
 *    so only people opening the app through Page Builder have it.
 * 3. Secure by default: in production, search/asset routes REFUSE to serve
 *    without an access key configured — an unconfigured public deployment
 *    exposes nothing. Development (localhost) stays frictionless.
 * 4. Optional origin gate: DAM_ALLOWED_ORIGIN (weak against non-browser
 *    clients — treat as defense in depth only).
 *
 * Production-grade alternative (out of POC scope, documented in the plan):
 * the Marketplace full-stack pattern with real user auth (e.g. Auth0).
 */

function json(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function isKilled(): boolean {
  return process.env.DAM_PICKER_ENABLED === 'false';
}

function originAllowed(request: Request): boolean {
  const allowed = process.env.DAM_ALLOWED_ORIGIN;
  if (!allowed) {
    return true;
  }
  const origin = request.headers.get('origin') || request.headers.get('referer') || '';
  return origin.startsWith(allowed);
}

/**
 * Full guard for enumeration-capable routes (search, asset metadata).
 * Returns an error Response to send, or null when the request is allowed.
 */
export function authorizeDamRequest(request: Request): Response | null {
  if (isKilled()) {
    return json(404, 'DAM picker is disabled on this deployment');
  }
  if (!originAllowed(request)) {
    return json(403, 'Forbidden');
  }

  const accessKey = process.env.DAM_PICKER_ACCESS_KEY;
  if (accessKey) {
    const provided =
      request.headers.get('x-dam-key') ?? new URL(request.url).searchParams.get('key');
    if (provided !== accessKey) {
      return json(403, 'Missing or invalid DAM access key');
    }
    return null;
  }

  if (process.env.NODE_ENV === 'production') {
    return json(403, 'DAM proxy requires DAM_PICKER_ACCESS_KEY to be configured in production');
  }
  return null;
}

/**
 * Lighter guard for the visitor-facing file redirect route: honors the kill
 * switch and origin gate, but NOT the access key — stored General Link
 * fallback URLs must work for site visitors. This route only redirects one
 * known asset ID (no enumeration/search), and for permanent-URL providers
 * like Cloudinary it is unused anyway.
 */
export function authorizeFileRedirect(request: Request): Response | null {
  if (isKilled()) {
    return json(404, 'DAM picker is disabled on this deployment');
  }
  if (!originAllowed(request)) {
    return json(403, 'Forbidden');
  }
  return null;
}

export function errorResponse(error: unknown, fallback: string): Response {
  console.error(fallback, error);
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 502 }
  );
}
