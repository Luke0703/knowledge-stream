# Knowledge Stream

技術・科学・ものづくり系の短尺動画を、選んだジャンルに応じて縦型フィードで発見・視聴するモバイル優先Webプロトタイプ。

**完成目標: 2026-10-20**

## 現在の状態
**設計・実装計画・Codex指示・開発Issueの準備が完了。アプリ本体の実装はまだ始まっていません。**

## 開発ドキュメント
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

## 最初にやること
Codexでこのリポジトリを開き、[docs/CODEX_START.md](docs/CODEX_START.md)の初回依頼を実行する。**最初はIssue #1だけに取り組み、D1作成・本番デプロイ・Cloudflare秘密情報の登録はまだしない。**

## 採用技術
React + TypeScript + Vite、Cloudflare Workers + Static Assets、Cloudflare D1、YouTube IFrame Player API。YouTube動画本体は取得・保存・再配信しない。

## 主要原則
- ユーザー側にログイン不要、管理画面だけCloudflare Accessで保護
- 下部「動画 / 検索 / プロフィール（設定）」タブ
- 動画に入った時点で視聴済み
- 検索対象は管理者選定の登録済み動画のみ（部分一致）
- 公式YouTubeプレーヤーのUIを独自UIで覆わない
- 最初にiPhone Safariでプレーヤーとスクロールの相性を検証する
