import type { HealthResponse } from '../shared/api'

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/api/v1/health') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
      }
      return Response.json({ ok: true, phase: 1 } satisfies HealthResponse)
    }
    // Unknown API paths must never fall through to the SPA (including admin).
    return Response.json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler
