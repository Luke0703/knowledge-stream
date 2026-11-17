// Categories handler tests with a D1 stub. The stub records the SQL text and
// bound parameters and returns canned rows instead of executing SQL.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import worker from '../worker'
import { handleCategories } from '../worker/categories/handler'

interface RecordedCall {
  sql: string
  params: unknown[]
}

const categoryRow = { id: '48dba56f-3271-4bb9-b59e-dca27c7221c0', name: '数学' }

function createDbStub(categories: unknown[] = [categoryRow]) {
  const calls: RecordedCall[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params })
          return {
            async all() {
              return { results: categories }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, calls }
}

describe('GET /api/v1/categories', () => {
  it('returns shared DTOs and selects only enabled categories in name and id order', async () => {
    const { db, calls } = createDbStub([{ ...categoryRow, enabled: 1 }])
    const response = await handleCategories(new Request('http://localhost/api/v1/categories'), db)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ categories: [categoryRow] })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('enabled = 1')
    expect(calls[0].sql).toContain('ORDER BY name ASC, id ASC')
    expect(calls[0].params).toEqual([])
  })

  it('returns an empty category list', async () => {
    const { db } = createDbStub([])
    const response = await handleCategories(new Request('http://localhost/api/v1/categories'), db)
    expect(await response.json()).toEqual({ categories: [] })
  })

  it('rejects non-GET methods', async () => {
    const { db, calls } = createDbStub()
    const response = await handleCategories(new Request('http://localhost/api/v1/categories', { method: 'POST' }), db)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
    expect(await response.json()).toEqual({ error: 'Method not allowed' })
    expect(calls).toHaveLength(0)
  })

  it('is routed by the worker and fails closed when the DB binding is absent', async () => {
    const { db } = createDbStub()
    const ok = await worker.fetch(new Request('http://localhost/api/v1/categories'), { DB: db })
    expect(ok.status).toBe(200)
    for (const env of [undefined, {}]) {
      const unavailable = await worker.fetch(new Request('http://localhost/api/v1/categories'), env)
      expect(unavailable.status).toBe(500)
      expect(await unavailable.json()).toEqual({ error: 'Categories are unavailable' })
    }
  })
})
