import type { FeedVideoDto, SearchVideoDto } from '../../shared/api'

export interface FeedVideo {
  id: string
  externalVideoId: string
  label: string
  /** Names of the enabled genres this video belongs to (DTO carries names, not ids). */
  categories: string[]
}

export function feedVideoFromDto(dto: FeedVideoDto | SearchVideoDto): FeedVideo {
  return {
    id: dto.id,
    externalVideoId: dto.externalVideoId,
    label: dto.label,
    categories: [...dto.categories],
  }
}
