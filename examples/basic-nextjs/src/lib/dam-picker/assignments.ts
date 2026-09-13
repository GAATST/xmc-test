/**
 * Value stored in the DamAsset custom field:
 *   { meta: { boundItemId }, fields: { <targetFieldName>: DamAssignment } }
 *
 * - meta.boundItemId caches the datasource item this field lives on, resolved
 *   once via the nonce handshake (see detectOwningItem) so later opens skip it.
 * - fields records which DAM asset each Image / General Link field holds,
 *   letting one Plugin field serve any number of target fields and letting
 *   the picker show/replace/clear existing assignments on reopen.
 */

export interface DamAssignment {
  ref: string;
  url: string;
  title: string;
  /** Sitecore item the target field lives on (needed to clear it later). */
  itemId?: string;
  /** Preview size used for image fields (thm | pre | scr); absent for links. */
  size?: string;
  extension?: string;
  assignedAt: string;
}

export type AssignmentMap = Record<string, DamAssignment>;

export interface DamFieldStore {
  meta: {
    boundItemId?: string;
    /** Transient nonce used by the owning-item handshake. */
    probe?: string;
  };
  fields: AssignmentMap;
}

export function parseStore(raw: unknown): DamFieldStore {
  const empty: DamFieldStore = { meta: {}, fields: {} };
  if (typeof raw !== 'string' || !raw.trim()) {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return empty;
    }
    // Current shape
    if ('fields' in parsed || 'meta' in parsed) {
      return {
        meta: typeof parsed.meta === 'object' && parsed.meta ? parsed.meta : {},
        fields: typeof parsed.fields === 'object' && parsed.fields ? parsed.fields : {},
      };
    }
    // Legacy shape: flat { <fieldName>: assignment } map
    return { meta: {}, fields: parsed as AssignmentMap };
  } catch {
    // Malformed value — start fresh rather than crash the picker.
    return empty;
  }
}

export function serializeStore(store: DamFieldStore): string {
  return JSON.stringify(store, null, 2);
}
