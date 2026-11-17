# Knowledge Stream — D1 手動バックアップ・復元手順

- 位置づけ: SPEC §8 の「D1 Time Travel に加え、重要変更前の手動SQLエクスポートと、実証開始後の週次バックアップ」に対応する運用手順。
- 対象DB: D1 `knowledge-stream`（videos / categories / video_categories / feedback / d1_migrations）。
- バックアップファイルは Git に入れない。保存先はリポジトリ内の `backups/`（`.gitignore` 済み）か、リポジトリ外の安全な場所とする。

## 前提

- `wrangler` が使えること（このリポジトリでは `./node_modules/.bin/wrangler`、バージョン 4.150.0 で実測）。
- 対象の指定:
  - ローカルDB: `--local` を付ける（`wrangler dev` / vite 開発で使う `.wrangler/state` のDB）。
  - リモートDB（staging / production）: `--remote` を付ける。**リモートへの復元は本番データに直接影響するため、必ず Kazuki の承認のもとで実施する**（AGENTS.md の規約）。
- 現状の `wrangler.jsonc` は単一環境で、`database_id` はプレースホルダのまま。実環境（staging / production）を構築したら、環境ごとのDB名とIDをこの文書に追記すること。
- エクスポートされるSQLにはスキーマ（CREATE TABLE）と全データ、さらに `d1_migrations` テーブルの内容まで含まれる。そのまま空のDBへ流し込めば、migration 適用済み状態ごと復元できる。
- feedback テーブルの `client_hash` は HMAC 化済みの値であり、生の匿名クライアントIDはバックアップにも含まれない。ただし運営データであることに変わりはないので、バックアップファイルの取り扱いには注意する。

## バックアップ手順（エクスポート）

実施タイミング: 重要な変更（migration 追加、本番データの大量編集など）の前、および実証開始後は週次。

```bash
# ローカルDBの場合
./node_modules/.bin/wrangler d1 export knowledge-stream --local \
  --output backups/knowledge-stream-local-YYYYMMDD-HHmm.sql -y

# リモートDBの場合（--remote。対象環境を取り違えないこと）
./node_modules/.bin/wrangler d1 export knowledge-stream --remote \
  --output backups/knowledge-stream-remote-YYYYMMDD-HHmm.sql -y
```

- ファイル名には対象（local / staging / production）と日時を含める。
- 終了メッセージ `Done!` を確認し、ファイルに `INSERT INTO` が含まれていることを目視する（空ファイルでないこと）。
- スキーマだけ、データだけを取りたい場合は `--no-data` / `--no-schema` が使える（通常のバックアップでは付けない）。

## 復元手順（インポート）

復元先に既存のテーブルとデータがある状態でエクスポートファイルを流すと、主キーや UNIQUE 制約の重複で失敗する。**復元は「空のDB」に対して行うのが原則**。既存DBへ戻す場合は、先に現状を退避してからテーブルを消す。

1. （既存DBへ戻す場合のみ）現在の状態を別名でエクスポートして退避する（上記バックアップ手順）。
2. （既存DBへ戻す場合のみ）既存テーブルを削除する。外部キーの依存があるため feedback と video_categories を先に消す。

   ```bash
   ./node_modules/.bin/wrangler d1 execute knowledge-stream --local \
     --command "DROP TABLE IF EXISTS feedback; DROP TABLE IF EXISTS video_categories; DROP TABLE IF EXISTS videos; DROP TABLE IF EXISTS categories; DROP TABLE IF EXISTS d1_migrations;"
   ```

   （リモートの場合は `--local` を `--remote` に読み替える。DROP は取り消せないので、退避が済んでいることを必ず確認する。）

3. バックアップファイルを流し込む。

   ```bash
   ./node_modules/.bin/wrangler d1 execute knowledge-stream --local \
     --file backups/knowledge-stream-local-YYYYMMDD-HHmm.sql
   ```

   全ステートメントが `"success": true` で終わることを確認する。

4. 下の「復元確認チェックリスト」で検証する。

## Time Travel との関係

- リモートD1には Time Travel があり、`wrangler d1 time-travel restore knowledge-stream --timestamp <ISO時刻>` で過去の任意時点へ戻せる（保持期間はプラン依存）。
- Time Travel は「DB全体を過去時点に戻す」機能で、現在の状態は失われる。手動エクスポートは「任意の時点の控えをファイルとして残す」もので、両者は補完関係にある。重要な変更の前には、Time Travel に頼らず手動エクスポートも取っておくこと。

## 復元確認チェックリスト

- [ ] テーブルが揃っている: `SELECT name FROM sqlite_master WHERE type='table';` で videos / categories / video_categories / feedback / d1_migrations がある。
- [ ] 行数がバックアップ時点と一致する:
  `SELECT (SELECT COUNT(*) FROM videos) AS videos, (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM video_categories) AS video_categories, (SELECT COUNT(*) FROM feedback) AS feedback, (SELECT COUNT(*) FROM d1_migrations) AS migrations;`
- [ ] 代表データの内容が一致する（例: 任意の videos 行の label と enabled、feedback 行の feedback_type）。
- [ ] `./node_modules/.bin/wrangler d1 migrations list knowledge-stream --local`（リモートは `--remote`）が「No migrations to apply」になる（migration 状態まで復元できている証拠）。
- [ ] （実環境のみ）アプリ疎通: `GET /api/v1/categories`、`GET /api/v1/feed` が復元前と同じ内容を返し、/admin にログインできる。Kazuki 同席で実施する。

## 実測記録

### 2026-11-17 ローカルD1での往復テスト（復元テスト1回目）

SPEC §8 の「復元テストを1回行う」を、ローカルDBで実施した。

- 手順: ローカルDB（videos 4件 / categories 3件 / video_categories 4件 / feedback 0件）に検証用 feedback を1件追加 → エクスポート（INSERT 15件を含むSQL、57行）→ 全テーブルを DROP → エクスポートファイルをインポート → 件数と内容を照合 → 検証用 feedback を削除して原状復帰。
- 結果: **全25ステートメント成功。復元後の行数は videos 4 / categories 3 / video_categories 4 / feedback 1 / d1_migrations 2 で、エクスポート時点と完全一致**。feedback 行の client_hash / feedback_type、videos 行の label の内容も一致。`migrations list` も「No migrations to apply」となり、migration 状態込みで復元できることを確認した。
- 備考: リモートDBでの復元テストは未実施。実環境構築時（Kazuki 同席）に staging で同じ往復を行うこと。
