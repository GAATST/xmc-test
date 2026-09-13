import { cloudinaryProvider } from 'lib/dam-picker/cloudinary';
import { authorizeDamRequest, errorResponse } from 'lib/dam-picker/apiGuard';

/**
 * GET /api/dam/asset?id=<public_id> — full raw metadata for one asset
 * (detail/debug view). Query param because asset IDs may contain slashes.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeDamRequest(request);
  if (denied) {
    return denied;
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') ?? '';
  if (!id || id.length > 512) {
    return Response.json({ error: 'Invalid asset id' }, { status: 400 });
  }

  try {
    const data = await cloudinaryProvider.getAssetData(id);
    return Response.json(data);
  } catch (error) {
    return errorResponse(error, 'DAM asset lookup failed');
  }
}
