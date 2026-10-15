# Codex — 最初の実装タスク

## リポジトリ
`Luke0703/knowledge-stream`（Private）
実装前にルートの`AGENTS.md`、`docs/SPEC.md`、`docs/PLAN.md`を必ず読むこと。

## 最初の依頼（そのままCodexに入力）

> このGitHubリポジトリの`AGENTS.md`、`docs/SPEC.md`、`docs/PLAN.md`を読んだ上で、**Phase 1「React/TypeScript/Vite + Cloudflare Worker基盤とYouTube縦型フィードの技術スパイク」だけ**を実装してください。
>
> Cloudflare公式の React + Vite + Worker API テンプレートに準じた構成を優先してください。固定の動画データ3〜5本で縦フィードを作り、CSS scroll-snapとTypeScript側のactive判定・プレーヤー状態管理・現在前後だけのロード制御を分担してください。
>
> YouTube IFrame Player APIを使い、ロゴ/リンク/広告/コントロールを覆う独自UIを一切設置しないでください。下部の「動画・検索・プロフィール」の3タブは配置だけ先行し、画面の中身やD1/管理画面/評価APIは今回まだ実装しないでください。動画は実在を確認できる公開・埋め込み可能なテスト用URLを使用し、確認できない場合は`README`に差し替え方法を明記してください。プレーヤー内部のスワイプでページ遷移できるとは仮定せず、必要なら**iframe外の前/次操作**を設けてください。
>
> 変更は`feature/phase-1-player-spike`ブランチ上で行い、型チェックとbuild（可能ならテスト）を実行して結果を示してください。GitHub PRが開ける環境ならmain向けにDraft PRを作ってください。無理なら変更ファイルと検証結果・次の手順をまとめてください。**本番デプロイ、Cloudflareアカウント設定、D1作成、秘密情報の登録、他Phase実装は行わないでください。** PCのiPhone Safari実機テストが必要な箇所を明確に記載してください。
>
> スコープ拡張や危険なショートカットを行わず、まず完成した技術スパイクを見せてください。

## 作業前確認
- PCでCodexアプリ（または対応環境）を開く
- GitHubの`Luke0703/knowledge-stream`を利用可能な状態にする（cloneまたは対応するリポジトリ接続）
- Codexが`AGENTS.md`と`docs/SPEC.md`を参照できることを確認
- 現段階ではCloudflareのログイン情報やAPIキーを渡さない

## Phase 1後の確認項目
1. build・型チェックの結果
2. iPhone Safariでの動画表示とスクロール
3. プレーヤーがタッチ操作を受け取ったときの操作方法
4. 前の動画の再生停止・不要iframeの破棄
5. 自動再生不可・埋め込み不可時の案内
6. YouTube標準UIが隠れていないこと

Phase 1が動いたらPhase 2以降を別Issueとして依頼する。完成済みと報告されても未実機検証は未検証のまま扱う。
