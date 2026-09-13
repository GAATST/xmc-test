/**
 * DAM-agnostic types. The Sitecore side of the picker only ever sees these,
 * so swapping the stand-in provider (Cloudinary) for Fotoware later means
 * implementing a new DamProvider module and nothing else.
 */

export interface DamAsset {
  /** Provider-specific asset ID (Cloudinary: public_id — may contain slashes) */
  ref: string;
  title: string;
  /** Original file extension/format, e.g. "jpg", "pdf" */
  extension: string;
  /** Provider-specific asset kind needed to build/download URLs (Cloudinary: image|video|raw) */
  resourceType: string;
  /**
   * Direct URL of the ORIGINAL file, as delivered by the DAM. Only set when
   * the provider's original URLs are permanent (Cloudinary: secure_url).
   * Providers with expiring download URLs (Fotoware-style) leave this unset,
   * and links fall back to the /api/dam/file redirect route instead.
   */
  originalUrl?: string;
  width?: number;
  height?: number;
  /**
   * Permanent rendition URLs by size code — safe to store in Sitecore fields.
   * thm = thumbnail, pre = preview, scr = screen size.
   */
  urls: {
    thm?: string;
    pre?: string;
    scr?: string;
  };
}

export interface DamSearchResult {
  total: number;
  assets: DamAsset[];
}

/** Generic type filter the picker UI uses; each provider maps it to its own query syntax. */
export type DamTypeFilter = '' | 'image' | 'document';

export interface DamProvider {
  search(query: string, typeFilter: DamTypeFilter, limit: number): Promise<DamSearchResult>;
  getAssetData(ref: string): Promise<unknown>;
  /**
   * URL for the ORIGINAL file, resolved at request time by the /api/dam/file
   * redirect route. For providers with expiring download URLs (Fotoware-style)
   * this returns a fresh short-lived URL; Cloudinary returns a permanent one.
   * The redirect-route indirection is kept regardless, for provider parity.
   */
  getOriginalFileUrl(ref: string, resourceType: string, extension: string): Promise<string>;
}
