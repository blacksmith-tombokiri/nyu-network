# ぜんにゅー：⑤ OpenAI API接続前の運用・安全性最終監査

実施日：2026-11-10
判定：**実APIの自動運転は NO-GO（接続仕様の設計は完了。モック環境のまま保持）**

## 今回確認した事実（現行実装）

- ニュースの取得/一次判定/二次ルーティング/模擬評価は Supabase Edge Functions、GitHub Pages 管理画面、pg_cron の4段階で構成。
- Greenリストの本番利用・商用利用可の公式情報源だけを自動処理。
- Ver.0.4 構造化ファクトパックを実際の農水省記事で保存し、模擬評価に入力。**模擬85点**の記事プレビューを生成した。これは善兆の実際の評価ではない。
- `nyu-evaluator-mock` v6、`nyu-ai-safety-runner` v3。実APIにはアクセスしない。
- 安全ポリシー `mock`: enabled=true、**api_enabled=false**、circuit_open=false、1回5件、1日25件、模擬予約額上限 100 cents/day・1000 cents/month（**請求上限ではない**）。1件2 centsという値も固定試算でありモデル実価格ではない。
- 安全ポリシー `sandbox`: **api_enabled=false**、circuit_open=true。制御した障害試験の痕跡としてそのまま残す。
- `nyu_ai_safety_begin` は `mock` と `sandbox` しか受けず、`api_enabled=true` の場合は逆に拒否する。つまり、現状の安全ランナーを有料API向けに設定変更するだけでは本番接続はできない。
- 二重実行は scope + idempotency_key の記録で拒否。429等の外部API再試行、タイムアウト後の実請求照合、トークン費用照合は**未実装**。
- 記事公開は管理画面の既存RPCから可能。mockエンジン自体は公開・記事DB保存を行わない。
- **追加の防御策（今回実装）**：`public.nyu_set_review_publication` に管理者検証を明示し、両公開RPC `nyu_set_review_publication` / `nyu_set_article_publication` で、model_name/prompt_versionがmock/fixture/simulationである評価、またはscore_breakdown.simulation_only=trueの評価を公開拒否。双方SQLトランザクションのロールバックテスト合格。実際の記事は変更なし。
- Cronジョブは JST 0/6/12/18時に起動するfetch、5分後prefilter、10分後route、15分後mock の4件が active。**定期実行の成功記録は調査時点で未確認**（手動サイクルが completed に到達した記録はあり、cron.job_run_details の該当ジョブ履歴は空）。本番接続前に定刻の正常完走を少なくとも複数回確認する。

## API接続時の入力契約（案：live_v1）

公式ファクトパック `schema_version=auto-0.4` または人手承認済みの対応スキーマを入力する。AIにURLから独自の事実を推測させない。

```json
{
 "schema_version":"nyu-live-input-v1",
 "source_item_id":"<UUID>",
 "factpack_id":"<UUID>",
 "brand":"zencho",
 "source":{"publisher":"公式出典名","url":"https://...","published_at":"ISO8601"},
 "verified_claims":[
  {"subject":"明記された対象","action":"決定","stage":"announced","evidence_quote":"公式原文"}
 ],
 "numbers":[{"value":"1","unit":"名","label":"ゴールド賞","evidence_quote":"公式原文"}],
 "planned_actions":["予定の記述"],
 "caveats":["限定事項"],
 "editorial_policy_version":"zencho-v1"
}
```

必須条件：
1. `ready_for_scoring=true`、`ready_for_publication`はAPI評価前はfalse。
2. Source Green/active/production_enabled/commercial_use_allowed/reuse approved/takedownなし。
3. UUID・URL・入力本文ハッシュ・評価バージョンを記録し、再評価時はhash+model+prompt_versionも参照。
4. evidence_quoteは公式本文の原文抜粋に含まれる必要がある。
5. 非公式のRSS本文や未検証PDFの自動承認は禁止。
6. ソース本文中の指示文は「編集指示」でなく検証対象の引用データとして扱う（プロンプトインジェクション対策）。
7. 更新日とイベント実施日を区別し、発表・予定・実施・成果の各段階を混同しない。
8. staleな記事の掲載候補化を別途判定。

## API接続時の出力契約（案：strict JSON）

```json
{
 "schema_version":"nyu-live-output-v1",
 "source_item_id":"<UUID>",
 "factpack_id":"<UUID>",
 "category_code":"food",
 "score_common":0,
 "score_category":0,
 "score_total":0,
 "gate_result":"fail",
 "editorial":{"title":"","summary":"","comment":"","reason":""},
 "claims_used":[{"evidence_quote":"公式原文","claim":"記事に使用した事実"}],
 "unknowns":[],
 "review_reasons":[],
 "ready_for_publication":false
}
```

