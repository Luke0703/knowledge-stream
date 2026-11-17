import { expect, it, vi } from 'vitest'
import { submitFeedback } from '../src/feedback/submitFeedback'

const input = { videoId: 'video', feedbackType: 'helpful' as const, clientId: 'client' }

it('posts the feedback body and accepts a 201 response', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ recorded: true }), { status: 201 }))
  expect(await submitFeedback(input, fetchImpl)).toEqual({ ok: true, duplicate: false })
  expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('/api/v1/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
})

it('accepts an idempotent duplicate response', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ recorded: true, duplicate: true }), { status: 200 }))
  expect(await submitFeedback(input, fetchImpl)).toEqual({ ok: true, duplicate: true })
})

it('rejects a 429 response', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ recorded: true }), { status: 429 }))
  expect(await submitFeedback(input, fetchImpl)).toEqual({ ok: false, duplicate: false })
})

it('contains network errors', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
  expect(await submitFeedback(input, fetchImpl)).toEqual({ ok: false, duplicate: false })
})

it.each(['{', 'null', '[]', '{}', '{"recorded":false}', '{"recorded":"true"}'])('rejects malformed or unaccepted bodies: %s', body => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
  return expect(submitFeedback(input, fetchImpl)).resolves.toEqual({ ok: false, duplicate: false })
})
