import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfileView } from '../src/ProfileView'
import { testVideos } from '../src/videos'

const fixture = () => ({
  categories: [{ id: 'math', name: '数学' }, { id: 'physics', name: '物理' }],
  categoriesError: false, onRetryCategories: vi.fn(), selectedCategoryIds: [], onSaveSelection: vi.fn(),
  savedVideos: [testVideos[0]], unresolvedSavedCount: 0, onOpenSaved: vi.fn(), onUnsave: vi.fn(),
  viewedCount: 3, savedCount: 1, notInterestedCount: 2,
  onOpenGuide: vi.fn(),
  onClearViewed: vi.fn(), onClearSaved: vi.fn(), onClearNotInterested: vi.fn(), onClearAll: vi.fn(),
})
afterEach(cleanup)

it('opens and removes saved videos and explains local deletion', () => {
  const props = fixture()
  render(<ProfileView {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /ピザで円周率を考える/ }))
  expect(props.onOpenSaved).toHaveBeenCalledWith(testVideos[0])
  fireEvent.click(screen.getByRole('button', { name: '取り消し' }))
  expect(props.onUnsave).toHaveBeenCalledWith(testVideos[0].id)
  expect(screen.getByText('視聴履歴 3件 / 保存 1件 / 興味なし 2件')).toBeTruthy()
  expect(screen.getByText('端末内データの削除は、この端末に保存された情報だけを消す操作です。サーバーに送信済みの評価は消えません。')).toBeTruthy()
})

it('requires confirmation for every clear action and supports cancellation', () => {
  const props = fixture()
  render(<ProfileView {...props} />)
  for (const [label, handler] of [
    ['視聴履歴を削除', props.onClearViewed], ['保存をすべて削除', props.onClearSaved],
    ['興味なし設定を初期化', props.onClearNotInterested], ['端末内データをすべて削除', props.onClearAll],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(handler).not.toHaveBeenCalled()
    expect(screen.getByText('本当に削除しますか？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(handler).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: label }))
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))
    expect(handler).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
  }
})

it('requires genres and submits them in category order', () => {
  const props = fixture()
  render(<ProfileView {...props} />)
  const submit = screen.getByRole('button', { name: 'ジャンルを変更する' })
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '物理' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '数学' }))
  fireEvent.click(submit)
  expect(props.onSaveSelection).toHaveBeenCalledWith(['math', 'physics'])
})

it('opens the usage and privacy guide', () => {
  const props = fixture()
  render(<ProfileView {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '利用案内・プライバシーについて' }))
  expect(props.onOpenGuide).toHaveBeenCalledOnce()
})
