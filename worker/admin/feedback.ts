import type { AdminFeedbackResponse, FeedbackType } from '../../shared/api'
import { FEEDBACK_TYPES } from '../feedback/validation'
import { FeedbackRepository } from '../repositories/FeedbackRepository'
import { parseLimit } from '../search/validation'

/** Bounded feedback review for administrators (SPEC section 6). */
export async function handleAdminFeedback(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
  }
  const params = new URL(request.url).searchParams
  const type = params.get('type')
  if (type !== null && !FEEDBACK_TYPES.includes(type as FeedbackType)) {
    return Response.json({ error: 'Query parameter "type" must be helpful or wrong_category' }, { status: 400 })
  }
  return Response.json({ feedback: await new FeedbackRepository(db).listRecentForAdmin(
    parseLimit(params.get('limit')), type === null ? undefined : type as FeedbackType,
  ) } satisfies AdminFeedbackResponse)
}
