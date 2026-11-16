# Knowledge Stream — Museへの開発引き継ぎ書

作成日: **2026-11-08（日本時間）**。この文書だけで現状・制約・再開方法を把握できるようにまとめています。ソース全体は下記GitHubブランチにあります。認証情報・秘密情報は含めていません。

## 1. 最初に把握すること

現在は **Phase 1基盤＋Phase 1.5のYouTube Shorts技術スパイク**です。固定Shorts 3本を表示・切り替えるアプリは実装されていますが、製品仕様全体の完成ではありません。

最大の未解決事項は、利用者がPC/iPhoneの両方で報告した「使ううちにサイト全体が非常に重くなる」症状です。直近の変更でiframe再生成を減らしましたが、長時間使用での完全解消は確認していません。自動再生制限も別問題として残ります。テスト成功を実機での解決と混同しないでください。

ユーザーの最新の希望:

- スマホで動画をほぼ全画面の大きさにしたい。
- 初期から音声オンで、できるだけ操作なしで再生してほしい。すぐ音が鳴っても構わない。
- 独自の音声オン/オフボタンはいらない。YouTube公式の操作は残す。
- 全変更をGitHubにバックアップし、コードの説明と検証結果を付けてほしい。
- 改修が難航しているため、今後の開発をMuseに引き継ぎたい。

**今回の引き継ぎ作成ではアプリコードを変更していません。** 次の最小作業は第9節の再現・計測です。Phase 2以降へ勝手に広げないでください。

## 2. リポジトリと受け渡し対象

| 項目 | 現在確認できた内容 |
| --- | --- |
| リポジトリ | https://github.com/Luke0703/knowledge-stream |
| 作業ブランチ | `feature/phase-1-player-spike` |
| 引き継ぎ対象のアプリコード | `284121c63a2378280e9ce140b300c551b11aecdb`（`284121c`） |
| コミットの内容 | `fix: reuse bounded YouTube players and expand mobile video` |
| PR | https://github.com/Luke0703/knowledge-stream/pull/7 |
| PRの状態 | 2026-11-08確認時: Open / Draft / main向け / 未マージ |
| mainの確認時SHA | `cea706ea224c2b15fc91ea0bb3977177ec1c9f1b` |
| 変更開始前のローカル状態 | 作業ツリーはclean。ローカルHEAD・リモートブランチ・PR headは上記アプリSHAで一致 |

この文書を追加するコミットは上記アプリSHAの後になります。最新の文書はブランチから、比較用のアプリ実装は固定SHAから取得できます。mainだけを取得すると、この技術スパイクのコードが揃いません。PRのDraft解除・マージは未実施です。

既存PCのリポジトリ:

```text
C:\Users\Sakod\Documents\Codex\2026-10-15\github-plugin-github-openai-curated-remote-2\work\knowledge-stream
```

新しい環境では、既存のGitHubアクセス権を使い次を実行します。トークンを文書やコマンドに直接書かないでください。

```sh
git clone --branch feature/phase-1-player-spike https://github.com/Luke0703/knowledge-stream.git
cd knowledge-stream
git status --short --branch
git log -5 --oneline
```

既存cloneでは先に未コミット変更を確認し、破棄・強制リセットしないこと。`node_modules`、`dist`、ローカルログはGitには入っていません。アプリのデータベースやサーバー保存データの移行作業はありません。

## 3. 仕様と実装の対応

