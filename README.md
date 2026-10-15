# Knowledge Stream

技術・科学・ものづくり系の短尺動画を、選んだジャンルに応じて縦型フィードで発見・視聴するモバイル優先Webプロトタイプ。

**完成目標: 2026-10-20**

## 現在の状態
**Phase 1 / Issue #1 の技術スパイクを実装。2026-10-15、同じWi-FiのiPhone Safariで画面表示・動画再生・前後切り替え・前の音声停止・標準UIでのミュート解除を利用者が確認済み。全受け入れ項目の確認は未完了です。**

固定の3動画を公式YouTube IFrame Player APIで表示します。検索・プロフィールは非活性タブの配置のみ。D1、管理画面、評価・検索・フィードAPI、履歴保存、ジャンル選択は実装していません。本番デプロイ・Cloudflareアカウント操作・秘密情報の登録は実施していません。

## ローカル起動

Node.js 22.12以上（検証: 24.19.0）、pnpm 11.25.0を利用します。`pnpm-lock.yaml`をコミットしています。

```sh
pnpm install --frozen-lockfile
pnpm dev
# http://localhost:5173
pnpm typecheck
pnpm test
pnpm build
pnpm preview
# http://localhost:4173
pnpm preview:lan
# 同じWi-FiのiPhoneから http://<PCのWi-Fi IPv4>:4174
```

Cloudflareへのログイン・APIキー・D1は不要です。`pnpm dev` / `pnpm preview` はローカルworkerdを使用します。`pnpm-workspace.yaml`は公式ツールチェーンのesbuild/workerdのインストールスクリプトだけ許可しています。デプロイ用スクリプトは追加していません。

書き込み制限のある環境では、Wranglerのログを作業フォルダ内へ向けてください（PowerShell）:

```powershell
$env:WRANGLER_LOG_PATH = Join-Path (Get-Location) '.wrangler/logs'
$env:WRANGLER_SEND_METRICS = 'false'
pnpm dev
```

## Phase 1の構成と操作

- [Cloudflare公式React + Vite構成](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)に準じ、`src/`がReact SPA、`worker/index.ts`が単一API Worker。`@cloudflare/vite-plugin`、`wrangler.jsonc`のStatic Assets SPA fallback、`/api/*`のWorker優先ルーティングを使用。
- `GET /api/v1/health`だけを実装し、共有DTOは`shared/api.ts`。その他のAPIはJSON 404。管理APIの認証は未実装で、管理処理自体が存在しません。
- `compatibility_date`は同梱workerdで起動確認した`2026-10-01`に固定。作業日の`2026-10-15`はこのworkerdの対応上限を超えたため採用していません。
- CSS `scroll-snap`が位置合わせを担当。TypeScriptはカードの表示面積65%以上かつプレーヤー表示面積50%以上でactiveを決定。切替途中で条件を満たさないと全停止します。
- `PlaybackCoordinator`は旧プレーヤーの停止→新プレーヤーのミュート自動再生の順を管理。遅れて届くready/再生イベントでも対象を再確認し、非activeの再生を停止。非表示タブでも停止します。
- 最後にactiveになった動画の±1件だけをマウント（最大3 iframe）。ウィンドウ外は`destroy()`。再訪時は再生成するため、遠い動画の再生位置は保持しません。
- iframe外の「前へ／次へ」は常設。動画外の余白をスクロールすることもできます。先頭・末尾の操作は非活性で、ループや次動画への自動送りはありません。
- 自動再生は保証しません。拒否されたらYouTube標準の再生ボタンを押してください。音声もYouTube標準UIで操作します。APIロード/readyの15秒タイムアウト、再試行、埋め込み不可等のエラー案内をプレーヤー外に表示します。
- 独自オーバーレイ・透明タッチ領域・プレーヤーのクロップはありません。3タブと前後操作はGridの別行、safe-areaを確保。200×200px以上を維持するため、高さ620px未満ではページ全体にもスクロールを許可します。
- 視聴済みの永続化はPhase 2対象。このスパイクはLocalStorageへ書き込みません。

## テスト動画と差し替え

`src/videos.ts`の固定データです。ラベルは独自説明であり、YouTube公式タイトルではありません。短尺・縦動画に限定したコンテンツ選定はまだ行っておらず、横動画を含む再生検証用です。

| URL | 用途 | 2026-10-15の確認 |
| --- | --- | --- |
| https://www.youtube.com/watch?v=M7lc1UVf-VE | Googleの埋め込みプレーヤー解説・公式APIサンプル | 公開ページとPC内蔵ブラウザでの埋め込み再生を確認 |
| https://www.youtube.com/watch?v=aqz-KE-bpKQ | Blender制作映像・横動画の表示確認 | 公開ページとPC内蔵ブラウザでの埋め込み再生を確認 |
| https://www.youtube.com/watch?v=jNQXAC9IVRw | 動画共有の初期例・短い動画 | 公開ページとPC内蔵ブラウザでの埋め込み再生を確認 |

地域・端末・年齢・配信者の設定変更で再生可否は変化します。iPhoneでの可用性は未確認。oEmbed取得は調査環境で失敗したため可否判定には使用せず、ローカルアプリ内の実再生で確認しました。

再生できなくなった場合:

