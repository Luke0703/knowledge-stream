# Knowledge Stream — プロトタイプ仕様書 v0.2

- 更新日: 2026-10-15
- 完成目標: 2026-10-20
- ステータス: 設計合意版。実装・実機検証は未完了
- 開発体制: 管理者兼開発者2名
- 実装ガイド: [../AGENTS.md](../AGENTS.md)
- 開発計画: [PLAN.md](PLAN.md)

## 1. 目的と完成の定義
科学・技術・ものづくりの短尺動画を、ユーザーが選んだジャンルから発見するモバイル優先のWebアプリ。動画配信元は初期段階ではYouTubeのみ。動画本体は取得・保存・再配信せず、YouTube公式埋め込みプレーヤーを使う。

**2026-10-20のプロトタイプ完成条件**:
1. 初回はトップからジャンルを複数選び、そのまま動画フィードを開ける。一般閲覧にログインは不要。
2. 下部に常設の3タブ「動画」「検索」「プロフィール（設定）」がある。
3. ジャンルに合う管理者選定動画を、公式YouTubeプレーヤーで縦方向に連続視聴できる。スクロール・Playerのロード・停止が制御される。
4. YouTube標準プレーヤーのUI・ロゴ・リンク・広告・操作領域を独自UIで隠さない。
5. 動画がアクティブになった時点で視聴済みとし、未視聴を優先する。端末内に履歴・保存・興味なし・ジャンル選択を保持できる。
6. 登録済み動画を独自ラベル・キーワード等で部分一致検索できる。
7. 保存、興味なし、役立った、分類が違う、の基本操作ができる。
8. 管理者2名だけが使う保護された /admin で、動画とジャンルの登録・編集・有効/無効切替ができる。
9. D1を使い、管理操作は一般フィード・検索へ反映される。少なくともiPhone Safariで実機確認済み。

## 2. ユーザー体験と画面
### 2.1 初回
- トップ → ジャンル複数選択 → 直ちに動画フィード。
- 未選択で開始する扱いは実装時に簡潔に定める（初期案: 1つ以上選択必須）。
- 次回以降はジャンル設定を端末に保持し、フィードへ直接戻れる。
- ジャンルはOR条件。動画も複数ジャンルに所属可能。

### 2.2 共通ナビゲーション
- アプリの画面下部に、YouTubeプレーヤー領域と**重ならない**固定の3タブ: 「動画」「検索」「プロフィール（設定）」。
- 小画面・セーフエリア（iPhoneのホームインジケータなど）を考慮する。
- /admin は一般利用タブに含めず、別URLで管理者のみ利用する。

### 2.3 動画フィード
- 視聴中心の1画面1動画UI。動画のジャンル、自前の検索用ラベル、保存・役立った・興味なし・分類違い操作をプレーヤー外に配置。
- CSS `scroll-snap` は位置合わせに使い、アクティブ判定・再生停止・次動画先読み・アンロードはTypeScriptで扱う。
- 大量のiframeを同時に生成しない。初期目安は「現在±1件」を保持。プレーヤーの再生は同時に1つまで。
- iframeはスワイプ入力を捕捉し得る。**iPhone Safariで、プレーヤー内に触れたスワイプが期待どおり縦移動するか最初に検証する**。動かない場合はプレーヤーを覆わず、プレーヤー外の操作領域や明示的な前/次ボタンで移動可能にする。体験を偽装して実装済みとはしない。
- 公式IFrame Player APIを利用。自動再生できない場合は手動再生で継続可能にする。
- YouTubeの標準UI、広告、リンク、ロゴ等を遮蔽しない。プレーヤーの表示サイズは公式最低要件（200×200px以上）を満たす。
- 再生エラー時は種類により再試行または次へスキップできる。ブラウザの自動再生制限は「動画が無効」とは扱わない。

### 2.4 検索
- 対象は**Knowledge Streamの管理者が登録した有効な動画のみ**。YouTube全体の検索ではない。
- 初期は部分一致。管理者が入力する独自の`label`（動画の説明ラベル）、`search_keywords`、ジャンル名などを対象とする。YouTube公式タイトルを取得したり公式タイトルだと誤認させたりしない。
- 検索結果から動画を開ける。絞り込み・全文検索エンジン・候補サジェストは対象外。
- サーバー側で検索文字列と件数上限を検証し、SQLには必ずバインド値を使う。LIKE特殊文字とD1のパターン長制限に注意する。

