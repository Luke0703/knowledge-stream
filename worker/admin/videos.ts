import type { AdminVideosResponse } from '../../shared/api'
import { UUID_REGEX } from '../feedback/validation'
import { CategoryRepository } from '../repositories/CategoryRepository'
import { VideoRepository } from '../repositories/VideoRepository'
import { parseAdminVideoCreate, parseAdminVideoUpdate } from './validation'

async function unknownCategory(db: D1Database, ids: string[] = []): Promise<Response | null> {
  const existing = new Set(await new CategoryRepository(db).existingCategoryIds(ids))
  const missing = ids.find(id => !existing.has(id))
  return missing ? Response.json({ error: `Unknown category id: ${missing}` }, { status: 400 }) : null
}

/** Admin video mutations are validated before persistence (SPEC sections 4 and 6). */
export async function handleAdminVideosCollection(request: Request, db: D1Database, now: Date = new Date()): Promise<Response> {
  const repository = new VideoRepository(db)
  if (request.method === 'GET') {
    return Response.json({ videos: await repository.listAdminVideos() } satisfies AdminVideosResponse)
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } })
  }
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  const parsed = parseAdminVideoCreate(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const error = await unknownCategory(db, parsed.value.categoryIds)
  if (error) return error
  const id = crypto.randomUUID()
  try {
    await repository.createVideo({ ...parsed.value, id, createdAt: now.toISOString(), updatedAt: now.toISOString() })
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return Response.json({ error: 'Video already registered' }, { status: 409 })
    }
    throw error
  }
  return Response.json(await repository.findAdminVideoById(id), { status: 201 })
}

export async function handleAdminVideoItem(request: Request, db: D1Database, id: string, now: Date = new Date()): Promise<Response> {
  if (request.method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'PATCH' } })
  }
  const repository = new VideoRepository(db)
  if (!UUID_REGEX.test(id) || !await repository.findAdminVideoById(id)) {
    return Response.json({ error: 'Video not found' }, { status: 404 })
  }
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  const parsed = parseAdminVideoUpdate(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const { categoryIds, ...fields } = parsed.value
  const error = await unknownCategory(db, categoryIds)
  if (error) return error
  await repository.updateVideo(id, { ...fields, updatedAt: now.toISOString() }, categoryIds)
  return Response.json(await repository.findAdminVideoById(id))
}
