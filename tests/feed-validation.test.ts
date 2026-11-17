import { describe, expect, it } from 'vitest'
import {
  MAX_CATEGORY_ID_LENGTH,
  MAX_CATEGORY_IDS,
  parseCategoryIds,
} from '../worker/feed/validation'

describe('parseCategoryIds', () => {
  it('accepts a missing filter', () => {
    expect(parseCategoryIds(null)).toEqual({ ok: true, ids: [] })
  })

  it('accepts an empty filter', () => {
    expect(parseCategoryIds('')).toEqual({ ok: true, ids: [] })
  })

  it('drops whitespace and empty comma-separated tokens', () => {
    expect(parseCategoryIds(' , ,  , ')).toEqual({ ok: true, ids: [] })
  })

  it('trims each category id', () => {
    expect(parseCategoryIds(' math , science , ')).toEqual({ ok: true, ids: ['math', 'science'] })
  })

  it('deduplicates while preserving first-seen order', () => {
    expect(parseCategoryIds('science,math, science,math')).toEqual({ ok: true, ids: ['science', 'math'] })
    expect(parseCategoryIds(Array(51).fill('math').join(','))).toEqual({ ok: true, ids: ['math'] })
  })

  it('accepts exactly the maximum id length and rejects longer input', () => {
    expect(parseCategoryIds('a'.repeat(MAX_CATEGORY_ID_LENGTH)).ok).toBe(true)
    expect(parseCategoryIds('a'.repeat(MAX_CATEGORY_ID_LENGTH + 1))).toEqual({
      ok: false,
      error: 'Query parameter "categories" ids must be at most 64 characters',
    })
  })

  it('accepts exactly the maximum number of ids and rejects more', () => {
    const ids = Array.from({ length: MAX_CATEGORY_IDS }, (_, index) => `category-${index}`)
    expect(parseCategoryIds(ids.join(','))).toEqual({ ok: true, ids })
    expect(parseCategoryIds([...ids, 'extra'].join(','))).toEqual({
      ok: false,
      error: 'Query parameter "categories" must contain at most 50 category ids',
    })
  })
})
