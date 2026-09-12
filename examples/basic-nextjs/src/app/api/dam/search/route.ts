import { cloudinaryProvider } from 'lib/dam-picker/cloudinary';
import type { DamTypeFilter } from 'lib/dam-picker/types';
import { authorizeDamRequest, errorResponse } from 'lib/dam-picker/apiGuard';

/**
 * GET /api/dam/search?q=beach&type=image&limit=24
 * type: '' (all) | 'image' | 'document' — provider maps to its own syntax.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeDamRequest(request);
  if (denied) {
    return denied;
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const typeParam = searchParams.get('type') ?? '';
  const typeFilter: DamTypeFilter =
    typeParam === 'image' || typeParam === 'document' ? typeParam : '';
  const limit = Math.min(Number(searchParams.get('limit')) || 24, 100);

  try {
    const result = await cloudinaryProvider.search(q, typeFilter, limit);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, 'DAM search failed');
  }
}
