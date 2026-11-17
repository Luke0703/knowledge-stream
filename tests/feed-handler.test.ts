// Feed handler tests with a D1 stub. The stub records the SQL text and the
// bound parameters, which is what proves binding is used and the enabled
// filter is in the query; it returns canned rows instead of executing SQL.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import worker from '../worker'
import { handleFeed } from '../worker/feed/handler'

interface RecordedCall {
  sql: string
  params: unknown[]
}

const videoRow = {
  id: '48dba56f-3271-4bb9-b59e-dca27c7221c0',
  platform: 'youtube',
  external_video_id: 'pgGrQjYcm5A',
  label: 'ピザで円周率を考える',
}
const categoryRow = { video_id: videoRow.id, name: '数学' }

function createDbStub(videos: unknown[] = [videoRow], categories: unknown[] = [categoryRow]) {
  const calls: RecordedCall[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params })
          return {
            async all() {
              return { results: sql.includes('FROM videos') ? videos : categories }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, calls }
}

describe('GET /api/v1/feed', () => {
  it('returns unfiltered shared DTOs with enabled category names', async () => {
    const { db, calls } = createDbStub()
    const response = await handleFeed(new Request('http://localhost/api/v1/feed'), db)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      categories: [],
      limit: 20,
      results: [{
        id: videoRow.id,
        platform: 'youtube',
        externalVideoId: 'pgGrQjYcm5A',
        label: 'ピザで円周率を考える',
        categories: ['数学'],
      }],
    })
    expect(calls).toHaveLength(2)
    expect(calls[0].params).toEqual([20])
    expect(calls[0].sql).toContain('v.enabled = 1')
    expect(calls[0].sql).toContain('ORDER BY v.created_at ASC, v.id ASC')
    expect(calls[0].sql).toContain('LIMIT ?')
    expect(calls[0].sql).not.toContain('EXISTS')
    expect(calls[1].sql).toContain('c.enabled = 1')
    expect(calls[1].sql).toContain('ORDER BY c.name ASC')
    expect(calls[1].params).toEqual([videoRow.id])
  })

  it('binds category ids with OR semantics instead of interpolating them', async () => {
    const { db, calls } = createDbStub()
    const ids = ['category-math', "category-science' OR 1=1--"]
    const categories = encodeURIComponent(` ${ids[0]},${ids[1]},${ids[0]}, `)
    const response = await handleFeed(new Request(`http://localhost/api/v1/feed?categories=${categories}`), db)
    expect(await response.json()).toMatchObject({ categories: ids, limit: 20 })
    expect(calls[0].params).toEqual([...ids, 20])
    for (const id of ids) expect(calls[0].sql).not.toContain(id)
    expect(calls[0].sql).toContain('v.enabled = 1')
    expect(calls[0].sql).toContain('c.enabled = 1')
    expect(calls[0].sql).toContain('EXISTS')
    expect(calls[0].sql).toContain('JOIN categories c ON c.id = vc.category_id')
    expect(calls[0].sql).toContain('vc.video_id = v.id')
    expect(calls[0].sql).toContain('vc.category_id IN (?, ?)')
  })

  it('clamps an excessive limit before binding it', async () => {
    const { db, calls } = createDbStub()
    const response = await handleFeed(new Request('http://localhost/api/v1/feed?limit=999'), db)
    expect(await response.json()).toMatchObject({ limit: 50 })
    expect(calls[0].params).toEqual([50])
  })

  it('rejects invalid category filters without touching the DB', async () => {
    const { db, calls } = createDbStub()
    for (const [categories, error] of [
      ['a'.repeat(65), 'Query parameter "categories" ids must be at most 64 characters'],
      [Array.from({ length: 51 }, (_, index) => `category-${index}`).join(','), 'Query parameter "categories" must contain at most 50 category ids'],
    ]) {
      const response = await handleFeed(new Request(`http://localhost/api/v1/feed?categories=${categories}`), db)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error })
    }
    expect(calls).toHaveLength(0)
  })

  it('returns an empty feed without fetching category names', async () => {
    const { db, calls } = createDbStub([])
    const response = await handleFeed(new Request('http://localhost/api/v1/feed'), db)
    expect(await response.json()).toEqual({ categories: [], limit: 20, results: [] })
    expect(calls).toHaveLength(1)
  })

  it('returns an empty category list for a video without enabled categories', async () => {
    const { db } = createDbStub([videoRow], [])
    const response = await handleFeed(new Request('http://localhost/api/v1/feed'), db)
    expect(await response.json()).toMatchObject({ results: [{ categories: [] }] })
  })

  it('rejects non-GET methods', async () => {
    const { db, calls } = createDbStub()
    const response = await handleFeed(new Request('http://localhost/api/v1/feed', { method: 'POST' }), db)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
    expect(await response.json()).toEqual({ error: 'Method not allowed' })
    expect(calls).toHaveLength(0)
  })

  it('is routed by the worker and fails closed when the DB binding is absent', async () => {
    const { db } = createDbStub()
    const ok = await worker.fetch(new Request('http://localhost/api/v1/feed'), { DB: db })
    expect(ok.status).toBe(200)
    for (const env of [undefined, {}]) {
      const unavailable = await worker.fetch(new Request('http://localhost/api/v1/feed'), env)
      expect(unavailable.status).toBe(500)
      expect(await unavailable.json()).toEqual({ error: 'Feed are unavailable' })
    }
  })
})
