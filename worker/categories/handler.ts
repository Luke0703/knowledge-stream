import type { CategoriesResponse } from '../../shared/api'
import { CategoryRepository } from '../repositories/CategoryRepository'

/**
 * `GET /api/v1/categories` (SPEC section 7).
 * Delegates all SQL to CategoryRepository and answers with the shared DTO only.
 */
export async function handleCategories(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
  }
  const body: CategoriesResponse = {
    categories: await new CategoryRepository(db).listEnabledCategories(),
  }
  return Response.json(body)
}