### 2.5 プロフィール（設定）
- ジャンル選択・変更。
- 保存済みを参照する最低限の導線を用意。
- 視聴履歴削除、保存削除、興味設定初期化、端末内アプリデータ全削除を提供。
- **端末内データ削除はサーバーに送信済みの評価を消す操作ではない**と明記する。

## 3. 視聴済みとフィード生成
- **「動画に入った時点」= 画面上で1動画がアクティブになった時点**。中途半端に1px見えただけでは判定しない（実装目安: 表示率60〜70%以上）。再生終了イベントは使用しない。
- アクティブ時にLocalStorageへ内部video IDを追加。重複追加しない。
- **明確な埋め込み不可/削除等が判明した場合**、その遷移で新規に付けた視聴済み判定だけを取り消せる設計とする。
- 候補取得: WorkerがD1から選択ジャンルに該当する公開/有効動画を返す。
- **端末側の視聴済み・興味なしIDを原則サーバーへ送らない**ため、未視聴優先・興味なし除外・シャッフルはReact側の純粋なfeed関数で実施する（SQLには押し込まない）。候補が多い場合のページングは後から追加可能なAPI形式とする。
- 興味なしを除外し、未視聴→既視聴の順で各集合をシャッフル。同じ動画を無限に複製せず、候補を一巡したら再取得/再シャッフルで継続。

## 4. 動画データ・コンテンツ
- 10/20までの動画は**管理者2名が選定・登録したものだけ**。一般ユーザー投稿なし。
- 基本データ: Knowledge Streamの内部UUID、platform（初期youtube）、external_video_id、独自label、独自search_keywords、有効フラグ、可用性ステータス、日時。
- `UNIQUE(platform, external_video_id)`で重複登録防止。
- ジャンルはUUID付きcategoriesテーブル。video_categoriesは複合主キー。
- YouTube公式のタイトル/チャンネル/再生数等をData APIで収集しない。独自ラベルは独自説明として扱う。
- 公開動画・埋め込み可能・内容が知識発見につながる等の登録基準を定める。
- 非公開・削除・埋め込み禁止に備え、`enabled`（管理者判断）と`availability_status`（active/under_review/unavailable）を区別。失敗1回だけで全利用者に向けた無効化はしない。

## 5. 基本評価
- **保存**: LocalStorageに保持。解除できる。
- **興味なし**: LocalStorageで保持し、通常フィードから除外。
- **役立った / 分類が違う**: WorkerのPOST APIを通じD1へ記録。送信後の状態表示を行う。
- 匿名クライアントUUIDを端末で生成。評価送信時のみHTTPSで送信し、Workerが秘密鍵を使ってHMACして保存。識別子を視聴追跡や広告ターゲティングに流用しない。
- DBで`UNIQUE(video_id, client_hash, feedback_type)`等の重複制限。入力検証、リクエスト数制限、429応答を実装。
- クライアントUUIDは不正耐性のある本人証明ではない。匿名評価を企業向け確定指標として扱わない。
- 履歴のリセットでD1の評価は消えない。サーバー側評価の削除依頼・保持期間は公開前のプライバシー案内に明記。

## 6. 管理機能・認証
- `/admin`（および子パス）に管理画面。
- YouTube URLからVideo ID抽出、動画の追加・編集・有効/無効、独自ラベル/キーワード、複数ジャンル付与。
- ジャンルの追加・編集・有効/無効。報告/分類違いの管理者確認は可能な範囲で一覧化。
- **画面だけでなく `/api/v1/admin/*` も認証必須**。Cloudflare Accessで管理者2名のメールに限定し、WorkerでもAccess JWTの署名/issuer/audience/有効期限を検証。未設定・無効時はfail-closed。
- 管理操作はサーバー側で検証。Origin/CSRF等も考慮。秘密情報をLocalStorageやGitに置かない。

