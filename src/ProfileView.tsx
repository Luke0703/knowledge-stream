import { useState } from 'react'
import type { CategoryDto } from '../shared/api'
import type { FeedVideo } from './feed/model'
import { GenrePicker } from './GenreSelect'

export function ProfileView(props: {
  categories: CategoryDto[]
  categoriesError: boolean
  onRetryCategories: () => void
  selectedCategoryIds: string[]
  onSaveSelection: (ids: string[]) => void
  savedVideos: FeedVideo[]
  unresolvedSavedCount: number
  onOpenSaved: (video: FeedVideo) => void
  onUnsave: (videoId: string) => void
  viewedCount: number
  savedCount: number
  notInterestedCount: number
  onClearViewed: () => void
  onClearSaved: () => void
  onClearNotInterested: () => void
  onOpenGuide: () => void
  onClearAll: () => void
}) {
  const [armed, setArmed] = useState<string | null>(null)
  const actions = [
    ['視聴履歴を削除', props.onClearViewed],
    ['保存をすべて削除', props.onClearSaved],
    ['興味なし設定を初期化', props.onClearNotInterested],
    ['端末内データをすべて削除', props.onClearAll],
  ] as const
  return <main className="profile-view" aria-label="プロフィール（設定）">
    <h2>プロフィール（設定）</h2>
    <section><h3>ジャンル設定</h3>
      {props.categoriesError ? <><p>ジャンルの読み込みに失敗しました</p><button onClick={props.onRetryCategories}>再試行</button></> : <GenrePicker key={props.selectedCategoryIds.join(',')} categories={props.categories} initialSelectedIds={props.selectedCategoryIds} submitLabel="ジャンルを変更する" onSubmit={props.onSaveSelection} />}
      <p className="profile-note">変更すると動画フィードが作り直されます。</p>
    </section>
    <section><h3>保存した動画</h3>
      {props.savedVideos.length === 0 && props.unresolvedSavedCount === 0 && <p>保存した動画はまだありません。</p>}
      <ul className="saved-videos">{props.savedVideos.map(video => <li key={video.id}>
        <button className="search-result" onClick={() => props.onOpenSaved(video)}><span>{video.label}</span>{video.categories.length > 0 && <span className="search-result-categories">{video.categories.join(' / ')}</span>}</button>
        <button onClick={() => props.onUnsave(video.id)}>取り消し</button>
      </li>)}</ul>
      {props.unresolvedSavedCount > 0 && <p>一部の保存済み動画は情報を取得できませんでした。</p>}
    </section>
    <section><h3>端末内データ</h3>
      <p className="profile-counts">視聴履歴 {props.viewedCount}件 / 保存 {props.savedCount}件 / 興味なし {props.notInterestedCount}件</p>
      <div className="danger-actions">{actions.map(([label, handler]) => <div key={label}>{armed === label ? <div className="confirm-row"><span>本当に削除しますか？</span><button onClick={() => { handler(); setArmed(null) }}>削除する</button><button onClick={() => setArmed(null)}>やめる</button></div> : <button className="danger-button" onClick={() => setArmed(label)}>{label}</button>}</div>)}</div>
    </section>
    <section><h3>案内</h3>
      <button onClick={props.onOpenGuide}>利用案内・プライバシーについて</button>
    </section>
    <p className="profile-note">端末内データの削除は、この端末に保存された情報だけを消す操作です。サーバーに送信済みの評価は消えません。</p>
  </main>
}
