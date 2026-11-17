/** Pure category-filter validation for `GET /api/v1/feed` (SPEC section 3). */

export const MAX_CATEGORY_ID_LENGTH = 64
export const MAX_CATEGORY_IDS = 50

export type CategoryIdsValidation =
  | { ok: true; ids: string[] }
  | { ok: false; error: string }

/** Trims and deduplicates category ids, preserving their first-seen order. */
export function parseCategoryIds(raw: string | null): CategoryIdsValidation {
  if (raw === null) return { ok: true, ids: [] }
  const ids = [...new Set(raw.split(',').map(id => id.trim()).filter(id => id.length > 0))]
  if (ids.some(id => id.length > MAX_CATEGORY_ID_LENGTH)) {
    return { ok: false, error: `Query parameter "categories" ids must be at most ${MAX_CATEGORY_ID_LENGTH} characters` }
  }
  if (ids.length > MAX_CATEGORY_IDS) {
    return { ok: false, error: `Query parameter "categories" must contain at most ${MAX_CATEGORY_IDS} category ids` }
  }
  return { ok: true, ids }
}