| 項目 | 状態と注意点 |
| --- | --- |
| React / TypeScript / Vite / Worker | 実装済み。Cloudflare公式React + Vite構成に準じたSPA＋単一Worker |
| 固定の動画フィード | 公開YouTube Shorts 3本。無限フィードではなく、先頭・末尾がある |
| URLからID抽出 | Shorts、watch、短縮、embed等に対応。形式検証は実在・埋め込み可否の証明ではない |
| 縦配置・スクロール | CSS scroll-snap。active判定・再生制御はTypeScript |
| iframe内スワイプ | 独自のジェスチャー取得は未実装。過去端末で移動できたという利用者報告あり。全環境で保証しない |
| 代替移動 | iframe外の「前へ」「次へ」。透明なスワイプレイヤーなし |
| 動画ロード | 現在±1がロード対象。iframe自体は最大3個を保持して再利用 |
| 再生 | 十分見えているactive 1本だけ再生を要求。非activeや背景では停止制御 |
| 自動再生 | 音声オンで要求する実装あり。ブラウザーの拒否時は標準操作／外側「再生する」で続行 |
| エラー復帰 | 再試行、読み込み待ちの案内、外側の前/次。準備中で永久に詰まらないかは実機再確認が必要 |
| 3タブ | 動画・検索・プロフィールの配置のみ。検索とプロフィールはdisabled |
| ジャンル | 固定データの表示用文字列のみ。選択・OR絞り込み・管理は未実装 |
| 検索 | UI本体・検索API・検索処理とも未実装 |
| 視聴履歴・保存・興味なし | 未実装。active検出だけでは履歴保存済みと扱わない |
| 未視聴優先・シャッフル | 未実装 |
| LocalStorageラッパー・端末データ削除 | 未実装。アプリ独自の永続設定なし |
| D1・migrations・Repository | 未実装。D1 bindingもなし |
| 管理画面・Access/JWT認証 | 未実装。未知のadmin APIが404になることは認証実装ではない |
| 評価・匿名ID・HMAC・レート制限 | 未実装 |
| API | `GET /api/v1/health`のみ。GET成功200、他メソッド405、未知APIはJSON 404 |
| 本番公開・Cloudflare設定 | 未実施。LANローカル検証のみ |

当初から変更された点:

1. 横長テスト動画 → 実際のShorts 3本。
2. 9:16中心の固定比率表示 → 画面の利用可能な高さへiframeを拡大。現在のCSSは厳密な9:16固定ではない。YouTube自身が映像全体を収めるので黒帯が残る場合がある。
3. 初期ミュート → 音声オン。途中で外側音声ボタンを追加したが、最新の利用者希望で削除。
4. 現在±1の範囲を外れたiframeをすぐ破棄 → メディア停止とiframe保持を分離し、最大3個を再利用。
5. activeの判定とロード中心を分離。画面の一部が隠れて自動再生対象を選べなくても、動画ロードが止まらないよう修正。

元のSPEC/PLANの「2026-10-20完成」は過去の計画であり、達成済みではありません。日付だけで他Phaseの実装を推定しないでください。

## 4. 技術構成とコードの読み方

`package.json`指定: Node `>=22.12.0`、pnpm `11.25.0`。React `^19.3.0`、TypeScript `^7.0.2`、Vite `^8.3.4`、Cloudflare Vite plugin `^1.63.2`、Wrangler `^4.150.0`、Vitest `^5.0.4`。これらはpackage.jsonの範囲指定です。正確な解決済み依存は`pnpm-lock.yaml`を使い、再開時に一括更新しないこと。

| ファイル | 責務・引き継ぎ時の注意 |
| --- | --- |
| `src/App.tsx` | 固定動画、health取得、3タブ、queryによる先読み比較と診断の開始 |
| `src/videos.ts` | 動画の一元管理。内部UUID・外部YouTube ID・独自ラベル・ジャンル文字列 |
| `src/VideoFeed.tsx` | スクロール位置、可視面積、ロード中心、iframe保持対象、外側前/次 |
| `src/player/visibility.ts` | active条件と最大3個の保持対象を選ぶ純粋関数 |
| `src/player/PlaybackCoordinator.ts` | 再生権限の一元管理。古い動画をpauseしてから次へunMute/play |
| `src/player/YouTubePlayer.tsx` | IFrameの生成・ready・停止/再利用・エラー・タイマー・破棄 |
| `src/player/youtubeApi.ts` | APIスクリプトの共有ロード、15秒タイムアウト、失敗時再試行 |
| `src/player/youtubeUrl.ts` | URLまたは生IDからYouTube IDを抽出 |
| `src/player/diagnostics.ts` | オプションのローカル診断ログ。通常URLでは定期計測しない |
| `src/styles.css` | scroll-snap、画面高の配分、safe-area、公式UIを覆わないレイアウト |
| `worker/index.ts` / `shared/api.ts` | healthと共有DTO。DB接続なし |
| `vite.config.ts` / `wrangler.jsonc` | Cloudflare SPA/API基盤とLANモード設定 |
| `tests/*.test.*` | feed / player / playback / URL / Workerの5ファイル |

