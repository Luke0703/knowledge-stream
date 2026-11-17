import type { FeedResponse } from '../../shared/api'
import { VideoRepository } from '../repositories/VideoRepository'
import { parseLimit } from '../search/validation'
import { parseCategoryIds } from './validation'

/**
 * `GET /api/v1/feed?categories=...&limit=...` (SPEC sections 3 and 7).
 * Validates input on the server, delegates all SQL to VideoRepository and
 * answers with the shared DTO only.
 */
export async function handleFeed(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
  }
  const params = new URL(request.url).searchParams
  const validated = parseCategoryIds(params.get('categories'))
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 })
  }
  const limit = parseLimit(params.get('limit'))
  const videos = await new VideoRepository(db).listFeedVideos(validated.ids, limit)
  const body: FeedResponse = {
    categories: validated.ids,
    limit,
    results: videos.map(video => ({
      id: video.id,
      platform: video.platform,
      externalVideoId: video.externalVideoId,
      label: video.label,
      categories: video.categories,
    })),
  }
  return Response.json(body)
}
