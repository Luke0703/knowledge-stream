// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import worker from '../worker'
import { createFakeD1 } from './fake-d1'
import { createAccessTestKeys, validClaims, TEST_ISSUER, TEST_AUD } from './access-test-utils'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** SPEC section 9: admin changes immediately affect anonymous discovery. */
it('reflects video and genre mutations in public feed and search', async () => {
  const issuer = await createAccessTestKeys()
  const token = await issuer.sign(validClaims())
  const db = createFakeD1(readFileSync(new URL('../seeds/0001_local_sample_videos.sql', import.meta.url), 'utf8'))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe(`${TEST_ISSUER}/cdn-cgi/access/certs`)
    return Response.json(issuer.jwks)
  }))
  const env = { DB: db, ACCESS_TEAM_DOMAIN: TEST_ISSUER, ACCESS_AUD: TEST_AUD }
  async function admin(path: string, method: string, body: unknown) {
    const response = await worker.fetch(new Request(`https://example.com/api/v1/admin${path}`, {
      method, headers: { 'Cf-Access-Jwt-Assertion': token }, body: JSON.stringify(body),
    }), env)
    expect(response.status).toBe(method === 'POST' ? 201 : 200)
    return response.json()
  }
  async function publicResults(path: string) {
    const response = await worker.fetch(new Request(`https://example.com/api/v1/${path}`), env)
    expect(response.status).toBe(200)
    return (await response.json()).results
  }
  const video = await admin('/videos', 'POST', { url: 'abcdefghijk', label: 'Discovery', searchKeywords: 'uniquekeyword',
    categoryIds: ['a0000000-0000-4000-8000-000000000001'] })
  for (const path of ['feed', 'search?q=uniquekeyword']) {
    expect(await publicResults(path)).toEqual(expect.arrayContaining([expect.objectContaining({ id: video.id })]))
  }
  await admin(`/videos/${video.id}`, 'PATCH', { enabled: false })
  for (const path of ['feed', 'search?q=uniquekeyword']) {
    expect(await publicResults(path)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: video.id })]))
  }
  const category = await admin('/categories', 'POST', { name: 'New genre' })
  await admin(`/videos/${video.id}`, 'PATCH', { enabled: true, categoryIds: [category.id] })
  expect(await publicResults('feed')).toEqual(expect.arrayContaining([expect.objectContaining({ id: video.id, categories: ['New genre'] })]))
  await admin(`/categories/${category.id}`, 'PATCH', { enabled: false })
  expect(await publicResults('feed')).toEqual(expect.arrayContaining([expect.objectContaining({ id: video.id, categories: [] })]))
})
