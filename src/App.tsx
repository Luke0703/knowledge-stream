import { useEffect, useState } from 'react'
import type { HealthResponse } from '../shared/api'
import { testVideos } from './videos'
import { VideoFeed } from './VideoFeed'

export default function App() {
  const [apiStatus, setApiStatus] = useState('API 接続中')
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    let mounted = true
    void fetch('/api/v1/health', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('API unavailable')
      const body: HealthResponse = await response.json()
      if (mounted) setApiStatus(body.ok && body.phase === 1 ? 'API 接続済み' : 'API 応答エラー')
    }).catch(() => { if (mounted) setApiStatus('API 未接続（動画操作は利用可能）') })
      .finally(() => clearTimeout(timeout))
    return () => { mounted = false; clearTimeout(timeout); controller.abort() }
  }, [])

  return <div className="app-shell">
    <header className="app-header"><div><p className="eyebrow">PLAYER SPIKE · PHASE 01</p><h1>Knowledge Stream<span> / 知るを、つなぐ。</span></h1></div><span className="api-status">{apiStatus}</span></header>
    <VideoFeed videos={testVideos} />
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      <button aria-current="page">▶ <span>動画</span></button>
      <button disabled>⌕ <span>検索</span><small>準備中</small></button>
      <button disabled>◎ <span>プロフィール</span><small>準備中</small></button>
    </nav>
  </div>
}
