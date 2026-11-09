# NYUNET 模擬AI評価エンジン v0.1

この機能はOpenAI API未接続の**読み取り専用検証用** Edge Functionです。実際の善兆スコアを生成するAIではありません。模擬スコアを本番の `nyu_submit_scored_item` に渡すことも、本番の公開テーブルへ保存することも**ありません**。

## デプロイ済み
- Supabase Edge Function: `nyu-evaluator-mock`
- コード: `supabase/functions/nyu-evaluator-mock/index.ts`
- 呼び出し: `POST /functions/v1/nyu-evaluator-mock`
- 認証: サーバー側Vault `nyu_fetch_token` と照合する `x-nyu-token` ヘッダー。トークンをブラウザー・GitHub・公開ページに記載しないこと
- OpenAI APIリクエスト: 0
- データベース書き込み: 0
- 本番記事の公開: 0

## 入力モード
`{"mode":"fixtures"}`: 架空の85点・75点・40点で公開ルート判定を検証します。

`{"mode":"candidates","limit":5}`: 本番DBのGreen / production enabled / 承認済み / 事前判定 `ai_candidate` / 未評価・未掲載の候補を**読むだけ**で模擬判定します。最大10件。任意の `domain` フィルタあり。

応答には `mock_evaluation` と `publication_preview` が含まれます。模擬点は単なるテスト用の固定ルールで、編集評価・事実確認の証明ではありません。ファクトパック不備の実データは `blocked_missing_verified_fact_pack` にします。リクエストに `publish:true`, `write:true`, `live:true` または `provider:"openai"` を付けると拒否します。

## 検証済み
- 架空スコア85点: `would_publish_if_real_ai_and_verified: true`（プレビュー上のみ）
- 75点・40点: false
- 実データ5件: 5件取得、事実パック不足のため公開不可
- 認証なし: HTTP 401
- 公開要求: HTTP 409
- ソース上に外部AI呼び出し・DB書き込みなし

## 次の開発
1. 公式元記事本文から出典・日時・事実・留保条件を検証し、ファクトパックを構築する処理
2. 本機能の入力/出力スキーマをAIアダプターに継承。モックと本番APIを明示的に分離
3. OpenAI APIに接続する前に、スキーマ検証、冪等性、公開安全ゲート、最大件数・料金上限、障害ログを追加
4. ステージングで試験し、本番公開機能とは別の明示的な切替を設ける

**注意：今回のデプロイで定期巡回や自動公開は開始していません。**
