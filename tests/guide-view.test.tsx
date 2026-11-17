import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GuideView } from '../src/GuideView'

afterEach(cleanup)

it('explains local storage, feedback privacy and YouTube playback', () => {
  render(<GuideView onBack={vi.fn()} />)
  expect(screen.getByRole('main', { name: '利用案内・プライバシー' })).toBeTruthy()
  expect(screen.getByText(/この端末のブラウザ（LocalStorage）にだけ保存され、サーバーには送信されません: 視聴済みの動画、保存した動画、興味なしにした動画、評価を送信済みかどうか、匿名クライアントID/)).toBeTruthy()
  expect(screen.getByText(/「役立った」または「分類が違う」を押したときだけ、その動画のID、評価の種類、匿名クライアントID、送信した時刻がサーバーに送られ/)).toBeTruthy()
  expect(screen.getByText(/匿名クライアントIDは、そのままの形では保存されません。サーバー側で、秘密鍵を使ったHMACという方法で変換した値だけが保存され、元のIDを復元することはできません/)).toBeTruthy()
  expect(screen.getByText(/サーバーに送信済みの評価は、プロフィール画面で端末内データを削除しても消えません/)).toBeTruthy()
  expect(screen.getByText(/動画は YouTube の公式埋め込みプレーヤーで再生します。このアプリが動画本体を取得・保存することはありません/)).toBeTruthy()
})

it('returns to the profile when the back button is clicked', () => {
  const onBack = vi.fn()
  render(<GuideView onBack={onBack} />)
  fireEvent.click(screen.getByRole('button', { name: '← プロフィールに戻る' }))
  expect(onBack).toHaveBeenCalledOnce()
})
