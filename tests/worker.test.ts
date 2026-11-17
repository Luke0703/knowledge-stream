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

it.each(['/api/v1/unknown', '/api/unknown'])('does not implement %s or return SPA HTML', async path => {
  const response = await worker.fetch(new Request(`http://localhost${path}`))
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not found' })
})

it('fails closed on /api/v1/feedback when D1 or the HMAC secret is not configured', async () => {
  const post = () => new Request('http://localhost/api/v1/feedback', { method: 'POST', body: '{}' })
  const noEnv = await worker.fetch(post())
  expect(noEnv.status).toBe(500)
  expect(await noEnv.json()).toEqual({ error: 'Feedback is unavailable' })
  const noSecret = await worker.fetch(post(), { DB: {} as D1Database })
  expect(noSecret.status).toBe(500)
  expect(await noSecret.json()).toEqual({ error: 'Feedback is unavailable' })
})

// SPEC section 6: admin routes fail closed when no environment is supplied.
it('fails closed on /api/v1/admin/videos without configuration', async () => {
  const response = await worker.fetch(new Request('http://localhost/api/v1/admin/videos'))
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Admin is unavailable' })
})
