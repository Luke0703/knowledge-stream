import type { FeedbackType } from '../../shared/api'

export interface SubmitFeedbackResult { ok: boolean; duplicate: boolean }

export async function submitFeedback(input: { videoId: string; feedbackType: FeedbackType; clientId: string }, fetchImpl: typeof fetch = fetch): Promise<SubmitFeedbackResult> {
  try {
    const response = await fetchImpl('/api/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: input.videoId, feedbackType: input.feedbackType, clientId: input.clientId }),
    })
    if (!response.ok) return { ok: false, duplicate: false }
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'recorded' in body && body.recorded === true) {
      return { ok: true, duplicate: 'duplicate' in body && body.duplicate === true }
    }
  } catch {
    // Failed sends remain available to retry.
  }
  return { ok: false, duplicate: false }
}
