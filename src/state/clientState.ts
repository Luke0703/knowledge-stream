import type { FeedbackType } from '../../shared/api'

export interface ClientState {
  clientId: string | null
  feedbackHelpfulVideoIds: string[]
  feedbackWrongCategoryVideoIds: string[]
  /** null = the user has not chosen genres yet (first run). */
  selectedCategoryIds: string[] | null
  viewedVideoIds: string[]
  savedVideoIds: string[]
  notInterestedVideoIds: string[]
}

export const CLIENT_STATE_STORAGE_KEY = 'knowledge-stream:client-state:v1'

export function emptyClientState(): ClientState {
  return { clientId: null, feedbackHelpfulVideoIds: [], feedbackWrongCategoryVideoIds: [], selectedCategoryIds: null, viewedVideoIds: [], savedVideoIds: [], notInterestedVideoIds: [] }
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []
}

export function loadClientState(storage?: Pick<Storage, 'getItem'>): ClientState {
  try {
    const raw = (storage ?? window.localStorage).getItem(CLIENT_STATE_STORAGE_KEY)
    if (!raw) return emptyClientState()
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1) return emptyClientState()
    const fields = data as Record<string, unknown>
    return {
      clientId: typeof fields.clientId === 'string' ? fields.clientId : null,
      feedbackHelpfulVideoIds: stringIds(fields.feedbackHelpfulVideoIds),
      feedbackWrongCategoryVideoIds: stringIds(fields.feedbackWrongCategoryVideoIds),
      selectedCategoryIds: Array.isArray(fields.selectedCategoryIds) ? stringIds(fields.selectedCategoryIds) : null,
      viewedVideoIds: stringIds(fields.viewedVideoIds),
      savedVideoIds: stringIds(fields.savedVideoIds),
      notInterestedVideoIds: stringIds(fields.notInterestedVideoIds),
    }
  } catch {
    // Storage can be unavailable in private mode or outside the browser.
    return emptyClientState()
  }
}

export function saveClientState(state: ClientState, storage?: Pick<Storage, 'setItem'>): void {
  try {
    ;(storage ?? window.localStorage).setItem(CLIENT_STATE_STORAGE_KEY, JSON.stringify({ ...state, version: 1 }))
  } catch {
    // Keep in-memory state usable when persistence is unavailable.
  }
}

export function withSelectedCategoryIds(state: ClientState, ids: string[] | null): ClientState {
  return { ...state, selectedCategoryIds: ids === null ? null : [...ids] }
}

export function withViewed(state: ClientState, videoId: string): ClientState {
  return state.viewedVideoIds.includes(videoId) ? state : { ...state, viewedVideoIds: [...state.viewedVideoIds, videoId] }
}

export function withSavedToggled(state: ClientState, videoId: string): ClientState {
  return {
    ...state,
    savedVideoIds: state.savedVideoIds.includes(videoId)
      ? state.savedVideoIds.filter(id => id !== videoId)
      : [...state.savedVideoIds, videoId],
  }
}

export function withNotInterested(state: ClientState, videoId: string): ClientState {
  if (state.notInterestedVideoIds.includes(videoId)) return state
  return {
    ...state,
    notInterestedVideoIds: [...state.notInterestedVideoIds, videoId],
    savedVideoIds: state.savedVideoIds.filter(id => id !== videoId),
  }
}

export function withoutViewed(state: ClientState): ClientState {
  return { ...state, viewedVideoIds: [] }
}

export function withoutSaved(state: ClientState): ClientState {
  return { ...state, savedVideoIds: [] }
}

export function withoutNotInterested(state: ClientState): ClientState {
  return { ...state, notInterestedVideoIds: [] }
}

export function withClientId(state: ClientState, clientId: string): ClientState {
  return state.clientId === clientId ? state : { ...state, clientId }
}

export function hasFeedbackSent(state: ClientState, videoId: string, feedbackType: FeedbackType): boolean {
  return (feedbackType === 'helpful' ? state.feedbackHelpfulVideoIds : state.feedbackWrongCategoryVideoIds).includes(videoId)
}

export function withFeedbackSent(state: ClientState, videoId: string, feedbackType: FeedbackType): ClientState {
  if (hasFeedbackSent(state, videoId, feedbackType)) return state
  const key = feedbackType === 'helpful' ? 'feedbackHelpfulVideoIds' : 'feedbackWrongCategoryVideoIds'
  return { ...state, [key]: [...state[key], videoId] }
}
