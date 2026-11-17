import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_STATE_STORAGE_KEY, emptyClientState, loadClientState, saveClientState,
  withSelectedCategoryIds, withViewed, withSavedToggled, withNotInterested,
  withClientId, withFeedbackSent, hasFeedbackSent,
  withoutViewed, withoutSaved, withoutNotInterested,
} from '../src/state/clientState'

const read = (value: unknown) => ({ getItem: () => JSON.stringify(value) })
const populated = () => ({ ...emptyClientState(), selectedCategoryIds: ['genre'], viewedVideoIds: ['viewed'], savedVideoIds: ['saved'], notInterestedVideoIds: ['rejected'] })

describe('client state persistence', () => {
  it('defaults on empty storage and returns independent empty arrays', () => {
    expect(loadClientState({ getItem: () => null })).toEqual(emptyClientState())
    const first = emptyClientState()
    first.viewedVideoIds.push('id')
    expect(emptyClientState().viewedVideoIds).toEqual([])
  })

  it('saves and loads a versioned state', () => {
    let stored = ''
    const setItem = vi.fn((key: string, value: string) => { stored = value })
    saveClientState(populated(), { setItem })
    expect(setItem).toHaveBeenCalledWith(CLIENT_STATE_STORAGE_KEY, stored)
    expect(JSON.parse(stored)).toEqual({ version: 1, ...populated() })
    expect(loadClientState({ getItem: () => stored })).toEqual(populated())
  })

  it('defaults on corrupt JSON', () => {
    expect(loadClientState({ getItem: () => '{' })).toEqual(emptyClientState())
  })

  it.each([null, [], 'state', 12, { version: 2 }, { version: '1' }, {}])('defaults on invalid root or version: %j', value => {
    expect(loadClientState(read(value))).toEqual(emptyClientState())
  })

  it('filters non-string entries and deduplicates every list', () => {
    const mixed = ['id', null, 1, {}, 'id', 'other']
    expect(loadClientState(read({ version: 1, selectedCategoryIds: mixed, viewedVideoIds: mixed, savedVideoIds: mixed, notInterestedVideoIds: mixed }))).toEqual({
      ...emptyClientState(), selectedCategoryIds: ['id', 'other'], viewedVideoIds: ['id', 'other'], savedVideoIds: ['id', 'other'], notInterestedVideoIds: ['id', 'other'],
    })
  })

  it.each([null, 'wrong', 42, {}])('normalizes invalid field types: %j', value => {
    expect(loadClientState(read({ version: 1, selectedCategoryIds: value, viewedVideoIds: value, savedVideoIds: value, notInterestedVideoIds: value }))).toEqual(emptyClientState())
  })

  it('handles throwing storage', () => {
    expect(loadClientState({ getItem: () => { throw new Error('unavailable') } })).toEqual(emptyClientState())
    expect(() => saveClientState(populated(), { setItem: () => { throw new Error('quota') } })).not.toThrow()
  })

  it('handles a missing window and a throwing localStorage getter', () => {
    vi.stubGlobal('window', undefined)
    try {
      expect(loadClientState()).toEqual(emptyClientState())
      expect(() => saveClientState(populated())).not.toThrow()
      vi.stubGlobal('window', { get localStorage() { throw new Error('private mode') } })
      expect(loadClientState()).toEqual(emptyClientState())
      expect(() => saveClientState(populated())).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('client state updaters', () => {
  it('copies selected category ids and supports first-run reset', () => {
    const ids = ['genre']
    const state = withSelectedCategoryIds(emptyClientState(), ids)
    expect(state.selectedCategoryIds).toEqual(ids)
    expect(state.selectedCategoryIds).not.toBe(ids)
    expect(withSelectedCategoryIds(state, null).selectedCategoryIds).toBeNull()
  })

  it('adds viewed ids once and preserves the reference on duplicates', () => {
    const before = emptyClientState()
    const after = withViewed(before, 'id')
    expect(after).not.toBe(before)
    expect(after.viewedVideoIds).toEqual(['id'])
    expect(withViewed(after, 'id')).toBe(after)
  })

  it('toggles saved ids in both directions', () => {
    const before = emptyClientState()
    const saved = withSavedToggled(before, 'id')
    expect(saved.savedVideoIds).toEqual(['id'])
    const removed = withSavedToggled(saved, 'id')
    expect(removed).not.toBe(saved)
    expect(removed.savedVideoIds).toEqual([])
  })

  it('adds not-interested once, removes it from saved, and preserves other saves', () => {
    const before = { ...emptyClientState(), savedVideoIds: ['id', 'other'] }
    const after = withNotInterested(before, 'id')
    expect(after).not.toBe(before)
    expect(after.notInterestedVideoIds).toEqual(['id'])
    expect(after.savedVideoIds).toEqual(['other'])
    expect(withNotInterested(after, 'id')).toBe(after)
  })

  it.each([
    [withoutViewed, 'viewedVideoIds'],
    [withoutSaved, 'savedVideoIds'],
    [withoutNotInterested, 'notInterestedVideoIds'],
  ] as const)('clears only its own list (%s)', (clear, key) => {
    const before = populated()
    const after = clear(before)
    expect(after).not.toBe(before)
    expect(after).toEqual({ ...before, [key]: [] })
  })

  it('never mutates input state or arrays', () => {
    const before = populated()
    const snapshot = structuredClone(before)
    Object.values(before).forEach(Object.freeze)
    Object.freeze(before)
    withSelectedCategoryIds(before, ['other'])
    withViewed(before, 'new')
    withSavedToggled(before, 'saved')
    withSavedToggled(before, 'new')
    withNotInterested(before, 'saved')
    withoutViewed(before)
    withoutSaved(before)
    withoutNotInterested(before)
    expect(before).toEqual(snapshot)
  })
})

describe('anonymous feedback state', () => {
  it('roundtrips feedback fields with version 1', () => {
    const state = { ...emptyClientState(), clientId: 'client', feedbackHelpfulVideoIds: ['a'], feedbackWrongCategoryVideoIds: ['b'] }
    let stored = ''
    saveClientState(state, { setItem: (_key, value) => { stored = value } })
    expect(JSON.parse(stored).version).toBe(1)
    expect(loadClientState({ getItem: () => stored })).toEqual(state)
  })

  it('loads legacy payloads with feedback defaults', () => {
    expect(loadClientState(read({ version: 1, savedVideoIds: ['saved'] }))).toEqual({ ...emptyClientState(), savedVideoIds: ['saved'] })
  })

  it('defensively parses feedback fields', () => {
    expect(loadClientState(read({ version: 1, clientId: 42, feedbackHelpfulVideoIds: ['a', null, 'a'], feedbackWrongCategoryVideoIds: 'bad' }))).toEqual({ ...emptyClientState(), feedbackHelpfulVideoIds: ['a'] })
  })

  it('sets the client id immutably and preserves identical state', () => {
    const before = emptyClientState()
    const after = withClientId(before, 'client')
    expect(before.clientId).toBeNull()
    expect(after.clientId).toBe('client')
    expect(withClientId(after, 'client')).toBe(after)
  })

  it.each(['helpful', 'wrong_category'] as const)('records %s once without changing the other list', type => {
    const before = emptyClientState()
    const after = withFeedbackSent(before, 'video', type)
    const key = type === 'helpful' ? 'feedbackHelpfulVideoIds' : 'feedbackWrongCategoryVideoIds'
    const other = type === 'helpful' ? 'feedbackWrongCategoryVideoIds' : 'feedbackHelpfulVideoIds'
    expect(after[key]).toEqual(['video'])
    expect(before[key]).toEqual([])
    expect(after[other]).toBe(before[other])
    expect(withFeedbackSent(after, 'video', type)).toBe(after)
    expect(hasFeedbackSent(before, 'video', type)).toBe(false)
    expect(hasFeedbackSent(after, 'video', type)).toBe(true)
    expect(hasFeedbackSent(after, 'other', type)).toBe(false)
    expect(hasFeedbackSent(after, 'video', type === 'helpful' ? 'wrong_category' : 'helpful')).toBe(false)
  })
})
