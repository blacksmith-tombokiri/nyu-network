# ぜんにゅー ロードマップ④ 模擬AI評価から記事プレビューまでの結合テスト

実施日：2026年11月10日

## 結論

Supabase Edge Functionの本番環境で、**実在する公式記事 → Ver.0.4構造化ファクトパックのDB保存 → 承認ゲート → モック安全ランナー → 出典付き未公開記事プレビュー生成**まで接続成功した。

OpenAI API呼出し 0回、`nyu_evaluations`への新規レコード 0件、`nyu_articles`への新規レコード 0件、記事公開 0件。

## 対象の公式記事

農林水産省「第17回農林水産省料理人顕彰制度『料理マスターズ』受賞者の決定及び授与式の開催について」

https://www.maff.go.jp/j/press/shokuhin/gaisyoku/261027.html

元記事の確認対象：受賞者の決定（ゴールド賞1名、シルバー賞3名、ブロンズ賞3名）。11月16日の授与式は予定として分離。

## 工程と検証結果

1. `nyu-factpack-auto` v20 を `mode=auto_save`、`source_item_id=b76539d1-6ff9-4d59-899f-53aa17a51181` で呼び出し。構造化ファクトパックを本番DBへ保存。ファクトパックID `306834f3-8b8f-4909-8388-05a6f6f8259c`、`schema_version=auto-0.4`、`extraction_status=complete`、`ready_for_scoring=true`、`ready_for_publication=false`。
2. `nyu-evaluator-mock` v6 にVer.0.4用の構造化根拠ゲートと `article_preview`（`mock_article_draft`）を追加。安全性フィクスチャ10項目全合格。URL不一致・原文引用偽装・未承認・二重処理の拒否を確認。
3. 既存の本番ファクトパックを `mode=approved_factpacks` で評価し、受理1件、**模擬85点**、出典付き未公開記事プレビューのJSON出力を確認。
4. `nyu-ai-safety-runner` v3 に `article_preview` の返却を追加。安全ランナー経由 `mode=approved` で受理1件、模擬85点、`can_publish=false` のプレビューを取得。OpenAI API利用なし。
5. 同じ `idempotency_key` で同時に2回実行し、一方のみ成功、他方は `409 duplicate_request`。公開指定 `publish=true` は `409 live_actions_disabled`。
6. モック固定値85/75/40のテストで、それぞれの `would_publish` / `would_hold` / `would_hold` を確認。ただしこれは**現実の公開判定ではなくシミュレーション**であり、すべて `actually_published=false`。
7. 実装反映後、GitHubの `supabase/functions/nyu-evaluator-mock/index.ts` と `supabase/functions/nyu-ai-safety-runner/index.ts` を同期。

## 主要な安全設計

- `nyu-ai-safety-runner` はシミュレーションであり、`api_enabled=false`。公開機能は呼ばない。
- `mock_score=85` は、ファクトパックが存在した場合に固定ルールで割り当てた**架空のテスト値**。社会的な価値、実際の効果、掲載の妥当性を保証しない。
- `article_preview.preview_type=mock_article_draft`、`can_publish=false`、`score_is_synthetic=true`、`visible_label=［模擬評価・未公開］` を保持。
- 予定の授与式は `planned_actions` に隔離し、実施済みの成果には変換しない。
- 変更があったのはファクトパック1件とモック安全ランナー実行ログのみ。ファクトパックは本番DBに**残す**（ロールバックではない）。
- モック評価レコードは `nyu_evaluations` に保存しない。記事レコードも作らない。

## 最終DB照合

| 対象 | 件数 |
| --- | ---: |
| 公開記事 | 29 |
| 非公開記事 | 13 |
| 評価記録 | 130 |
| ファクトパック | 74（今回1件追加） |
| 自動確認済みファクトパック | 1 |

モック安全ランナー実行ログは追加されているが、請求・記事公開・評価DB登録にはならない。

## 残る検証と次の工程

- プレビューはAPIレスポンスのJSONとして生成されている。**編集デスクでの実ブラウザー表示は未接続**であり、実際の画面にカードとして表示される動作は未検証。
- 70～79点と70点未満は現在モックのフィクスチャで確認している。実際のニュースをそう採点したものではない。
- Ver.0.4の日本語構造化は限定的な定型構文対応。抽出の正確さを無作為サンプルで統計的に確認したものではない。
- ⑤のAPI接続仕様・運用安全性の最終確認では、モック出力と実モデル評価を絶対に混同しない設計、費用上限、再試行制御、人的承認/自動掲載ルールを確認する。