1. 所有者が埋め込みを許可した公開動画をYouTubeの「共有→埋め込む」で確認する。
2. `src/videos.ts`の`externalVideoId`をURLの`v=`または`youtu.be/`の11文字IDへ変更し、独自`label`と`category`を更新。内部`id`はYouTube IDと別のUUID v4とし、別動画への差し替えなら新規UUIDを割り当てる。固定データは3〜5本に保つ。
3. ローカルアプリで実際に再生し、前後操作、YouTube標準UI、iPhone Safariでも確認。公開ページやサムネイルが取得できただけでは埋め込み可と判断しない。
4. エラー100は削除/非公開等、101/150は埋め込み不可、153はReferer等の再生元識別を確認。自動再生拒否は動画無効と扱わない。`file://`で開かずHTTP(S)を使用する。

公式参考: [IFrame API](https://developers.google.com/youtube/iframe_api_reference)、[埋め込み要件](https://developers.google.com/youtube/terms/required-minimum-functionality)。`controls=1`、`playsinline=1`、実際の`origin`を設定し、Refererを抑制しない設定にしています。

## 検証結果（2026-10-15）

- `pnpm typecheck`: 成功（React / Worker / Vite設定）。
- `pnpm build`: 成功。`dist/client`と`dist/worker`を生成。ログの権限エラーは上記の作業フォルダ設定で解消。
- `pnpm test`: 3ファイル、13テスト成功。閾値/ロード範囲、停止順序、遅延ready、非active再生、非表示タブ、StrictModeの生成破棄、ブロック案内、再試行/タイムアウト、API応答を検証。YouTubeをモックしたテストは実機再生の保証ではありません。
- ローカルworkerd起動・ビルド済みpreview: 成功。SPA 200、health 200、未実装のadmin/feedback APIはJSON 404（HTMLを要求してもSPAへ落ちない）、healthへのPOSTは405。
- PC内蔵ブラウザ: 3動画の再生、前→次の旧動画停止、iframe数2→3→2、最後の次ボタン非活性を確認。
- 390×844と320×568のブラウザ表示幅でレイアウトを確認。320px幅でもプレーヤー200×200px以上、前後操作・タブと非重複。小さい高さではヘッダーを含むページスクロールが発生する設計。
- 制限付き実行環境での初回Vitestは子プロセス起動がタイムアウト。通常のローカル実行権限で再実行し13件成功。テストを省略して成功扱いにはしていません。

## 未完了の手動・実機チェック

**iPhone Safari実機（一部利用者確認済み、残りは下記）**。画面表示・再生・前後操作・前の音声停止・ミュート解除は確認済みです。PCのモバイル幅表示は実機確認の代替になりません。PCで`pnpm build`→`pnpm preview:lan`を実行し、同じWi-FiのiPhoneからPCのIP:4174を開きます。[接続・停止・トラブル対処と実機記録シート](docs/IPHONE_SAFARI_QA.md)を参照してください。外部公開やファイアウォール設定の自動変更は行いません。

- [ ] iframe内部の上下スワイプがページ移動するか記録。捕捉されてもiframe外の前/次と余白スクロールで全動画へ到達できること。
- [ ] 初回アクセス・低電力モード等で自動再生拒否時も標準再生ボタンが機能し、ミュート解除・一時停止・シークができること。
- [ ] 高速な往復移動、部分スクロール、別タブ/ホームへ移動・復帰、画面ロック/解除で複数の音声が同時に出ないこと。
- [ ] SafariのURLバー開閉、縦横回転、ホームインジケータ、拡大文字で標準コントロール・ロゴ・リンク・広告を覆わず、前後操作と3タブへ到達できること。
- [ ] 全画面表示と復帰時の再生・active判定を確認。iframe内のフルスクリーン状態はこのスパイクでは独自制御しない。
- [ ] 実際の通信切断/復帰、コンテンツブロッカー、削除/埋め込み禁止動画で再試行と前/次が機能すること。

**PCブラウザでも追加確認が必要**: Chrome/Edge/Firefoxの実ブラウザでキーボードTab・スクロール、手動停止が勝手に再開しないこと、バックグラウンド復帰、広告表示時の非干渉、オフライン復帰、200%ズーム。現在確認したのはPCのCodex内蔵ブラウザです。

次の手順はDraft PRのレビューと上記実機チェック。Phase 2以降は別依頼として着手します。

## 開発ドキュメント
- [iPhone Safari・同じWi-Fiでの検証手順](docs/IPHONE_SAFARI_QA.md)
- [Phase 1 コードガイド・共有／復元手順](docs/PHASE1_CODE_GUIDE.md)
- [プロトタイプ仕様書 v0.2](docs/SPEC.md)
- [10/20までの実装計画](docs/PLAN.md)
- [Codexへの初回指示](docs/CODEX_START.md)
- [エージェント開発ルール](AGENTS.md)

## 実装タスク
- [#1 基盤とYouTube縦フィード技術検証](../../issues/1)
- [#2 ジャンル/3タブ/ローカル状態](../../issues/2)
- [#3 D1/API/検索](../../issues/3)
- [#4 管理画面/管理API認証](../../issues/4)
- [#5 匿名評価/再生エラー](../../issues/5)
- [#6 QA/バックアップ/完成判定](../../issues/6)

## 採用技術
React + TypeScript + Vite、Cloudflare Workers + Static Assets、YouTube IFrame Player API。Cloudflare D1は将来Phaseの計画のみ。YouTube動画本体は取得・保存・再配信しない。

## 主要原則
- ユーザー側にログイン不要、管理画面だけCloudflare Accessで保護
- 下部「動画 / 検索 / プロフィール（設定）」タブ
- 動画に入った時点で視聴済み
- 検索対象は管理者選定の登録済み動画のみ（部分一致）
- 公式YouTubeプレーヤーのUIを独自UIで覆わない
- 最初にiPhone Safariでプレーヤーとスクロールの相性を検証する
