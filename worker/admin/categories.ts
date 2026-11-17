import type { AdminCategoriesResponse } from '../../shared/api'
import { UUID_REGEX } from '../feedback/validation'
import { CategoryRepository } from '../repositories/CategoryRepository'
import { parseAdminCategoryCreate, parseAdminCategoryUpdate } from './validation'

/** Admin genre management (SPEC sections 6 and 7). */
export async function handleAdminCategoriesCollection(request: Request, db: D1Database, now: Date = new Date()): Promise<Response> {
  const repository = new CategoryRepository(db)
  if (request.method === 'GET') {
    return Response.json({ categories: await repository.listAdminCategories() } satisfies AdminCategoriesResponse)
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } })
  }
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  const parsed = parseAdminCategoryCreate(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const id = crypto.randomUUID()
  await repository.createCategory({ ...parsed.value, id, createdAt: now.toISOString(), updatedAt: now.toISOString() })
  return Response.json(await repository.findAdminCategoryById(id), { status: 201 })
}

export async function handleAdminCategoryItem(request: Request, db: D1Database, id: string, now: Date = new Date()): Promise<Response> {
  if (request.method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'PATCH' } })
  }
  const repository = new CategoryRepository(db)
  if (!UUID_REGEX.test(id) || !await repository.findAdminCategoryById(id)) {
    return Response.json({ error: 'Category not found' }, { status: 404 })
  }
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  const parsed = parseAdminCategoryUpdate(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  await repository.updateCategory(id, { ...parsed.value, updatedAt: now.toISOString() })
  return Response.json(await repository.findAdminCategoryById(id))
}