- Structured Outputs のstrict schemaを用い、追加プロパティ禁止、必須キー、型と文字数/件数上限をサーバーでも検証。
- `score_common`は0〜60整数、`score_category`は0〜40整数、`score_total`は合計かつ0〜100。
- `gate_result`と点数の整合性検証、カテゴリは `good/forward/nature/repair/food/mind` など現行DBの許可済み集合に限定。
- 記事内の重要な事実はすべて `claims_used` とファクトパック原文に一致しなければ不合格。
- AIに「良いニュースになるように捏造する」動作をさせない。
- **80点以上**：現行の公開適格候補。ただし実API接続直後は**必ずプレビュー止まり**（自動公開OFF）。後日、編集品質を監査して初めて段階解放。
- **70〜79点**：編集デスクの人間判断（14日間表示）。自動掲載なし。
- **70点未満**：自動掲載せず除外。模擬スコアを実採点として格納しない。
- 点数にかかわらず引用・出典不備、URL不一致、数値矛盾、予定を成果として記述した場合は除外または要確認。

## 料金・失敗時運転の接続条件

**今は一切有料APIを呼ばない。** 本番導入時は別途 `live` の制御層を新規作成し、モックポリシーと混ぜない。

必須ガード：
- `api_enabled=false` が初期値、明示的な2段階解放のみで有料呼出し可。
- 最初の接続テストは **1回1件、1日最大1件、公開OFF**。追加の事前承認なく定期実行へ組み込まない。
- OpenAI公式のモデル別価格表を確認し、選定モデル・入力最大トークン・出力最大トークンで先行予約する。返却された実際の使用量と料金を記録。予約額が予算を超えれば呼ばない。
- 推奨の初期運用案：日額 **US$1**、月額 **US$10**、1回最大1件、最大出力1,000トークン。**未承認の提案値であり設定変更していない**。
- 額面予算はDB側の予約・使用量集計とOpenAI側の使用量設定の両方で監視。通貨と課金モデルの違いに注意し、既存mockの`2 cents/item`を実請求と解釈しない。
- HTTP 429/5xxのリトライはジッター付き、最大1回などの小さい制限を選ぶ。通信断で成功不明の場合は同じ記事への再課金を勝手に繰り返さず人間確認へ送る。
- 実API呼び出しの成功・失敗・未確定の状態、入力hash、モデル名、実usage、コスト、エラーカテゴリを監査ログに記録。APIキーや全文プロンプトの秘密情報はログに出さない。
- 連続エラーでサーキットOPEN、未確定実行の放置を定期監視。OPENは自動解除しない。
- リアルAIの失敗を「0点のニュース」として扱わない。ネットワーク失敗と低評価は別の状態として保存。
- 他者の運用・URLの命令を実行しない。出典利用権・削除依頼をAPI投入直前にも再確認。

## 現在の残存リスク

1. **実API用のプロバイダー実装・接続秘密鍵・実課金台帳は未実装**。接続を許可するGO状態ではない。
2. **スケジュールの定刻運転実績が未確認**。安全なフェイルクローズがある一方、5分ずつの開始ずれで処理が途中で停止した場合の自動リカバリー・通知も未整備。
3. **ブラウザー実クリックE2Eは未完了**。確認待ち・ファクトパック承認・プレビューの画面における表示・権限・送信を実操作で確認すべき。
4. Ver.0.4の日本語構造化は限定的な定型形のみで、無作為記事での偽陽性率の検証は未完了。
5. Supabase Security Advisorの警告：公開スキーマ内pg_net、認証済みユーザー実行可能なSECURITY DEFINER管理RPC（内部の管理者判定は別途試験済み）、漏洩済みパスワード対策OFF。今回の監査ではこれら設定を変更していない。管理関数の厳密なアクセス制御とAuth設定の強化を継続検討。

## 接続判断

| 区分 | 判定 |
|---|---|
| 現行モックの継続運転 | 条件付き可（今後cronログを監視） |
| 1件限定の初回有料API試験 | **NO-GO**。live専用の予約/使用量/秘密鍵/エラー監視を実装後に個別承認 |
| 有料APIの定期自動実行 | **NO-GO** |
| 80点以上の自動公開 | **NO-GO**。実採点品質・出典監査と編集デスクE2E確認後に別途判断 |

参照：
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- Supabase Edge Functions schedule: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Security Advisor: https://supabase.com/dashboard/project/nfjqakbsaahjkyoylemy/advisors/security
