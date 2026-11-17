import type { FeedbackResponse } from '../../shared/api'
import { FeedbackRepository } from '../repositories/FeedbackRepository'
import { VideoRepository } from '../repositories/VideoRepository'
import { hashClientId } from './clientHash'
import { parseFeedbackBody } from './validation'

export const FEEDBACK_RATE_LIMIT = 20
export const FEEDBACK_RATE_WINDOW_MS = 60_000

/** Anonymous feedback with HMAC persistence, deduplication and rate limiting. */
export async function handleFeedback(
  request: Request, db: D1Database, secret: string, now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  const validated = parseFeedbackBody(body)
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 })
  }
  const { videoId, feedbackType, clientId } = validated.value
  const clientHash = await hashClientId(clientId, secret)
  if (!await new VideoRepository(db).existsEnabledVideo(videoId)) {
    return Response.json({ error: 'Video not found' }, { status: 404 })
  }
  const repository = new FeedbackRepository(db)
  if (await repository.exists(videoId, clientHash, feedbackType)) {
    return Response.json({ recorded: true, duplicate: true } satisfies FeedbackResponse)
  }
  const sinceIso = new Date(now.getTime() - FEEDBACK_RATE_WINDOW_MS).toISOString()
  if (await repository.countSince(clientHash, sinceIso) >= FEEDBACK_RATE_LIMIT) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }
  const inserted = await repository.insertIgnore({
    id: crypto.randomUUID(), videoId, clientHash, feedbackType, createdAt: now.toISOString(),
  })
  return Response.json(
    { recorded: true, duplicate: !inserted } satisfies FeedbackResponse,
    { status: inserted ? 201 : 200 },
  )
}