### 再生制御で維持する性質

- カード可視率65%以上、プレーヤー可視率50%以上、documentがvisibleのときにactiveを再生対象とする。ロード中心はフィード内の位置から別に計算する。
- 前/次はフィードだけを即時スクロールし、クリックハンドラー中に可視判定・再生要求を行う。隣接Playerが未準備なら、この操作だけで後の自動再生まで保証できない。
- 新規Player生成は150ms遅延。素早く通過してunmountされた場合は生成を取り消す。
- 範囲外のPlayerは登録解除・`stopVideo()`。iframeは枠内なら保持し、再びactiveになったとき`loadVideoById()`でロードと再生を要求する。枠外・再試行・unmountで`destroy()`。
- `cueVideoById()`直後の`playVideo()`は、過去のPC試作で非同期の競合により再生待機に戻った。そのため現在は再ロードと再生を1コマンドにしている。
- 準備応答15秒、バッファリング12秒で復帰操作を案内。APIスクリプト自体の15秒待ちとは別タイマー。
- `playerVars.autoplay: 0`は自動再生機能がないという意味ではない。Coordinatorが適格な動画だけに明示的に再生要求するための設定。全iframeを一律`autoplay: 1`に変えない。
- 再生要求ごとに`unMute()`を送る。標準UIでミュートした場合、その再生中は維持されるが、次の再生要求（切替・明示再生・タブ復帰等）では音声オンに戻る。

### テスト動画

| 独自ラベル | 実データのURL |
| --- | --- |
| ピザで円周率を考える | https://www.youtube.com/shorts/pgGrQjYcm5A |
| 真球に近いシリコン球と計測 | https://www.youtube.com/shorts/uDeQB9OkoXY |
| 風洞で観察する雨粒のかたち | https://www.youtube.com/shorts/Ko02mUWhItA |

過去に実在と埋め込み再生を確認したテスト用データです。2026-11-08に3本すべての外部再生を再検証したわけではなく、将来の公開継続も保証しません。差し替える場合は`src/videos.ts`の`videoSources`のみを編集し、新しい内部UUIDと実際に検証した公開URLを設定します。IDを推測・捏造しないこと。

## 5. 検証の証拠と限界

### 今回の確認（2026-11-08）

- ローカルコード・AGENTS・SPEC・PLAN・主要な検証記録を読み直し、GitHub PRとremoteのアプリSHA一致を確認。
- 型チェック・production build・5ファイル52テスト成功（Vitest `--maxWorkers=1`、49.20秒）。既存依存を使って再実行し、新規環境での依存インストールは今回未検証。文書追加後の`git diff --check`も確認する。
- PCのWi-Fi IPv4は`192.168.11.5`。ただし`http://localhost:4174/api/v1/health`は接続拒否で、**4174の検証サーバーは利用可能と確認できていない**。ブラウザーにURLが残っていても起動中とは限らない。再開時に第8節で起動する。
- 今回、PCブラウザーで動画再生・iPhone実機・長時間の性能は再検証していない。

### 前回までに開発側で確認したこと（主に2026-11-01）

- 型チェック・build・5ファイル52テスト成功。
- モックによる100回の移動でPlayer生成3個、30回の停止/再利用でも同一iframe、5件以上でも保持上限3個をテスト。実際のYouTubeやSafariの挙動を代替するテストではない。
- 変更前のPCで4回移動: `created=4, destroyed=2`。無操作時にはアプリ側の計測・再生要求が増え続ける現象は観測しなかった。メモリリークを実証したわけではない。
- 最新方式で最初の手動再生後に12回移動: `created=3, destroyed=0, mediaStopped=6, reused=5, iframes=3`。戻った動画の再生を確認。
- さらにPC幅で高速キーボード移動8回、計20回後も生成数3。後続確認は一時停止だったため「全移動で自動再生成功」とは扱わない。その後の手動操作と次への移動では再生中を確認。
- 約230秒時点でも生成数3。親ページのLong Tasksは0だったが、YouTube iframe内部のCPU/GPU/メモリ全体の測定ではない。
- PCで初回の音声付き自動再生拒否を観測。手動再生で開始できた。

