# NYUNET AI実行安全制御 Ver.0.1

**この段階ではOpenAI APIを呼び出さない。実際のAI利用料金は0。記事公開も行わない。**

## 構成

- Supabase Edge Function: `nyu-ai-safety-runner`
- ソース: `supabase/functions/nyu-ai-safety-runner/index.ts`
- Supabase private DB: `nyu_private.nyu_ai_safety_policies`, `nyu_private.nyu_ai_safety_runs`
- DB関数: `nyu_private.nyu_ai_safety_begin`, `nyu_private.nyu_ai_safety_finish`
- 管理者用読み取りRPC: `public.nyu_ai_safety_dashboard()`
- 管理画面: `nyu-admin/ai-safety.html`

## 初期安全ポリシー

| 用途 | 1実行 | 1日 | 日次仮予算 | 月次仮予算 | 仮単価 | 失敗連続停止 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 模擬承認済み記事評価（mock） | 5件 | 25件 | 100セント | 1000セント | 2セント/件 | 3回 |
| 独立した安全テスト（sandbox） | 2件 | 4件 | 6セント | 12セント | 2セント/件 | 2回 |

**仮予算は米ドルのセント単位を用いたテスト値であり、OpenAIの料金表・課金額・トークン使用実績ではない。** 実API接続前にモデル単価と推定トークンに基づく保守的な見積り、実使用量の照合と実際の請求額との突き合わせが必要。

`api_enabled` はDBのCHECK制約で常にfalse、スコープも `mock`・`sandbox` 限定。本版にOpenAI APIキー・有料API呼び出し・課金可能な処理はない。

## 実行フロー

1. リクエストの内部トークン認証と入力値・モードを検証
2. `idempotency_key` を必須とし、同一キーでの再実行を拒否
3. DB内でポリシーの行をロックし、同時実行・件数・日/月の想定予算・停止状態・未解決予約をチェック
4. OKなら件数と仮費用を「reserved」で予約し、監査ログを生成
5. 内部 `nyu-evaluator-mock` に接続して模擬評価
6. 成功・失敗と処理件数を記録。連続失敗が閾値に達するとサーキットブレーカーを開く
7. 最終処理に失敗・不明な予約が残った場合は、再実行を停止（fail closed）

使用モード：
- `{"mode":"simulate","limit":1,"idempotency_key":"unique-example-key"}` は架空の記事で検証
- `{"mode":"approved","limit":1,"idempotency_key":"another-unique-key"}` は人手承認された記事の模擬評価のみ
- `simulate_failure:true` は `mode=simulate` でのみ利用できる障害注入

HTTP要求には Supabase Vault の `nyu_fetch_token` に一致する `x-nyu-token` ヘッダーが必要。**公開ブラウザーのJavaScriptから内部トークンを呼ばない。**

安全停止は自動解除しない。手動で原因を調査し、権限を持つ運用者が復旧する。管理画面では停止解除や予算変更はできない。

## 監査ログ

`nyu_ai_safety_runs` に実行ID、対象スコープ、冪等性キー、状態（reserved/success/failure/blocked）、要求件数、予約件数、仮費用、処理件数、通過件数、エラーコード、開始/終了日時、概要を保存。アクセスは公開しない。

管理者向け読み取り専用RPCで最近40件の主要情報を表示。匿名・通常ユーザーは実行できない。

## 実施したテスト（2026-11-10）

- 通常模擬評価: HTTP 200
- 同一冪等性キーを再実行: HTTP 409（duplicate_request）
- 意図的な失敗: HTTP 503、failure記録
- sandboxで2回連続失敗: circuit_open=true
- 日次仮予算に達した後の要求: HTTP 409
- 停止後の要求: HTTP 409（disabled_or_circuit_open）
- mockの1実行上限を超える6件: HTTP 409（run_item_limit）
- 実承認データ0件: HTTP 200、processed_items=0、accepted_items=0
- OpenAI API呼び出し0、記事公開0

日次・月次の上限はDBで実装。月次上限そのものに達したテストはまだ実施していない。

## 重要な未完了事項

- OpenAI APIの本番アダプターと、推定・実トークン費用の計算は未実装
- 実利用量の照合、超過時停止、請求額との突合はAPI接続時に実装する
- 管理者ブラウザーでの実際の画面表示操作テストは未実施
- Cronによる自動巡回・記事自動公開との接続は未実施
- 将来の本番アダプターは安全ガードをバイパスできない構成にし、すべての有料呼び出しを事前予約・事後照合の対象にする

**現時点の機能は、将来の実料金を保証する仕組みではなく、有料API接続前に安全ロジックを検証するための仕組み。**
