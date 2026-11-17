import { useEffect, useState } from 'react'
import type { AdminAvailabilityStatus, AdminCategoryDto, AdminFeedbackDto, AdminVideoDto } from '../../shared/api'
import { extractYouTubeVideoId } from '../player/youtubeUrl'
import { createAdminCategory, createAdminVideo, getAdminCategories, getAdminFeedback, getAdminVideos, updateAdminCategory, updateAdminVideo } from './api'

const statuses: Record<AdminAvailabilityStatus, string> = { active: '公開中', under_review: '確認中', unavailable: '利用不可' }
const blankVideo = () => ({ url: '', label: '', searchKeywords: '', categoryIds: [] as string[], enabled: true, availabilityStatus: 'active' as AdminAvailabilityStatus })
const errorMessage = (error: unknown) => error instanceof Error && error.name !== 'AbortError' ? error.message : '通信に失敗しました。もう一度お試しください。'
const date = (value: string) => new Date(value).toLocaleString('ja-JP')

export default function AdminApp() {
  const [videos, setVideos] = useState<AdminVideoDto[]>([])
  const [categories, setCategories] = useState<AdminCategoryDto[]>([])
  const [feedback, setFeedback] = useState<AdminFeedbackDto[]>([])
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const [lifecycle] = useState(() => ({ mounted: false, controllers: new Set<AbortController>(), busy: new Set<string>() }))
  const [draft, setDraft] = useState(blankVideo)
  const [categoryName, setCategoryName] = useState('')
  const [editVideo, setEditVideo] = useState<(ReturnType<typeof blankVideo> & { id: string }) | null>(null)
  const [editCategory, setEditCategory] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    lifecycle.mounted = true
    return () => { lifecycle.mounted = false; lifecycle.controllers.forEach(controller => controller.abort()) }
  }, [lifecycle])

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true
    setLoading(true); setLoadError('')
    void Promise.all([getAdminVideos(controller.signal), getAdminCategories(controller.signal), getAdminFeedback(controller.signal)])
      .then(([v, c, f]) => { if (mounted) { setVideos(v); setCategories(c); setFeedback(f) } })
      .catch(error => { if (mounted) setLoadError(errorMessage(error)) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false; controller.abort() }
  }, [reload])

  async function mutate(key: string, action: (signal: AbortSignal) => Promise<() => void>) {
    if (lifecycle.busy.has(key)) return
    const controller = new AbortController()
    lifecycle.controllers.add(controller); lifecycle.busy.add(key)
    setPending(previous => [...previous, key]); setActionError('')
    try {
      const apply = await action(controller.signal)
      if (lifecycle.mounted && !controller.signal.aborted) apply()
    } catch (error) {
      if (lifecycle.mounted && !controller.signal.aborted) setActionError(errorMessage(error))
    } finally {
      lifecycle.controllers.delete(controller); lifecycle.busy.delete(key)
      if (lifecycle.mounted) setPending(previous => previous.filter(id => id !== key))
    }
  }

  function categoryFields(value: string[], change: (ids: string[]) => void) {
    return <fieldset className="admin-categories"><legend>ジャンル</legend>{categories.map(category => <label key={category.id}>
      <input type="checkbox" checked={value.includes(category.id)} onChange={event => change(event.target.checked ? [...value, category.id] : value.filter(id => id !== category.id))} />
      {category.name}{!category.enabled && '（無効）'}
    </label>)}</fieldset>
  }
  const badge = (enabled: boolean) => <span className="admin-badge" data-enabled={enabled}>{enabled ? '有効' : '無効'}</span>
  const replaceVideo = (video: AdminVideoDto) => setVideos(previous => previous.map(item => item.id === video.id ? video : item))
  const replaceCategory = (category: AdminCategoryDto) => setCategories(previous => previous.map(item => item.id === category.id ? category : item))

  return <main className="admin-view">
    <header><h1>Knowledge Stream 管理画面</h1><p className="admin-meta">認証は Cloudflare Access を使用します。このページは一般公開のタブからリンクされていません。</p></header>
    {loading ? <p role="status">読み込み中…</p> : loadError ? <div className="admin-error" role="alert"><p>{loadError}</p><button onClick={() => setReload(value => value + 1)}>再試行</button></div> : <>
      {actionError && <div className="admin-error" role="alert"><p>{actionError}</p><p>入力内容を確認し、同じ操作をもう一度お試しください。</p><button onClick={() => setActionError('')}>閉じる</button></div>}
      <section className="admin-section" aria-labelledby="admin-videos"><h2 id="admin-videos">動画</h2>
        <form className="admin-form" onSubmit={event => {
          event.preventDefault()
          void mutate('new-video', async signal => { const video = await createAdminVideo(draft, signal); return () => { setVideos(previous => [video, ...previous]); setDraft(blankVideo()) } })
        }}><fieldset className="admin-form" disabled={pending.includes('new-video')}>
          <legend>動画の新規登録</legend>
          <label>YouTube URL または動画 ID<input className="admin-input" required value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} /></label>
          {draft.url && <p className="admin-meta" role="status">{extractYouTubeVideoId(draft.url) ?? 'IDを抽出できません'}</p>}
          <label>ラベル<input className="admin-input" required value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
          <label>検索キーワード<input className="admin-input" value={draft.searchKeywords} onChange={event => setDraft({ ...draft, searchKeywords: event.target.value })} /></label>
          {categoryFields(draft.categoryIds, categoryIds => setDraft({ ...draft, categoryIds }))}
          <label><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />有効</label>
          <button disabled={!extractYouTubeVideoId(draft.url) || !draft.label.trim()}>動画を登録</button>
        </fieldset></form>
        <ul className="admin-list">{videos.map(video => <li className="admin-row" key={video.id} aria-label={video.label}>
          <strong>{video.label}</strong> {badge(video.enabled)}
          <p className="admin-meta">{video.externalVideoId} / {statuses[video.availabilityStatus as AdminAvailabilityStatus] ?? video.availabilityStatus}</p>
          <p className="admin-meta">{video.categoryIds.map(id => categories.find(category => category.id === id)?.name ?? id).join('、') || 'ジャンル未設定'} / 更新: {date(video.updatedAt)}</p>
          <div className="admin-actions"><button disabled={pending.includes(video.id)} onClick={() => void mutate(video.id, async signal => { const updated = await updateAdminVideo(video.id, { enabled: !video.enabled }, signal); return () => replaceVideo(updated) })}>{video.enabled ? '無効にする' : '有効にする'}</button>
          <button disabled={pending.includes(video.id)} onClick={() => setEditVideo(editVideo?.id === video.id ? null : { ...blankVideo(), ...video, searchKeywords: video.searchKeywords ?? '', availabilityStatus: video.availabilityStatus as AdminAvailabilityStatus })}>編集</button></div>
          {editVideo?.id === video.id && <form onSubmit={event => {
            event.preventDefault()
            const { label, searchKeywords, categoryIds, availabilityStatus } = editVideo
            void mutate(video.id, async signal => { const updated = await updateAdminVideo(video.id, { label, searchKeywords, categoryIds, availabilityStatus }, signal); return () => { replaceVideo(updated); setEditVideo(null) } })
          }}><fieldset className="admin-form" disabled={pending.includes(video.id)}><legend>動画を編集</legend>
            <label>ラベル<input className="admin-input" required value={editVideo.label} onChange={event => setEditVideo({ ...editVideo, label: event.target.value })} /></label>
            <label>検索キーワード<input className="admin-input" value={editVideo.searchKeywords} onChange={event => setEditVideo({ ...editVideo, searchKeywords: event.target.value })} /></label>
            {categoryFields(editVideo.categoryIds, categoryIds => setEditVideo({ ...editVideo, categoryIds }))}
            <label>公開状態<select className="admin-input" value={editVideo.availabilityStatus} onChange={event => setEditVideo({ ...editVideo, availabilityStatus: event.target.value as AdminAvailabilityStatus })}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="admin-actions"><button>保存</button><button type="button" onClick={() => setEditVideo(null)}>キャンセル</button></div>
          </fieldset></form>}
        </li>)}</ul>{!videos.length && <p className="admin-meta">動画はまだ登録されていません。</p>}
      </section>
      <section className="admin-section" aria-labelledby="admin-genres"><h2 id="admin-genres">ジャンル</h2>
        <form className="admin-form" onSubmit={event => { event.preventDefault(); void mutate('new-category', async signal => { const category = await createAdminCategory({ name: categoryName }, signal); return () => { setCategories(previous => [...previous, category]); setCategoryName('') } }) }}>
          <label>ジャンル名<input className="admin-input" required disabled={pending.includes('new-category')} value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label>
          <button disabled={pending.includes('new-category') || !categoryName.trim()}>ジャンルを追加</button>
        </form>
        <ul className="admin-list">{categories.map(category => <li className="admin-row" key={category.id} aria-label={category.name}>
          <strong>{category.name}</strong> {badge(category.enabled)}
          <div className="admin-actions"><button disabled={pending.includes(category.id)} onClick={() => void mutate(category.id, async signal => { const updated = await updateAdminCategory(category.id, { enabled: !category.enabled }, signal); return () => replaceCategory(updated) })}>{category.enabled ? '無効にする' : '有効にする'}</button>
          <button disabled={pending.includes(category.id)} onClick={() => setEditCategory(editCategory?.id === category.id ? null : { id: category.id, name: category.name })}>編集</button></div>
          {editCategory?.id === category.id && <form onSubmit={event => { event.preventDefault(); void mutate(category.id, async signal => { const updated = await updateAdminCategory(category.id, { name: editCategory.name }, signal); return () => { replaceCategory(updated); setEditCategory(null) } }) }}>
            <fieldset className="admin-form" disabled={pending.includes(category.id)}><legend>ジャンルを編集</legend><label>ジャンル名<input className="admin-input" required value={editCategory.name} onChange={event => setEditCategory({ ...editCategory, name: event.target.value })} /></label>
            <div className="admin-actions"><button>保存</button><button type="button" onClick={() => setEditCategory(null)}>キャンセル</button></div></fieldset>
          </form>}
        </li>)}</ul>{!categories.length && <p className="admin-meta">ジャンルはまだ登録されていません。</p>}
      </section>
      <section className="admin-section" aria-labelledby="admin-feedback"><h2 id="admin-feedback">評価</h2>
        <ul className="admin-list">{feedback.map(item => <li className="admin-row" key={item.id}><strong>{item.videoLabel}</strong><p>{item.feedbackType === 'helpful' ? '役立った' : '分類が違う'}</p><p className="admin-meta">{date(item.createdAt)}</p></li>)}</ul>
        {!feedback.length && <p className="admin-meta">評価はまだありません。</p>}
      </section>
    </>}
  </main>
}
