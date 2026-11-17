import { describe, expect, it } from 'vitest'
import { orderFeedVideos } from '../src/feed/order'

const videos = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id }))
const options = { viewedIds: new Set<string>(), notInterestedIds: new Set<string>(), random: () => 0.99 }

describe('orderFeedVideos', () => {
  it('excludes not-interested videos even when viewed', () => {
    expect(orderFeedVideos(videos, { ...options, viewedIds: new Set(['a']), notInterestedIds: new Set(['a', 'b']) }).map(v => v.id)).toEqual(['c', 'd', 'e', 'f'])
  })

  it('puts every unviewed video before viewed videos', () => {
    expect(orderFeedVideos(videos, { ...options, viewedIds: new Set(['a', 'c', 'e']) }).map(v => v.id)).toEqual(['b', 'd', 'f', 'a', 'c', 'e'])
  })

  it('shuffles both partitions with a scripted random sequence', () => {
    const sequence = [0, 0.75, 0.5, 0]
    let index = 0
    const result = orderFeedVideos(videos, { ...options, viewedIds: new Set(['d', 'e', 'f']), random: () => sequence[index++] })
    expect(result.map(v => v.id)).toEqual(['c', 'b', 'a', 'f', 'd', 'e'])
    expect(index).toBe(4)
  })

  it('does not mutate the input array or its elements', () => {
    const input = Object.freeze(videos.map(video => Object.freeze({ ...video })))
    const result = orderFeedVideos(input, { ...options, random: () => 0 })
    expect(input.map(v => v.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(result).not.toBe(input)
    expect(result.every(video => input.includes(video))).toBe(true)
  })

  it('returns an empty array for empty input', () => {
    expect(orderFeedVideos([], options)).toEqual([])
  })

  it.each([{ viewed: [] }, { viewed: ['a', 'b', 'c', 'd', 'e', 'f'] }])('shuffles when viewed ids are $viewed', ({ viewed }) => {
    expect(orderFeedVideos(videos, { ...options, viewedIds: new Set(viewed), random: () => 0 }).map(v => v.id)).toEqual(['b', 'c', 'd', 'e', 'f', 'a'])
  })
})
