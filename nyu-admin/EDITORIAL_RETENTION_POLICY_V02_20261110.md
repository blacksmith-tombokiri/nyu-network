# ぜんにゅー編集デスク共通保存期間 Ver.0.2

更新：2026-11-10

## 方針

「二次除外の監査」と同じく**14日間表示・90日後に未処理詳細を整理**する運用を、次の3種類に拡張する。

| 対象 | 14日間の起算 | 14日経過後 | 90日経過後 |
|---|---|---|---|
| ファクトパック確認 (`needs_review`) | ファクトパック `created_at` | 確認画面から非表示。古い承認・保留RPCも拒否 | 根拠の未承認テキスト・抽出メモなどを消去し `error` + `archived_at` で期限切れ記録を保存 |
| 記事の例外確認 (`decision=review,status=pending`) | 例外振り分け `routed_at` | キュー画面から非表示。古い下書き作成・除外操作も拒否 | ステータスを `dismissed` に変更、理由・抜粋・メモを整理し `archived_at` に記録。処理済みsource IDは保持 |
| 70〜79点の記事編集（非公開） | 評価候補のみの場合 `evaluated_at`、非公開記事の場合 `unpublished_at` 優先 | 管理画面の候補一覧（全件・非公開・70-79点）から非表示 | **公開履歴のない**評価候補の提案文・詳細スコア内訳を整理し `editorial_archived_at` を記録。公開履歴がある非公開記事は削除せず保持 |

※「同じルール」は編集デスクの掲載期限と、未承認・未公開候補の90日後の詳細最小化に適用する。公開済み記事や過去に公開された記事を自動削除しない。

## 実装箇所

- GitHub `nyu-admin/factpacks.html`: 作成後14日の `needs_review` のみREST取得。
- GitHub `nyu-admin/factpack-queue.html`: 振り分け後14日の `review/pending` のみREST取得。
- GitHub `nyu-admin/admin.js`: 未公開70〜79点のみ14日以内に絞り込み。公開済み・80点以上の表示には適用しない。
- GitHub `nyu-admin/index.html`: 対象キューの保存期間を明示。
- Supabase `public.nyu_review_factpack`, `public.nyu_prepare_factpack_from_queue`, `public.nyu_set_factpack_review_queue_status`: 14日後の操作拒否。
- Supabase `public.nyu_set_review_publication`, `public.nyu_set_article_publication`: 期限を過ぎた70〜79点候補の公開操作を拒否。ただし公開済み記事の非公開化は拒否しない。
- Supabase `nyu_private.nyu_compact_expired_editorial_candidates(integer)`: 90日後の未承認・未公開候補を1回最大1,000件ずつ最小化（冪等）。
- `nyu_source_fact_packs.archived_at`、`nyu_evaluations.editorial_archived_at`、`nyu_articles.editorial_archived_at` を追加。評価ID、source ID、基本スコア、既存記事公開履歴を維持。

## スケジュール

- 二次除外の詳細整理：既存Cron、**JST 02:40**。
- 例外確認・未承認ファクトパック・70〜79点評価候補の整理：新規Cron `nyu-compact-editorial-candidates-daily`、**JST 02:45**（UTC `45 17 * * *`）。
- 6時間ごとの取得・事前振り分けパイプラインは変更しない。

## 確認したデータ

実装時：ファクトパック73件（確認待ち1）、例外要確認0、二次除外47、評価130件、公開29件、非公開31件。管理カタログの70〜79点は33件（公開6件、非公開9件、記事未作成18件）。
非公開9件には以前公開された履歴があるため、90日後の削除対象にしない。

## 動作テスト

すべてSQLトランザクション内で仮に日付を移動し最後に `ROLLBACK`：
1. 15日前の未承認ファクトパックが対象から消えること、承認/保留RPCが `factpack_review_expired` で拒否されること。
2. 91日前のファクトパックの原文抜粋・要約等が整理され、期限切れの記録を残すこと。
3. 15日前の未処理例外記事が処理RPCで `review_queue_expired` と拒否され、91日前で詳細整理・`dismissed` 記録になること。
4. 91日前の未公開・未記事化70〜79点評価候補の提案文・内訳が整理され、同じ年齢の公開済み70〜79点評価は**変更されない**こと。
5. HTML/JSの4ファイルで構文テスト合格。新規Cronが有効。一般・匿名ロールから整理関数実行不可。
6. 本番データでの90日整理試行は全カテゴリ0件。公開記事29、評価130、ファクトパック73のまま。

## 注意事項

- ブラウザーからの実クリックE2Eは未実施。静的コード・DB関数の結合検証のみ。
- 非公開70〜79点で過去に公開履歴があった記事は、一覧には14日後から表示しないが**記事レコードと公開履歴、編集済み内容を残す**。
- 未記事化の評価候補は90日後に元のスコアを残して提案テキストと内訳を整理する。評価IDとsource IDを保持することで重複評価を避ける。
- 最初の14日境界は日単位の午前0時ではなく、作成・判定タイムスタンプから14×24時間経過で判定。