## 7. API境界と実装構成
- Frontend: React + TypeScript + Vite（モバイルファーストSPA）
- Hosting + API: Cloudflare Workers Static Assets + 単一のAPI Worker（モジュラーモノリス）
- DB: Cloudflare D1、手書きSQL＋薄いRepository層。ORM、KV、Queues、R2、YouTube Data APIは初期導入しない。
- 公開API例: `GET /api/v1/categories`、`GET /api/v1/feed?categories=...`、`GET /api/v1/search?q=...`、`POST /api/v1/feedback`。
- 管理API例: `/api/v1/admin/videos`、`/api/v1/admin/categories`。
- フロントはHTTP APIと共有DTOのみを知る。D1の内部行/レスポンス形式やCloudflare BindingをUIへ漏らさない。
- DBのSQLはRepository（Video/Category/Feedback）内に集中させる。純粋ロジックは別関数に分け、過剰なClean ArchitectureやDIコンテナは導入しない。
- IDは内部UUID v4。外部動画IDとは分離。DB変更はGit管理の`migrations/`ファイルのみで実施。適用済みmigrationを原則書き換えない。
- LocalStorageアクセスは`clientStateRepository`等の単一ラッパー経由。

### データモデル（概念）
- `videos(id, platform, external_video_id, label, search_keywords, enabled, availability_status, last_checked_at, last_error_code, created_at, updated_at)`
- `categories(id, name, enabled, created_at, updated_at)`
- `video_categories(video_id, category_id)`
- `feedback(id, video_id, client_hash, type, created_at)`
- 追加の補助テーブル/INDEXはmigrationで必要最小限作成。

## 8. 環境・運用・セキュリティ
- local / staging / productionを区別。ステージングと本番のD1は別DB。ローカル開発から本番DBを直接操作しない。
- 秘密情報はCloudflare Secretsやローカル非追跡のdev varsで管理。`VITE_*`には秘密を置かない。
- migrationの反映はlocal→staging→productionの順。production反映前に確認する。
- D1 Time Travelに加え、重要変更前の手動SQLエクスポートと、実証開始後の週次バックアップを計画。バックアップはGitに入れず、復元テストを1回行う。
- HTTP API/DB/プレーヤーエラーの最低限の診断記録を残す。認証トークン・クライアント識別子等の生値をログへ出さない。
- UIには再生不可時の案内、再試行/スキップ、読み込み表示、再生開始の代替手段、アクセシビリティ上のラベル/タップ領域を確保。
- デプロイ前に最低限の利用案内・プライバシー案内を作成。
- 公式埋め込み要件（プレーヤーを遮らない、適切なReferer、同時自動再生1本、半分以上可視になってから自動再生等）を順守する。

## 9. 最低限の検証
- ジャンル複数選択はOR条件、無効動画は出ない。
- 未視聴優先、興味なし除外、アクティブ判定で視聴済み。
- 検索で独自ラベル・キーワードの部分一致、予期せぬ文字や長文入力に対する検証。
- 動画プレーヤー内のスワイプ操作を**実機で**検証し、だめなら代替操作あり。
- 同時に再生するプレーヤーは1つ。自動再生ブロック/通信不良/埋め込み禁止を扱う。
- 匿名評価の重複と連投を拒否。管理APIの未認証アクセスを拒否。
- 管理画面で動画を無効化→一般画面から消える。
- iPhone Safariは必須。可能ならAndroid Chrome/PCも確認。
- ビルド、型チェック、最低限の単体/統合テストが通る。

## 10. 対象外
TikTok/Instagram、AI自動分類、一般動画投稿、独自動画アップロード、YouTube Data API、一般ユーザーログイン、端末同期、コメント、本格的広告配信、企業分析、自動動画公開状態巡回、高度な推薦。広告カードは余裕があればダミーのみ。

## 11. 確認が必要な実装上のリスク
1. iframe内部スワイプとページスクロールの競合。最初の技術検証で解決方針を選ぶ。
2. iPhone Safariの自動再生・Player状態の差異。
3. Cloudflare Accessの管理系パス保護とWorker側JWT検証、公開経路の抜け漏れ。
4. 10/20に現実的な初期動画リスト・分類の準備。

上記は**未検証の事項**であり、ドキュメントで決めただけでは実装完了とは扱わない。

## 12. 公式参考資料
- Cloudflare React + Vite: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- Cloudflare Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- YouTube embedded player requirements: https://developers.google.com/youtube/terms/required-minimum-functionality
