import { handleAdmin } from './admin/handler'
import type { HealthResponse } from '../shared/api'
import { handleCategories } from './categories/handler'
import { handleFeed } from './feed/handler'
import { handleFeedback } from './feedback/handler'
import { handleSearch } from './search/handler'

export interface Env {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ACCESS_ADMIN_EMAILS?: string
  DB?: D1Database
  FEEDBACK_HMAC_SECRET?: string
}

export default {
  async fetch(request: Request, env?: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/api/v1/health') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
      }
      return Response.json({ ok: true, phase: 1 } satisfies HealthResponse)
    }
    if (path === '/api/v1/search') {
      // Fail closed with a JSON error when the D1 binding is missing instead
      // of falling through to the SPA or throwing an opaque 500.
      if (!env?.DB) {
        return Response.json({ error: 'Search is unavailable' }, { status: 500 })
      }
      return handleSearch(request, env.DB)
    }
    if (path === '/api/v1/categories') {
      // Fail closed with a JSON error when the D1 binding is missing.
      if (!env?.DB) {
        return Response.json({ error: 'Categories are unavailable' }, { status: 500 })
      }
      return handleCategories(request, env.DB)
    }
    if (path === '/api/v1/feed') {
      // Fail closed with a JSON error when the D1 binding is missing.
      if (!env?.DB) {
        return Response.json({ error: 'Feed are unavailable' }, { status: 500 })
      }
      return handleFeed(request, env.DB)
    }
    if (path === '/api/v1/feedback') {
      if (!env?.DB || !env.FEEDBACK_HMAC_SECRET) {
        return Response.json({ error: 'Feedback is unavailable' }, { status: 500 })
      }
      return handleFeedback(request, env.DB, env.FEEDBACK_HMAC_SECRET)
    }
    if (path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')) return handleAdmin(request, env ?? {})
    // Unknown API paths must never fall through to the SPA (including admin).
    return Response.json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
