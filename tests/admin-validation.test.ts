// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseAdminVideoCreate as create, parseAdminVideoUpdate as update,
  parseAdminCategoryCreate as category, parseAdminCategoryUpdate as categoryUpdate } from '../worker/admin/validation'

const id = 'a0000000-0000-4000-8000-000000000001'
const base = { url: 'abcdefghijk', label: ' Label ' }

describe('admin validation (SPEC section 6)', () => {
  it.each(['abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk', 'https://youtube.com/shorts/abcdefghijk'])('extracts %s', url => {
    expect(create({ ...base, url })).toEqual({ ok: true, value: {
      externalVideoId: 'abcdefghijk', label: 'Label', searchKeywords: null, categoryIds: [], enabled: true, availabilityStatus: 'active',
    } })
  })
  it('normalizes keywords and deduplicates genres in order', () => {
    expect(create({ ...base, searchKeywords: '  ', categoryIds: [id, id] })).toMatchObject({ ok: true, value: { searchKeywords: null, categoryIds: [id] } })
    expect(update({ searchKeywords: ' test ' })).toEqual({ ok: true, value: { searchKeywords: 'test' } })
    expect(update({ searchKeywords: null })).toEqual({ ok: true, value: { searchKeywords: null } })
  })
  it.each([null, [], 'bad', {}, { ...base, url: 'garbage' }, { ...base, url: 2 },
    { ...base, label: '' }, { ...base, label: 'x'.repeat(201) }, { ...base, label: 3 },
    { ...base, searchKeywords: 4 }, { ...base, searchKeywords: 'x'.repeat(501) },
    { ...base, categoryIds: [id, 'bad'] }, { ...base, categoryIds: Array(51).fill(id) },
    { ...base, categoryIds: 'bad' }, { ...base, enabled: 1 }, { ...base, availabilityStatus: 'bad' },
  ])('rejects invalid video %j', body => { expect(create(body).ok).toBe(false) })
  it.each(['active', 'under_review', 'unavailable'])('accepts status %s', availabilityStatus => {
    expect(update({ availabilityStatus }).ok).toBe(true)
  })
  it('accepts text boundaries', () => {
    for (const length of [1, 200]) expect(create({ ...base, label: 'x'.repeat(length) }).ok).toBe(true)
    expect(create({ ...base, searchKeywords: 'x'.repeat(500) }).ok).toBe(true)
    expect(create({ ...base, categoryIds: Array(50).fill(id) }).ok).toBe(true)
    for (const length of [1, 100]) expect(category({ name: 'x'.repeat(length) }).ok).toBe(true)
  })
  it.each([{}, { url: base.url }])('requires updatable fields %j', body => {
    expect(update(body)).toEqual({ ok: false, error: 'No updatable fields provided' })
    expect(categoryUpdate(body)).toEqual({ ok: false, error: 'No updatable fields provided' })
  })
  it('creates and updates categories', () => {
    expect(category({ name: ' Math ' })).toEqual({ ok: true, value: { name: 'Math', enabled: true } })
    expect(categoryUpdate({ enabled: false })).toEqual({ ok: true, value: { enabled: false } })
  })
  it.each([null, [], {}, { name: '' }, { name: 'x'.repeat(101) }, { name: 3 }, { name: 'ok', enabled: 1 }])('rejects category %j', body => {
    expect(category(body).ok).toBe(false)
  })
  it.each([{ label: '' }, { enabled: 'true' }, { categoryIds: [3] }, { searchKeywords: false }, { availabilityStatus: null }])('validates patch %j', body => {
    expect(update(body).ok).toBe(false)
  })
})
