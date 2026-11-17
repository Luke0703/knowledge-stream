// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import worker from '../worker'
import { createFakeD1 } from './fake-d1'
import { createAccessTestKeys, validClaims, TEST_ISSUER, TEST_AUD } from './access-test-utils'

let issuer: Awaited<ReturnType<typeof createAccessTestKeys>>
let db: D1Database
let token: string
const categoryId = 'a0000000-0000-4000-8000-000000000001'
const videoId = '48dba56f-3271-4bb9-b59e-dca27c7221c0'
const missingId = '00000000-0000-4000-8000-000000000000'
const config = { ACCESS_TEAM_DOMAIN: TEST_ISSUER, ACCESS_AUD: TEST_AUD }
function request(path = '/videos', method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.com/api/v1/admin${path}`, { method,
    headers: { 'Cf-Access-Jwt-Assertion': token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
}
function call(path = '/videos', method = 'GET', body?: unknown, headers?: Record<string, string>) {
  return worker.fetch(request(path, method, body, headers), { ...config, DB: db })
}
beforeAll(async () => { issuer = await createAccessTestKeys(); token = await issuer.sign(validClaims()) })
beforeEach(() => {
  db = createFakeD1(readFileSync(new URL('../seeds/0001_local_sample_videos.sql', import.meta.url), 'utf8'))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe(`${TEST_ISSUER}/cdn-cgi/access/certs`)
    return Response.json(issuer.jwks)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('admin routes (SPEC sections 4 and 6)', () => {
  it('fails closed for missing database, configuration and tokens', async () => {
    for (const env of [undefined, { DB: db }]) {
      const response = await worker.fetch(request(), env)
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Admin is unavailable' })
    }
    expect((await call('/videos', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': '' })).status).toBe(401)
  })
  it('rejects wrong signatures and allowlist misses', async () => {
    const wrong = await createAccessTestKeys()
    expect((await call('/videos', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await wrong.sign(validClaims(), { kid: issuer.kid }) })).status).toBe(401)
    expect((await worker.fetch(request(), { ...config, DB: db, ACCESS_ADMIN_EMAILS: 'other@example.com' })).status).toBe(403)
  })
  it('lists every seed video and its links', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    const { videos } = await response.json()
    expect(videos).toHaveLength(4)
    expect(videos.find((video: { enabled: boolean }) => !video.enabled).categoryIds).toEqual([categoryId])
  })
  it('creates, round-trips and rejects duplicates', async () => {
    const body = { url: 'abcdefghijk', label: 'New', searchKeywords: 'keyword', categoryIds: [categoryId] }
    const response = await call('/videos', 'POST', body)
    expect(response.status).toBe(201)
    const video = await response.json()
    expect(video).toMatchObject({ label: 'New', externalVideoId: 'abcdefghijk', enabled: true, categoryIds: [categoryId] })
    expect((await (await call()).json()).videos).toContainEqual(video)
    expect((await call('/videos', 'POST', body)).status).toBe(409)
  })
  it('rejects invalid input and origins', async () => {
    expect((await call('/videos', 'POST', { url: 'bad', label: 'New' })).status).toBe(400)
    const unknown = await call('/videos', 'POST', { url: 'abcdefghijk', label: 'New', categoryIds: [missingId] })
    expect(await unknown.json()).toEqual({ error: `Unknown category id: ${missingId}` })
    for (const Origin of ['https://other.example.com', 'null', 'invalid']) {
      expect((await call('/videos', 'POST', {}, { Origin })).status).toBe(403)
    }
    expect((await worker.fetch(new Request('https://example.com/api/v1/admin/videos', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token }, body: '{',
    }), { ...config, DB: db })).status).toBe(400)
  })
  it('patches metadata and replaces genre links', async () => {
    const response = await call(`/videos/${videoId}`, 'PATCH', { label: 'Edited', enabled: false, categoryIds: [] })
    expect(response.status).toBe(200)
    const video = await response.json()
    expect(video).toMatchObject({ label: 'Edited', enabled: false, categoryIds: [] })
    expect((await (await call()).json()).videos).toContainEqual(video)
    for (const id of [missingId, 'bad']) expect((await call(`/videos/${id}`, 'PATCH', {})).status).toBe(404)
  })
  it('creates duplicate category names and patches or toggles genres', async () => {
    const response = await call('/categories', 'POST', { name: '数学' })
    expect(response.status).toBe(201)
    const category = await response.json()
    const patch = await call(`/categories/${category.id}`, 'PATCH', { name: 'New genre', enabled: false })
    expect(patch.status).toBe(200)
    expect(await patch.json()).toMatchObject({ name: 'New genre', enabled: false })
    expect((await (await call('/categories')).json()).categories).toHaveLength(4)
    expect((await call(`/categories/${missingId}`, 'PATCH', {})).status).toBe(404)
  })
  it('lists recent feedback with type filtering and limits', async () => {
    for (const [id, type, date] of [['a', 'helpful', '2026-01-01'], ['b', 'wrong_category', '2026-01-02'], ['c', 'helpful', '2026-01-02']]) {
      await db.prepare('INSERT INTO feedback (id, video_id, client_hash, feedback_type, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, id === 'c' ? '4a995ef1-1cd7-414d-983b-a60f0dc97086' : videoId, 'fixed-hash', type, date).run()
    }
    expect((await (await call('/feedback')).json()).feedback.map((row: { id: string }) => row.id)).toEqual(['c', 'b', 'a'])
    expect((await (await call('/feedback?type=helpful&limit=1')).json()).feedback.map((row: { id: string }) => row.id)).toEqual(['c'])
    expect((await call('/feedback?type=invalid')).status).toBe(400)
  })
  it.each([['/videos', 'DELETE', 'GET, POST'], ['/categories', 'DELETE', 'GET, POST'], [`/videos/${videoId}`, 'GET', 'PATCH'], [`/categories/${categoryId}`, 'GET', 'PATCH'], ['/feedback', 'POST', 'GET']])('enforces methods %s', async (path, method, allow) => {
    const response = await call(path, method)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe(allow)
  })
  it('authenticates unknown admin routes before returning 404', async () => {
    expect((await call('/unknown')).status).toBe(404)
    expect((await call('/unknown', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': '' })).status).toBe(401)
  })
})