PCの画面サイズ変更による表示確認:

| 画面 | 公式iframeの表示領域 | 限界 |
| --- | --- | --- |
| 390×844 | 再生中およそ380×755px（画面高の約89%） | 映像そのものの占有率ではない。手動操作案内が出ると48px縮む |
| 320×568 | 案内ありおよそ310×431px | iPhone実機のURLバー・safe-area測定ではない |
| 844×390 | 540×200px以上、独自操作と非重複 | 文書高400pxのため約10pxのページスクロールあり |

### 利用者からの実機報告

- 機種/iOSは **iPhone 18 Pro / iOS 27.0.1（利用者申告）**。
- 過去の横動画版で再生、前後切替と前の音声停止、動画内外のスワイプ、横向きでボタンが重ならないことを報告。
- 過去のShorts版で3本の動作を肯定的に評価。その後、標準ミュート解除が見つからない問題を報告。外側音声操作を加えた版では音声とオン/オフを確認したが、最新コードではその外側ボタンは削除済み。
- 読み込み待ちだけでなく、やがてサイト全体が重くなると報告。YouTube側は同程度には重くないとの報告だが、YouTubeアプリかSafariか等の比較条件は未確定。
- `?preload=off`でも重さが残り、高速往復後に「近づくとロード」「プレーヤーを準備中」のままになると報告。
- PCでも非常に重いとの報告に対し、最新のiframe再利用方式へ変更した。**その修正版に対する利用者の長時間再テスト結果はまだない。**

以前の成功報告を、最新UI・全端末・全通信条件の合格として転記しないでください。

## 6. 自動再生の制約と未解決の希望

音声を自動でオンにするコードはすでにあります。「ユーザーが音が鳴ってよいと言ったのにアプリが自主的にミュートしている」という状態ではありません。音声付き再生要求をブラウザー側が許可するかが別の条件です。

