import type { AdminVideoDto, AdminVideoCreateRequest, AdminVideoUpdateRequest, AdminVideosResponse, AdminCategoryDto, AdminCategoryCreateRequest, AdminCategoryUpdateRequest, AdminCategoriesResponse, AdminFeedbackDto, AdminFeedbackResponse } from '../../shared/api'

export class AdminApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'AdminApiError' }
}

async function request<T>(path: string, signal?: AbortSignal, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = window.setTimeout(abort, 8_000)
  try {
    const response = await fetch(`/api/v1/admin/${path}`, {
      signal: controller.signal, method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      let message = response.status === 401 ? '認証が必要です。Cloudflare Access でログインしてください'
        : response.status === 500 ? '管理機能が利用できません（Access の設定を確認してください）' : `サーバーエラー (${response.status})`
      try {
        const error: unknown = await response.json()
        if (typeof error === 'object' && error !== null && 'error' in error && typeof error.error === 'string' && error.error) message = error.error
      } catch { /* Access may return HTML instead of JSON. */ }
      throw new AdminApiError(response.status, message)
    }
    return await response.json() as T
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

export const getAdminVideos = async (signal?: AbortSignal): Promise<AdminVideoDto[]> => (await request<AdminVideosResponse>('videos', signal)).videos
export const createAdminVideo = (body: AdminVideoCreateRequest, signal?: AbortSignal) => request<AdminVideoDto>('videos', signal, 'POST', body)
export const updateAdminVideo = (id: string, body: AdminVideoUpdateRequest, signal?: AbortSignal) => request<AdminVideoDto>(`videos/${encodeURIComponent(id)}`, signal, 'PATCH', body)
export const getAdminCategories = async (signal?: AbortSignal): Promise<AdminCategoryDto[]> => (await request<AdminCategoriesResponse>('categories', signal)).categories
export const createAdminCategory = (body: AdminCategoryCreateRequest, signal?: AbortSignal) => request<AdminCategoryDto>('categories', signal, 'POST', body)
export const updateAdminCategory = (id: string, body: AdminCategoryUpdateRequest, signal?: AbortSignal) => request<AdminCategoryDto>(`categories/${encodeURIComponent(id)}`, signal, 'PATCH', body)
export const getAdminFeedback = async (signal?: AbortSignal): Promise<AdminFeedbackDto[]> => (await request<AdminFeedbackResponse>('feedback?limit=50', signal)).feedback
