/**
 * Cloudinary DamProvider implementation. SERVER-SIDE ONLY: the Admin/Search
 * API uses Basic auth with api_key:api_secret, which must never reach the
 * browser.
 *
 * Deliberately implemented as plain REST (no Cloudinary SDK, no Media Library
 * widget) — the production target is Fotoware, which we assume offers only a
 * REST API, so the POC must not lean on Cloudinary-specific conveniences.
 *
 * API reference: https://cloudinary.com/documentation/search_method
 */
import type { DamAsset, DamProvider, DamSearchResult, DamTypeFilter } from './types';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function cloudName(): string {
  return requireEnv('CLOUDINARY_CLOUD_NAME');
}

function authHeader(): string {
  const key = requireEnv('CLOUDINARY_API_KEY');
  const secret = requireEnv('CLOUDINARY_API_SECRET');
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

async function searchApi<T>(body: Record<string, unknown>): Promise<T> {
  const url = `https://api.cloudinary.com/v1_1/${cloudName()}/resources/search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cloudinary search failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Cloudinary search returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/** Maps the generic picker filter to Cloudinary expression syntax.
 * PDFs live under resource_type:image (format:pdf); office docs are raw. */
const TYPE_EXPRESSIONS: Record<Exclude<DamTypeFilter, ''>, string> = {
  image: 'resource_type:image AND -format:pdf',
  document: '(format:pdf OR resource_type:raw)',
};

interface CloudinaryResource {
  public_id: string;
  resource_type: string;
  format?: string;
  width?: number;
  height?: number;
  secure_url?: string;
  filename?: string;
  display_name?: string;
  [key: string]: unknown;
}

interface CloudinarySearchResponse {
  total_count?: number;
  resources?: CloudinaryResource[];
}

/**
 * Builds a permanent delivery/rendition URL. Renditions are on-the-fly URL
 * transformations — conceptually equivalent to Fotoware's per-asset
 * rendition/preview URLs.
 */
function deliveryUrl(
  resourceType: string,
  publicId: string,
  transformations: string,
  extension: string
): string {
  const encodedId = publicId.split('/').map(encodeURIComponent).join('/');
  const prefix = transformations ? `${transformations}/` : '';
  const suffix = extension ? `.${extension}` : '';
  return `https://res.cloudinary.com/${cloudName()}/${resourceType}/upload/${prefix}${encodedId}${suffix}`;
}

function toDamAsset(resource: CloudinaryResource): DamAsset {
  const format = resource.format || '';
  const isPdf = format === 'pdf';
  const canPreview = resource.resource_type === 'image'; // includes PDFs (pg_1 page renders)

  // PDF previews: first page rendered as jpg. Images: f_auto/q_auto renditions.
  const pdfSuffix = isPdf ? ',pg_1' : ',f_auto,q_auto';
  const previewExt = isPdf ? 'jpg' : format;

  return {
    ref: resource.public_id,
    title:
      resource.display_name ||
      resource.filename ||
      resource.public_id.split('/').pop() ||
      resource.public_id,
    extension: format || (resource.resource_type === 'raw' ? 'bin' : 'jpg'),
    resourceType: resource.resource_type,
    // Cloudinary delivery URLs are permanent, so the original can be stored
    // directly in General Link fields.
    originalUrl:
      resource.secure_url || deliveryUrl(resource.resource_type, resource.public_id, '', format),
    width: resource.width,
    height: resource.height,
    urls: canPreview
      ? {
          thm: deliveryUrl('image', resource.public_id, `c_fill,w_150,h_150${pdfSuffix}`, previewExt),
          pre: deliveryUrl('image', resource.public_id, `c_limit,w_600${pdfSuffix}`, previewExt),
          scr: deliveryUrl('image', resource.public_id, `c_limit,w_1600${pdfSuffix}`, previewExt),
        }
      : {},
  };
}

export const cloudinaryProvider: DamProvider = {
  async search(query, typeFilter, limit): Promise<DamSearchResult> {
    const parts: string[] = [];
    if (query.trim()) {
      parts.push(query.trim());
    }
    if (typeFilter && TYPE_EXPRESSIONS[typeFilter]) {
      parts.push(TYPE_EXPRESSIONS[typeFilter]);
    } else {
      parts.push('-resource_type:video'); // POC scope: images + documents only
    }

    const result = await searchApi<CloudinarySearchResponse>({
      expression: parts.join(' AND '),
      max_results: limit,
    });

    const resources = result.resources ?? [];
    return {
      total: result.total_count ?? resources.length,
      assets: resources.map(toDamAsset),
    };
  },

  async getAssetData(ref): Promise<unknown> {
    const result = await searchApi<CloudinarySearchResponse>({
      expression: `public_id="${ref}"`,
      max_results: 1,
    });
    return result.resources?.[0] ?? null;
  },

  /**
   * Cloudinary originals are permanent public URLs, so this just constructs
   * one. For Fotoware this method would request a fresh (expiring) download
   * URL — which is why the /api/dam/file redirect route calls it per request.
   */
  async getOriginalFileUrl(ref, resourceType, extension): Promise<string> {
    return deliveryUrl(resourceType || 'image', ref, '', extension);
  },
};
