import type { AdminCategoryCreateRequest, AdminCategoryUpdateRequest, AdminVideoUpdateRequest } from '../../shared/api'
import { extractYouTubeVideoId } from '../../shared/youtubeUrl'
import { UUID_REGEX } from '../feedback/validation'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }
type VideoCreate = Required<AdminVideoUpdateRequest> & { externalVideoId: string }

/** Pure admin input validation (SPEC sections 4 and 6). */
function parseFields(body: unknown, category: boolean, create: boolean): Result<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' }
  }
  const fields = body as Record<string, unknown>
  const value: Record<string, unknown> = {}
  const textField = category ? 'name' : 'label'
  const max = category ? 100 : 200
  if (create || textField in fields) {
    const text = fields[textField]
    if (typeof text !== 'string') return { ok: false, error: `Field "${textField}" must be a string` }
    if (!text.trim().length || text.trim().length > max) {
      return { ok: false, error: `Field "${textField}" must be between 1 and ${max} characters` }
    }
    value[textField] = text.trim()
  }
  if ('enabled' in fields) {
    if (typeof fields.enabled !== 'boolean') return { ok: false, error: 'Field "enabled" must be a boolean' }
    value.enabled = fields.enabled
  } else if (create) value.enabled = true
  if (!category) {
    if ('searchKeywords' in fields) {
      const keywords = fields.searchKeywords
      if (keywords !== null && (typeof keywords !== 'string' || keywords.length > 500)) {
        return { ok: false, error: 'Field "searchKeywords" must be a string of at most 500 characters or null' }
      }
      value.searchKeywords = typeof keywords === 'string' ? keywords.trim() || null : null
    } else if (create) value.searchKeywords = null
    if ('categoryIds' in fields) {
      const ids = fields.categoryIds
      if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !UUID_REGEX.test(id))) {
        return { ok: false, error: 'Field "categoryIds" must be an array of at most 50 UUIDs' }
      }
      value.categoryIds = [...new Set(ids)]
    } else if (create) value.categoryIds = []
    if ('availabilityStatus' in fields) {
      if (!['active', 'under_review', 'unavailable'].includes(fields.availabilityStatus as string)) {
        return { ok: false, error: 'Field "availabilityStatus" must be active, under_review or unavailable' }
      }
      value.availabilityStatus = fields.availabilityStatus
    } else if (create) value.availabilityStatus = 'active'
  }
  if (!create && !Object.keys(value).length) return { ok: false, error: 'No updatable fields provided' }
  return { ok: true, value }
}

export function parseAdminVideoCreate(body: unknown): Result<VideoCreate> {
  const parsed = parseFields(body, false, true)
  if (!parsed.ok) return parsed
  const url = (body as Record<string, unknown>).url
  if (typeof url !== 'string') return { ok: false, error: 'Field "url" must be a string' }
  const externalVideoId = extractYouTubeVideoId(url)
  if (!externalVideoId) return { ok: false, error: 'Field "url" must be a YouTube URL or video ID' }
  return { ok: true, value: { ...parsed.value, externalVideoId } as VideoCreate }
}

export function parseAdminVideoUpdate(body: unknown): Result<AdminVideoUpdateRequest> {
  return parseFields(body, false, false)
}

export function parseAdminCategoryCreate(body: unknown): Result<Required<AdminCategoryCreateRequest>> {
  return parseFields(body, true, true) as Result<Required<AdminCategoryCreateRequest>>
}

export function parseAdminCategoryUpdate(body: unknown): Result<AdminCategoryUpdateRequest> {
  return parseFields(body, true, false)
}
