export interface TestVideo {
  id: string
  externalVideoId: string
  label: string
  category: string
}

// Technical fixtures, not a curated production feed. See README for verification/replacement.
export const testVideos: TestVideo[] = [
  { id: '11111111-1111-4111-8111-111111111111', externalVideoId: 'M7lc1UVf-VE', label: '埋め込みプレーヤーの仕組みを知る', category: 'Web技術' },
  { id: '22222222-2222-4222-8222-222222222222', externalVideoId: 'aqz-KE-bpKQ', label: 'オープンソースでつくる3Dアニメーション', category: 'ものづくり' },
  { id: '33333333-3333-4333-8333-333333333333', externalVideoId: 'jNQXAC9IVRw', label: '動画共有のはじまりを振り返る', category: '技術史' },
]
