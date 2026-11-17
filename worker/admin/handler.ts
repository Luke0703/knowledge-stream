import { authenticateAdmin } from './access'
import type { AccessEnv, AccessVerifyDeps } from './access'
import { handleAdminCategoriesCollection, handleAdminCategoryItem } from './categories'
import { handleAdminFeedback } from './feedback'
import { handleAdminVideoItem, handleAdminVideosCollection } from './videos'

export interface AdminEnv extends AccessEnv { DB?: D1Database }

/** Protect every admin route before dispatch, including unknown paths (SPEC section 6). */
export async function handleAdmin(request: Request, env: AdminEnv, deps: AccessVerifyDeps = {}): Promise<Response> {
  if (!env.DB) return Response.json({ error: 'Admin is unavailable' }, { status: 500 })
  const auth = await authenticateAdmin(request, env, deps)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const origin = request.headers.get('Origin')
  if (request.method !== 'GET' && origin !== null) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) throw new Error('Origin mismatch')
    } catch {
      return Response.json({ error: 'Forbidden origin' }, { status: 403 })
    }
  }
  const path = new URL(request.url).pathname
  if (path === '/api/v1/admin/videos') return handleAdminVideosCollection(request, env.DB)
  const video = /^\/api\/v1\/admin\/videos\/([^/]+)$/.exec(path)
  if (video) return handleAdminVideoItem(request, env.DB, video[1])
  if (path === '/api/v1/admin/categories') return handleAdminCategoriesCollection(request, env.DB)
  const category = /^\/api\/v1\/admin\/categories\/([^/]+)$/.exec(path)
  if (category) return handleAdminCategoryItem(request, env.DB, category[1])
  if (path === '/api/v1/admin/feedback') return handleAdminFeedback(request, env.DB)
  return Response.json({ error: 'Not found' }, { status: 404 })
}
