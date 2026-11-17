import type { FeedbackRequest, FeedbackType } from '../../shared/api'

export const FEEDBACK_TYPES: readonly FeedbackType[] = ['helpful', 'wrong_category']
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pure validation of the already-parsed feedback JSON body (SPEC section 5). */
export function parseFeedbackBody(body: unknown):
  | { ok: true; value: FeedbackRequest }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' }
  }
  const fields = body as Record<string, unknown>
  for (const field of ['videoId', 'feedbackType', 'clientId']) {
    if (typeof fields[field] !== 'string') {
      return { ok: false, error: `Field "${field}" must be a string` }
    }
  }
  const { videoId, feedbackType, clientId } = fields as Record<string, string>
  for (const [field, value] of [['videoId', videoId], ['clientId', clientId]]) {
    if (!UUID_REGEX.test(value)) {
      return { ok: false, error: `Field "${field}" must be a UUID` }
    }
  }
  if (!FEEDBACK_TYPES.includes(feedbackType as FeedbackType)) {
    return { ok: false, error: 'Field "feedbackType" must be helpful or wrong_category' }
  }
  return { ok: true, value: { videoId, feedbackType: feedbackType as FeedbackType, clientId } }
}
