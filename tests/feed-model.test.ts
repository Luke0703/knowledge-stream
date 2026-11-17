import { describe, expect, it } from 'vitest'
import type { FeedVideoDto, SearchVideoDto } from '../shared/api'
import { feedVideoFromDto } from '../src/feed/model'

describe('feedVideoFromDto', () => {
  it.each(['feed', 'search'])('maps a %s DTO and copies categories', () => {
    const dto: FeedVideoDto | SearchVideoDto = {
      id: 'internal-id', platform: 'youtube', externalVideoId: 'youtube-id', label: '独自ラベル', categories: ['数学', '物理'],
    }
    const video = feedVideoFromDto(dto)
    expect(video).toEqual({ id: dto.id, externalVideoId: dto.externalVideoId, label: dto.label, categories: dto.categories })
    expect(video.categories).not.toBe(dto.categories)
    video.categories.push('ものづくり')
    expect(dto.categories).toEqual(['数学', '物理'])
  })
})
