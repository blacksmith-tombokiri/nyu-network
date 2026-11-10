# ぜんにゅー：二次除外監査の14日表示・90日詳細整理（2026-11-10）

## 採用ルール
- 二次除外（`nyu_factpack_review_queue` の `decision=skip`、`status=pending`）のうち、`routed_at` から14日以内だけを監査画面に表示する。
- 14日経過後は管理用RPCの集計・検索からも非表示。管理者が期限切れ記事をAPI経由で復活させる操作も `router_exclusion_expired` で拒否。一次除外の扱いは従来どおり画面非表示。
- 90日経過後に詳細情報 `reason_codes`、`source_note`、`evidence_preview`、`review_note`、`reviewed_by`、`reviewed_at` を整理。`reason_codes` は `["retention_compacted_90d"]` のみにする。
- **`source_item_id`、`decision=skip`、`status=pending`、`routed_at`、`routing_version` の除外記録は保持**し、過去の記事の自動再振り分けを防ぐ。
- `archived_at` に詳細整理日時を記録し、二重整理しない。
- ファクトパック・評価・記事との紐付けが存在する除外記録は90日整理対象外。
- 除外記録と別テーブルである一次フィルターのデータや `nyu_source_items` 自体は今回削除しない。90日の「削除」は監査詳細情報の整理のみであり、記事マスタの削除ではない。

## 実装
- `public.nyu_exclusion_audit`: 二次除外に `routed_at >= now() - interval '14 days'` と `archived_at is null` を適用。
- `public.nyu_reopen_excluded_article`: 同様の期間・整理済み判定を強制。
- `nyu_private.nyu_compact_expired_router_exclusions(integer)`: 1バッチ最大1000件、`for update skip locked` による安全な定期整理。RPCは anon/authenticated から実行不可。
- Supabase Cron `nyu-compact-router-exclusions-daily`（job 10）で毎日 **日本時間02:40**（UTC 17:40）に最大1000件を整理する。
- 管理画面 `nyu-admin/exclusion-audit.html` に14日表示・90日詳細整理の説明を追加。

## 検証
- 既存二次除外47件はすべて14日以内に作成されていたため、直ちに画面から消える記事は0件。
- テストの1件だけ `routed_at` を15日前にずらし、監査一覧から消えることを確認。
- 期限切れ記事を復活させる管理者RPCが `router_exclusion_expired` として拒否することを確認。
- 91日前にずらしたテスト記事の詳細が整理され、記事ID・除外済みの状態が保持されることを確認。
- 二度目の整理では処理件数0（冪等性）。
- 上記の期限テストは全件 `ROLLBACK` で実行し、実データへ影響させていない。
- 本番データでの整理試行は `compacted=0`、正常。公開記事29件、評価記録130件、ファクトパック73件は変更なし。
- 運用Cron active=true、匿名および一般認証ユーザーには整理関数のEXECUTE権限なし。
- 次回の定刻Cronの実行結果、ブラウザーでの直接操作については今後の実行ログ・動作確認が必要。

## 注意
- 90日経過後も記事マスタ、RSS一次判定、監査経緯の別テーブルなどが残る場合がある。これはユーザー指定の「再処理防止の記録だけ残す」方針において、**二次除外キュー上の詳細情報を最小化する実装**。すべての別テーブルの個人情報・本文を自動削除する機能ではない。
