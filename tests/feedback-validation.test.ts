// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseFeedbackBody } from '../worker/feedback/validation'

const body = {
  videoId: '48dba56f-3271-4bb9-b59e-dca27c7221c0',
  feedbackType: 'helpful',
  clientId: 'b1753cd5-a024-4d2c-8b47-a96e2e963b31',
}

describe('parseFeedbackBody', () => {
  it.each(['helpful', 'wrong_category'])('accepts %s feedback', feedbackType => {
    const value = { ...body, feedbackType }
    expect(parseFeedbackBody(value)).toEqual({ ok: true, value })
  })

  it.each([null, [], 'body', 1, true, undefined])('rejects non-object body %j', value => {
    expect(parseFeedbackBody(value)).toEqual({ ok: false, error: 'Request body must be an object' })
  })

  it.each(['videoId', 'clientId', 'feedbackType'])('rejects missing %s', field => {
    const value: Record<string, unknown> = { ...body }
    delete value[field]
    expect(parseFeedbackBody(value)).toEqual({ ok: false, error: `Field "${field}" must be a string` })
  })

  it.each(['videoId', 'clientId', 'feedbackType'])('rejects non-string %s', field => {
    for (const value of [null, 1, [], {}]) {
      expect(parseFeedbackBody({ ...body, [field]: value })).toEqual({
        ok: false, error: `Field "${field}" must be a string`,
      })
    }
  })

  it.each(['videoId', 'clientId'])('rejects invalid UUID in %s', field => {
    for (const value of ['', 'not-a-uuid', `${body.videoId}extra`, ` ${body.videoId}`]) {
      expect(parseFeedbackBody({ ...body, [field]: value })).toEqual({
        ok: false, error: `Field "${field}" must be a UUID`,
      })
    }
  })

  it('rejects unknown feedback types', () => {
    expect(parseFeedbackBody({ ...body, feedbackType: 'saved' })).toEqual({
      ok: false, error: 'Field "feedbackType" must be helpful or wrong_category',
    })
  })
})
