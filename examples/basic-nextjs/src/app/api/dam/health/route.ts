/**
 * GET /api/dam/health — runtime deployment verification (no build-log access
 * needed). Interpreting the response:
 *   - HTTP 404 (Next.js not-found) => OLD build: the picker code is not in
 *     this deployment at all.
 *   - JSON response => picker code deployed; the body shows which DAM env
 *     vars actually reach the runtime (values only for non-secrets, set/unset
 *     booleans for secrets).
 * Honors the kill switch so disabled deployments (delivery site) reveal
 * nothing.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (process.env.DAM_PICKER_ENABLED === 'false') {
    return Response.json({ error: 'DAM picker is disabled on this deployment' }, { status: 404 });
  }
  return Response.json({
    marker: 'dam-picker',
    time: new Date().toISOString(),
    env: {
      DAM_PICKER_ENABLED: process.env.DAM_PICKER_ENABLED ?? null,
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? null,
      CLOUDINARY_API_KEY_set: Boolean(process.env.CLOUDINARY_API_KEY),
      CLOUDINARY_API_SECRET_set: Boolean(process.env.CLOUDINARY_API_SECRET),
      DAM_PICKER_ACCESS_KEY_set: Boolean(process.env.DAM_PICKER_ACCESS_KEY),
    },
  });
}