- Safariでは実際のタップ等と再生要求の関係が重要です。準備完了を非同期で待った後の再生は、最初のタップと同じ条件にはなりません。[WebKit公式説明](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- Chromeもユーザーの操作・利用履歴等で音声付き自動再生を制限します。iframeの`allow="autoplay"`は許可の委譲であり、あらゆる制限を解除する指定ではありません。[Chrome公式説明](https://developer.chrome.com/blog/autoplay/)
- `.click()`や合成イベントでは、本物の操作としてのuser activationを作れません。[MDN User activation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation)
- IFrame APIの`onAutoplayBlocked`で拒否を扱えます。現在そのイベントから外側の手動操作へ案内しています。[YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)

一般のWebページで「初回から操作なし・音声あり」を全Safari/Chrome環境へ保証する解決策は確認できていません。最初に実タップを受けて以後の操作回数を減らす方向には改善余地がありますが、未実装の案です。勝手なミュート開始への変更、疑似タップの無限再試行、ブラウザー保護設定の無効化を解決済みとして提出しないでください。WebKitの参照記事は基礎仕様の説明であり、利用者申告のiOS版の実機確認の代わりにはなりません。

## 7. 診断方法と既知の注意点

| URLのquery | 動作 |
| --- | --- |
| なし | 通常の最大3iframe再利用方式。診断タイマーなし |
| `?diagnostics=1` | Consoleへ5秒ごとの`[player-diagnostics]`集計 |
| `?preload=off` | 保持1個、隣接ロードなしの比較。切替で再生成される。解決策として採用したわけではない |
| `?preload=off&diagnostics=1` | 比較と計測を同時に行う |

診断値: `measure`（可視判定回数）、`created`、`destroyed`、`playRequests`、`stateEvents`、`mediaStopped`、`reused`、現在の`iframes`、`longTasks`/`longTaskMs`、経過秒。イベントが未発生なら項目が省略される場合があります。対応しないブラウザーのLong Tasksはnull。外部送信・永続保存・動画ID記録はありません。比較ごとにページを読み直し、同じ操作と時間で記録します。

既知の未解決事項:

1. 長時間での重さ: 原因未確定。iframe生成削減は確認できたが、保持3個分のメモリは残る。単一Playerへの再設計は候補であって合意・実装済みではない。
2. 高速移動後の停止/準備中: 過去のロード中心の問題を修正済み。ただし最新の高速移動すべてで自動再生するとは確認できていない。
3. 自動再生拒否: 標準操作と外側再生で復帰可能にしているが、ユーザー希望との隔たりがある。
4. 最新UIのiPhone: safe-area、URLバー開閉、横向き、公式音声ボタン、広告、全画面復帰を再確認する必要がある。
5. 古い資料の矛盾: `docs/IPHONE_SAFARI_QA.md`には削除済みの外側音声ボタン・設定保持の説明が残る。現状はこの引き継ぎ書と実コードを優先。時系列資料の古い成功記録も最新の合格とは限らない。

## 8. 起動・検証・スマホへの共有

必要なのは依存インストールとローカルビルドです。Cloudflareログイン、D1、Secretsは不要です。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test --maxWorkers=1
pnpm preview:lan
```

`preview:lan`は`vite preview --mode lan --host 0.0.0.0 --port 4174 --strictPort`です。LANモードはWorker inspector、Local Explorer、remote bindings、tunnelを無効化します。PCとスマホを同じWi-Fiへ接続し、サーバー起動中に次へアクセスします。

- PC: `http://localhost:4174/`
- スマホ: `http://<PCのWi-Fi IPv4>:4174/`。確認時IPなら `http://192.168.11.5:4174/`
- 疎通確認: `http://<PCのWi-Fi IPv4>:4174/api/v1/health` → `{"ok":true,"phase":1}`

IPは変わるため、ViteのNetwork表示または次で毎回確認します。スマホのlocalhostはスマホ自身なので使いません。過去にSafariがHTTPSとして開いて接続に失敗し、**http://を省略せず直接入力**すると解決しました。

```powershell
Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 | Select-Object IPAddress
```

既存Windows環境ではpnpmがPATHにない場合があります。次のランタイムは今回存在を確認済みです。別PCでは自身のNode/pnpmを使ってください。

```powershell
$pnpmCli = 'C:/Users/Sakod/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs'
$env:WRANGLER_LOG_PATH = Join-Path (Get-Location) '.wrangler/logs'
$env:WRANGLER_SEND_METRICS = 'false'
node $pnpmCli install --frozen-lockfile
node $pnpmCli typecheck
node $pnpmCli build
node $pnpmCli test --maxWorkers=1
node $pnpmCli preview:lan
```

各コマンドの成功を確認して次へ進みます。`node`もPATHにない場合の既存実体は`C:/Users/Sakod/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`です。

サーバーはターミナルを開いたまま維持し、停止はCtrl+C。コード更新時は停止→build→preview再起動→Safari再読み込み。古いpreviewがビルド済み資産を参照したままだと白画面になることがありました。ポート使用中なら対象プロセスを確認し、無関係なNodeをまとめて停止しないこと。過去のPIDは再利用しないでください。

PCからLANへアクセスできてもiPhone疎通の証明にはなりません。接続できない場合はPCのスリープ、Wi-Fi端末間通信制限、VPN、Windows受信ルールを切り分けます。公開トンネル、ルーターのポート転送、ファイアウォール全停止は不要です。

## 9. Museが次に行う最小作業と完了条件

**最初の作業単位: 現在のSHAを固定して、PCでの重さを再現・計測し、原因を絞る。** 再生方式全体の作り直しと新機能追加を同時に行わないでください。

1. Gitの状態を確認し、上記アプリSHAとの差分を把握。既存テストを通し、LANサーバーを起動する。
2. 旧検証タブを閉じ、PCのブラウザー名/版、iPhone機種/iOS、通信条件を記録する。通常URLと診断URLを区別する。
3. 3本を再生して前/次を通常速度で往復、その後高速往復、最後に無操作待機。提案する最小観察時間は各環境5分以上、30回以上の切替。これはこれから行う検証基準で、既に通過した記録ではない。
4. 開始・中間・終了の診断値と操作応答を記録。PCでは可能ならブラウザーのPerformance/Memory/タスク管理でiframeを含むプロセス負荷を確認。親ページのLong Tasksだけで結論を出さない。
5. 同じ条件で先読みオフと比較し、全体の応答悪化・YouTubeのbuffering・autoplay拒否を別に記録する。悪化が再現しなければ解決と断定せず、利用者の再現条件を集める。
6. 根拠が得られた箇所だけ最小修正し、回帰テスト・型チェック・build。同じ手順で修正前後を比較する。

この作業の完了条件:

- 原因候補が計測と結び付き、何を直した／何が未確定か説明できる。
- 最新版で表示中の動画が未ロード表示のまま取り残されず、拒否/エラー時に手動操作または次へで継続できる。
- 同時音声が重ならず、背景・非activeの動画が再生を続けない。保持数が上限を超えない。
- 継続操作による応答悪化の有無をPCとiPhoneで明記する。端末がなければ「実機未確認」として残す。
- 自動テスト、型チェック、buildの結果と残件をPRに反映し、ブランチをpushする。

その後の独立した作業は「最初の実タップ後、次動画に必要な追加タップをどこまで減らせるか」の検証です。音声付き自動再生を保証する約束はせず、必要な製品判断は利用者と合意します。iPhoneでは内側スワイプ/外側操作を別々に試し、URLバー、画面回転、公式コントロール、広告、ホーム/ロック復帰、全画面復帰も確認します。

## 10. 守る範囲・参照資料

必須: 公式YouTube IFrame API、公式UI/ロゴ/リンク/広告を覆わない、動画をダウンロード・保存・代理配信しない、プレーヤー上に透明タッチレイヤーを置かない。動画は現在と前後だけをロード対象にし、再生を同時1本に制御します。

現段階で着手しない: D1、検索本実装、管理画面、評価API、他Phase、全面デザイン刷新、本番デプロイ、Cloudflareアカウント設定、秘密情報登録。必要になったら別作業として明示的に範囲を決めます。

今後の製品仕様は、ジャンル複数選択（OR）→フィード、独自メタデータの検索、active時点の端末内視聴履歴、保存/興味なし、未視聴優先、管理者選定動画とジャンルのCRUD、Access＋Worker JWTで管理APIも保護、D1の匿名評価です。これは将来計画であり実装済みではありません。

リポジトリ内の参照順:

1. `AGENTS.md` — 開発・セキュリティ・YouTubeの制約。
2. `docs/SPEC.md` / `docs/PLAN.md` — 当初の全体仕様・Phase分割（旧日程）。
3. この文書 — 最新状態とユーザーの変更希望。
4. `docs/PHASE1_CODE_GUIDE.md` — コード責務の説明。
5. `docs/PHASE1_5_SHORTS.md` — 日付ごとの検証・試行と失敗の記録。最新節は2026-11-01。
6. `docs/IPHONE_SAFARI_QA.md` — LAN接続・旧実機記録。音声操作等の古い説明に注意。
7. Draft PR #7（関連Issue #1）— 変更点・検証結果・レビューの窓口。

過去のスクリーンショット等は既存PCのリポジトリ外`../../outputs/`にあります。移行や実行には不要で、最新実機合格の証拠としては扱いません。秘密ファイル、キャッシュ、認証状態、個人ブラウザー情報をまとめて移送する必要はありません。

## 11. Museへ最初に渡す指示

> この引き継ぎ書とGitHubのfeature/phase-1-player-spikeを確認してください。Phase 1/1.5のまま、まずPC/iPhoneで使ううちに重くなる問題の再現と原因切り分けを進めてください。現在のアプリ実装基準は284121cです。コード・今回の実行結果・過去の利用者報告を区別してください。動画は大きく、音声はオンを希望し、独自音声ボタンは不要です。公式YouTube UIを覆わず、iframe外の移動と拒否時の手動復帰を維持してください。自動再生制限を疑似クリックで解決した扱いにしないでください。D1・検索・管理・評価・本番公開には進まず、小さい変更と比較検証を行い、型チェック/build/テスト結果を添えて既存ブランチとDraft PR #7へ反映してください。
