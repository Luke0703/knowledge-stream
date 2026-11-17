import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AdminApp from '../src/admin/AdminApp'
import type { AdminVideoDto } from '../shared/api'
import { extractYouTubeVideoId } from '../src/player/youtubeUrl'

const timestamp = '2026-11-17T10:00:00Z'
function stubApi() {
  let videos: AdminVideoDto[] = [
    { id: 'v1', platform: 'youtube', externalVideoId: 'pgGrQjYcm5A', label: '円周率の動画', searchKeywords: '数学', enabled: true, availabilityStatus: 'active', categoryIds: ['c1'], createdAt: timestamp, updatedAt: timestamp },
    { id: 'v2', platform: 'youtube', externalVideoId: 'abcdefghijk', label: '無効な動画', searchKeywords: null, enabled: false, availabilityStatus: 'under_review', categoryIds: [], createdAt: timestamp, updatedAt: timestamp },
  ]
  const categories = [{ id: 'c1', name: '数学', enabled: true, createdAt: timestamp, updatedAt: timestamp }, { id: 'c2', name: '物理', enabled: false, createdAt: timestamp, updatedAt: timestamp }]
  const failures = { load: false, mutation: false }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (failures.load) return new Response('Access configuration error', { status: 500 })
    const method = init?.method ?? 'GET'
    if (failures.mutation && method !== 'GET') return Response.json({ error: '保存できませんでした' }, { status: 500 })
    if (url === '/api/v1/admin/videos' && method === 'GET') return Response.json({ videos })
    if (url === '/api/v1/admin/categories' && method === 'GET') return Response.json({ categories })
    if (url === '/api/v1/admin/feedback?limit=50') return Response.json({ feedback: [] })
    if (url === '/api/v1/admin/videos' && method === 'POST') {
      const body = JSON.parse(init!.body as string)
      const video: AdminVideoDto = { ...videos[0], ...body, id: 'v3', externalVideoId: extractYouTubeVideoId(body.url) }
      videos = [video, ...videos]
      return Response.json(video, { status: 201 })
    }
    if (url.startsWith('/api/v1/admin/videos/') && method === 'PATCH') {
      const id = url.split('/').pop()
      videos = videos.map(video => video.id === id ? { ...video, ...JSON.parse(init!.body as string) } : video)
      return Response.json(videos.find(video => video.id === id))
    }
    throw new Error(`Unexpected request: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, failures }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads enabled and disabled videos and the complete category list', async () => {
  stubApi()
  render(<AdminApp />)
  expect(await screen.findByText('円周率の動画')).toBeTruthy()
  const disabled = screen.getByRole('listitem', { name: '無効な動画' })
  expect(within(disabled).getByText('無効')).toBeTruthy()
  const genres = screen.getByRole('region', { name: 'ジャンル' })
  expect(within(genres).getByText('数学')).toBeTruthy()
  expect(within(genres).getByText('物理')).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: '物理（無効）' })).toBeTruthy()
  expect(screen.getByText('評価はまだありません。')).toBeTruthy()
})

it('patches enabled and updates the badge from the response', async () => {
  const { fetchMock } = stubApi()
  render(<AdminApp />)
  await screen.findByText('円周率の動画')
  const row = screen.getByRole('listitem', { name: '円周率の動画' })
  fireEvent.click(within(row).getByRole('button', { name: '無効にする' }))
  expect(await within(row).findByText('無効')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/videos/v1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }))
})

it('previews the extracted video ID, posts the raw URL and shows the created video', async () => {
  const { fetchMock } = stubApi()
  render(<AdminApp />)
  await screen.findByText('円周率の動画')
  const url = 'https://youtu.be/ZYXWVUTSRQP'
  fireEvent.change(screen.getByLabelText('YouTube URL または動画 ID'), { target: { value: url } })
  expect(screen.getByRole('status').textContent).toBe('ZYXWVUTSRQP')
  fireEvent.change(screen.getByLabelText('ラベル'), { target: { value: '新しい実験' } })
  fireEvent.click(screen.getByRole('button', { name: '動画を登録' }))
  expect(await screen.findByText('新しい実験')).toBeTruthy()
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(post![1]!.body as string)).toEqual({ url, label: '新しい実験', searchKeywords: '', categoryIds: [], enabled: true, availabilityStatus: 'active' })
  expect((screen.getByLabelText('YouTube URL または動画 ID') as HTMLInputElement).value).toBe('')
})

it('shows a useful fallback for a 500 load failure and can retry all requests', async () => {
  const { failures, fetchMock } = stubApi()
  failures.load = true
  render(<AdminApp />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText('管理機能が利用できません（Access の設定を確認してください）')).toBeTruthy()
  failures.load = false
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  expect(await screen.findByText('円周率の動画')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(6)
})

it('keeps data and edit input after a failed save and allows resubmission', async () => {
  const { failures } = stubApi()
  render(<AdminApp />)
  await screen.findByText('円周率の動画')
  const row = screen.getByRole('listitem', { name: '円周率の動画' })
  fireEvent.click(within(row).getByRole('button', { name: '編集' }))
  fireEvent.change(within(row).getByLabelText('ラベル'), { target: { value: '修正ラベル' } })
  failures.mutation = true
  fireEvent.click(within(row).getByRole('button', { name: '保存' }))
  expect(await screen.findByText('保存できませんでした')).toBeTruthy()
  expect(screen.getByText('円周率の動画')).toBeTruthy()
  expect((within(row).getByLabelText('ラベル') as HTMLInputElement).value).toBe('修正ラベル')
  failures.mutation = false
  await waitFor(() => expect((within(row).getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(within(row).getByRole('button', { name: '保存' }))
  expect(await screen.findByText('修正ラベル')).toBeTruthy()
})
