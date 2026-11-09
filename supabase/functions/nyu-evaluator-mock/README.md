# NYUNET 模擬AI評価エンジン Ver.0.2

OpenAI APIを使わず、記事取得・ファクトパック・模擬採点・掲載判定を検証するためのSupabase Edge Function。**評価、記事、公開情報をデータベースに書き込まず、外部AI APIも呼ばない。**

## 接続

- Edge Function: `nyu-evaluator-mock`
- `POST /functions/v1/nyu-evaluator-mock`
- 内部認証: Supabase Vaultの `nyu_fetch_token` と `x-nyu-token` を照合。ブラウザ側に秘密トークンを配布しない。
- 対象: `nyu_source_fact_packs` と元記事・情報源・承認者の情報を照合

## モード

| リクエスト | 処理 |
| --- | --- |
| `{"mode":"approval_gate_fixtures"}` | 架空の承認済み・未承認・旧形式・出典変更・評価済みを使用して安全ゲートをテスト |
| `{"mode":"approved_factpacks","limit":5}` | 正式な人手承認済みファクトパックを読み取り、模擬AI評価へ渡し、結果をプレビュー |
| `{"mode":"candidates","limit":5}` | 通常の候補を読み取り模擬評価。ただし承認済みの経路以外は **公開可能判定を返さない** |
| `{"mode":"fixtures"}` | 85点・75点・40点の架空スコアによる公開条件の検証 |

`approved_factpacks` は `source_item_id` と `domain` の指定に対応し、処理上限は10件。元記事・評価結果・記事テーブルへのINSERT/UPDATE/DELETEなし。

## 承認済みモードの通過条件

次のすべてを満たす必要がある。

1. ファクトパックが `extraction_status=complete`
2. `extra_facts.review_type=human_verified_source`、`ready_for_scoring=true`
3. 承認者ID、承認日時、承認理由があり、承認者が現在も有効な管理者
4. 承認時に記録した出典URLが最新の元記事URLと一致
5. SHA-256形式の出典抜粋ハッシュ、40文字以上の出典抜粋と出典種別がある
6. 40文字以上の事実要約、20文字以上の変化要約、適切な実施段階、留保事項あり
7. Green、利用承認済み、商用利用可、本番利用可、停止・削除要求なしの情報源
8. 事前判定 `ai_candidate`
9. 同じ記事の評価記録や公開記事がまだない

全条件を満たしても**模擬スコアは内容の正しさ・善兆性を示さない**。現状の85点等は固定ルールによる試験用の値で、記事は公開されない。

## 動作テスト（2026-11-10）

- `approval_gate_fixtures` 5ケース：すべて想定結果に一致
  - 正式承認済み：通過
  - 未承認：遮断
  - 旧形式complete：遮断
  - 元記事URLの変更：遮断
  - 評価済み：遮断
- `approved_factpacks`：HTTP 200、対象0件（実データに新方式の承認がまだない）
- `candidates`：3件中3件とも公開可能判定false、DB書き込み0
- `fixtures`：85点・75点・40点の従来検証を維持
- 公開要求 `publish:true`：HTTP 409で拒否
- OpenAI API呼び出し0、DB書き込み0、公開記事0

## 次のステップ

管理者が `nyu-admin/factpacks.html` から実際に元記事の根拠を確認して承認した後、`approved_factpacks` の実データ通過を確認。承認をテスト目的で偽装・自動生成しない。さらに、モックから実際のAI APIへ移行する前には入出力スキーマ、費用制限、冪等性、失敗時の停止措置と監査ログを検証する。

**定期巡回や本番記事の自動掲載は開始していない。**
