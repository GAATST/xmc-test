import { redirect } from 'next/navigation';
import { cloudinaryProvider } from 'lib/dam-picker/cloudinary';
import { authorizeFileRedirect, errorResponse } from 'lib/dam-picker/apiGuard';

const VALID_RESOURCE_TYPES = ['image', 'video', 'raw'];

/**
 * GET /api/dam/file?id=<public_id>&rt=image&ext=pdf — redirects to the
 * original file. General Link fields store THIS route (stable) so that a
 * provider with expiring download URLs (Fotoware-style) can mint a fresh URL
 * per request; Cloudinary happens to return a permanent one.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeFileRedirect(request);
  if (denied) {
    return denied;
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') ?? '';
  const resourceType = searchParams.get('rt') ?? 'image';
  const ext = searchParams.get('ext') ?? '';
  if (!id || id.length > 512 || !VALID_RESOURCE_TYPES.includes(resourceType) || !/^[a-z0-9]{0,8}$/i.test(ext)) {
    return Response.json({ error: 'Invalid asset id, resource type, or extension' }, { status: 400 });
  }

  let url: string;
  try {
    url = await cloudinaryProvider.getOriginalFileUrl(id, resourceType, ext);
  } catch (error) {
    return errorResponse(error, 'DAM file redirect failed');
  }
  redirect(url);
}
