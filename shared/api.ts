export interface HealthResponse {
  ok: true
  phase: 1
}

/**
 * One search hit from `GET /api/v1/search` (SPEC section 2.4).
 * Carries only what the client needs to open the video; never a raw D1 row.
 */
export interface SearchVideoDto {
  /** Knowledge Stream internal UUID (distinct from the YouTube video id). */
  id: string
  platform: string
  externalVideoId: string
  /** Our own description label, not the official YouTube title. */
  label: string
  /** Names of the enabled genres (categories) this video belongs to. */
  categories: string[]
}

export interface SearchResponse {
  /** The validated query that was executed (after trimming). */
  query: string
  /** The effective result limit after server-side clamping. */
  limit: number
  results: SearchVideoDto[]
}

/** One enabled genre from `GET /api/v1/categories` (SPEC section 7). */
export interface CategoryDto {
  /** Knowledge Stream internal category UUID. */
  id: string
  name: string
}

/** Enabled genres available for selection. */
export interface CategoriesResponse {
  categories: CategoryDto[]
}

/**
 * One feed candidate from `GET /api/v1/feed` (SPEC section 3).
 * Carries only what the client needs to open the video; never a raw D1 row.
 */
export interface FeedVideoDto {
  /** Knowledge Stream internal UUID (distinct from the YouTube video id). */
  id: string
  platform: string
  externalVideoId: string
  /** Our own description label, not the official YouTube title. */
  label: string
  /** Names of the enabled genres (categories) this video belongs to. */
  categories: string[]
}

/** Feed candidates matching the selected genres. */
export interface FeedResponse {
  /** The validated category-id filter that was applied; empty means unfiltered. */
  categories: string[]
  /** The effective result limit after server-side clamping. */
  limit: number
  results: FeedVideoDto[]
}

export type FeedbackType = 'helpful' | 'wrong_category'

/** Anonymous feedback sent to `POST /api/v1/feedback` (SPEC section 5). */
export interface FeedbackRequest {
  /** Knowledge Stream internal video UUID. */
  videoId: string
  /** The anonymous evaluation to record. */
  feedbackType: FeedbackType
  /** Device-generated anonymous UUID, sent only for this POST. */
  clientId: string
}

/** An accepted evaluation, including idempotent duplicate submissions. */
export interface FeedbackResponse {
  recorded: true
  duplicate: boolean
}

/** Admin metadata contracts (SPEC sections 4, 6 and 7). */
export type AdminAvailabilityStatus = 'active' | 'under_review' | 'unavailable'

export interface AdminVideoDto {
  id: string
  platform: string
  externalVideoId: string
  label: string
  searchKeywords: string | null
  enabled: boolean
  availabilityStatus: string
  categoryIds: string[]
  createdAt: string
  updatedAt: string
}

export interface AdminVideosResponse { videos: AdminVideoDto[] }

export interface AdminVideoCreateRequest {
  url: string
  label: string
  searchKeywords?: string | null
  categoryIds?: string[]
  enabled?: boolean
  availabilityStatus?: AdminAvailabilityStatus
}

export interface AdminVideoUpdateRequest {
  label?: string
  searchKeywords?: string | null
  categoryIds?: string[]
  enabled?: boolean
  availabilityStatus?: AdminAvailabilityStatus
}

export interface AdminCategoryDto {
  id: string
  name: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminCategoriesResponse { categories: AdminCategoryDto[] }
export interface AdminCategoryCreateRequest { name: string; enabled?: boolean }
export interface AdminCategoryUpdateRequest { name?: string; enabled?: boolean }

export interface AdminFeedbackDto {
  id: string
  videoId: string
  videoLabel: string
  feedbackType: FeedbackType
  createdAt: string
}

export interface AdminFeedbackResponse { feedback: AdminFeedbackDto[] }
