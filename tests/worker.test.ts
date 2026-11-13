// Pure handler tests; the real workerd/Static Assets smoke test is documented separately.
// @vitest-environment node
import { expect, it } from 'vitest'
import worker from '../worker'

it('serves a versioned health DTO and rejects writes', async () => {
  const response = await worker.fetch(new Request('http://localhost/api/v1/health'))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, phase: 1 })
  const rejected = await worker.fetch(new Request('http://localhost/api/v1/health', { method: 'POST' }))
  expect(rejected.status).toBe(405)
  expect(rejected.headers.get('Allow')).toBe('GET')
})

it.each(['/api/v1/admin/videos', '/api/v1/feedback', '/api/v1/feed', '/api/unknown'])('does not implement %s or return SPA HTML', async path => {
  const response = await worker.fetch(new Request(`http://localhost${path}`))
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not found' })
})
