// Feedback handler tests record SQL and bindings, using canned D1 results.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import worker from '../worker'
import { hashClientId } from '../worker/feedback/clientHash'
import { FEEDBACK_RATE_LIMIT, FEEDBACK_RATE_WINDOW_MS, handleFeedback } from '../worker/feedback/handler'

interface RecordedCall {
  sql: string
  params: unknown[]
}

const body = {
  videoId: '48dba56f-3271-4bb9-b59e-dca27c7221c0',
  feedbackType: 'helpful',
  clientId: 'b1753cd5-a024-4d2c-8b47-a96e2e963b31',
}
const secret = 'feedback-test-secret'
const now = new Date('2026-11-17T12:00:00.000Z')

function request(value: unknown = body) {
  return new Request('http://localhost/api/v1/feedback', {
    method: 'POST', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' },
  })
}

function createDbStub(options: { video?: boolean; duplicate?: boolean; count?: number; changes?: number } = {}) {
  const calls: RecordedCall[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params })
          return {
            async first() {
              if (sql.startsWith('SELECT 1 FROM videos')) return options.video === false ? null : { '1': 1 }
              if (sql.startsWith('SELECT 1 FROM feedback')) return options.duplicate ? { '1': 1 } : null
              if (sql.startsWith('SELECT COUNT(*) AS count FROM feedback')) return { count: options.count ?? 0 }
              throw new Error(`Unexpected select: ${sql}`)
            },
            async run() {
              if (!sql.startsWith('INSERT OR IGNORE INTO feedback')) throw new Error(`Unexpected insert: ${sql}`)
              return { meta: { changes: options.changes ?? 1 } }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, calls }
}

describe('POST /api/v1/feedback', () => {
  it('rejects GET with Allow: POST', async () => {
    const { db, calls } = createDbStub()
    const response = await handleFeedback(new Request('http://localhost/api/v1/feedback'), db, secret, now)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(await response.json()).toEqual({ error: 'Method not allowed' })
    expect(calls).toHaveLength(0)
  })

  it('rejects invalid JSON before querying D1', async () => {
    const { db, calls } = createDbStub()
    const response = await handleFeedback(new Request('http://localhost/api/v1/feedback', {
      method: 'POST', body: '{',
    }), db, secret, now)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Request body must be valid JSON' })
    expect(calls).toHaveLength(0)
  })

  it('rejects invalid fields before querying D1', async () => {
    const { db, calls } = createDbStub()
    const response = await handleFeedback(request({ ...body, videoId: 'bad' }), db, secret, now)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Field "videoId" must be a UUID' })
    expect(calls).toHaveLength(0)
  })

  it('returns 404 for a missing or disabled video', async () => {
    const { db, calls } = createDbStub({ video: false })
    const response = await handleFeedback(request(), db, secret, now)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Video not found' })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('WHERE id = ? AND enabled = 1 LIMIT 1')
    expect(calls[0].params).toEqual([body.videoId])
  })

  it('records a first submission with only a bound HMAC hash', async () => {
    const { db, calls } = createDbStub()
    const response = await handleFeedback(request(), db, secret, now)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ recorded: true, duplicate: false })
    expect(calls).toHaveLength(4)
    const hash = await hashClientId(body.clientId, secret)
    expect(hash).not.toBe(body.clientId)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(calls[0].params).toEqual([body.videoId])
    expect(calls[1].sql).toContain('video_id = ? AND client_hash = ? AND feedback_type = ? LIMIT 1')
    expect(calls[1].params).toEqual([body.videoId, hash, body.feedbackType])
    expect(calls[2].sql).toContain('WHERE client_hash = ? AND created_at >= ?')
    expect(calls[2].params).toEqual([hash, new Date(now.getTime() - FEEDBACK_RATE_WINDOW_MS).toISOString()])
    expect(calls[3].sql).toContain('VALUES (?, ?, ?, ?, ?)')
    expect(calls[3].params).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), body.videoId, hash, body.feedbackType, now.toISOString()])
    for (const call of calls) {
      expect(call.sql).toContain('?')
      for (const value of [body.videoId, body.clientId, hash, secret, now.toISOString()]) {
        expect(call.sql).not.toContain(value)
      }
      expect(call.params).not.toContain(body.clientId)
      expect(call.params).not.toContain(secret)
    }
  })

  it('returns an existing duplicate before checking the rate limit', async () => {
    const { db, calls } = createDbStub({ duplicate: true, count: FEEDBACK_RATE_LIMIT })
    const response = await handleFeedback(request(), db, secret, now)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ recorded: true, duplicate: true })
    expect(calls).toHaveLength(2)
  })

  it('returns a duplicate when a concurrent insert wins', async () => {
    const { db, calls } = createDbStub({ changes: 0 })
    const response = await handleFeedback(request(), db, secret, now)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ recorded: true, duplicate: true })
    expect(calls).toHaveLength(4)
  })

  it.each([FEEDBACK_RATE_LIMIT, FEEDBACK_RATE_LIMIT + 1])('rate limits a count of %s', async count => {
    const { db, calls } = createDbStub({ count })
    const response = await handleFeedback(request(), db, secret, now)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.json()).toEqual({ error: 'Too many requests' })
    expect(calls).toHaveLength(3)
  })

  it('accepts feedback just below the rate limit', async () => {
    const { db } = createDbStub({ count: FEEDBACK_RATE_LIMIT - 1 })
    const response = await handleFeedback(request(), db, secret, now)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ recorded: true, duplicate: false })
  })

  it('hashes the same input stably and different client ids differently', async () => {
    const hash = await hashClientId(body.clientId, secret)
    expect(await hashClientId(body.clientId, secret)).toBe(hash)
    expect(await hashClientId('3b8a9d90-54cf-41eb-a73b-34936c593247', secret)).not.toBe(hash)
    expect(await hashClientId(body.clientId, 'different-test-secret')).not.toBe(hash)
  })

  it('is routed by the worker and fails closed without the DB or secret', async () => {
    const { db } = createDbStub()
    const response = await worker.fetch(request(), { DB: db, FEEDBACK_HMAC_SECRET: secret })
    expect(response.status).toBe(201)
    for (const env of [undefined, {}, { DB: db }, { FEEDBACK_HMAC_SECRET: secret }, { DB: db, FEEDBACK_HMAC_SECRET: '' }]) {
      const unavailable = await worker.fetch(request(), env)
      expect(unavailable.status).toBe(500)
      expect(await unavailable.json()).toEqual({ error: 'Feedback is unavailable' })
    }
  })
})
