# Luna 本番運用ランブック（2026-11-12 JST）

## 実施内容
- 本番API実行を許可。AIスコープ `live` の `enabled=true`、`api_enabled=true`。
- `gpt-6-luna` による根拠確認済みFact Packの自動採点（最大1件/スロット）と、80点以上の原稿生成（最大1件/スロット）を定期化。
- 採点ジョブ `nyu-luna-score-twenty-jst`：JST 00:20, 02:20, ..., 22:20 の2時間間隔。
- 下書きジョブ `nyu-luna-draft-twentyfive-jst`：JST 00:25, 02:25, ..., 22:25 の2時間間隔。
- `nyu_private.nyu_luna_auto_score_tick(timestamptz)` と `nyu_private.nyu_luna_draft_tick(timestamptz)` の時間判定を「現地時間6時間刻み」から「2時間刻み」に変更。
- 既存のRSS収集、一次選別、根拠確認、リリース振り分けは原則6時間刻みのまま維持。
- 事実の確かさ・ソースの権利条件・AI生成の構造検査・48時間以内の公開日制約は緩めていない。
- **一般公開の自動化は未実施**。編集者による承認と公開操作が別途必要。リリースポリシーは `auto_publish_enabled=false`。

## 予算と安全停止
`nyu_private.nyu_ai_safety_policies` の `scope='live'`：
- `max_items_per_run=1`
- `max_items_per_day=24`
- `estimated_cents_per_item=1`
- `max_estimated_cents_per_day=24`
- `max_estimated_cents_per_month=400`
- `max_consecutive_failures=3`（連続失敗時に自動遮断）

※ 上記centは予約件数に固定額を掛けた**管理用の概算予算**であり、OpenAI請求額の強制上限ではない。実際のトークン使用量から算出した別の推計は `nyu_private.nyu_luna_usage_ledger` を参照。OpenAIの正式残高は自動取得されないため、課金側でも別途上限管理すること。

## 2026-11-12 実APIでの疎通試験
- 農林水産省の「米粉の優良な取組を発掘・表彰する新たなアワードを創設」について、原典抜粋の事前検査がPASS。
- `nyu-luna-score-reviewed`：本物のLuna API採点で **84点**。score ID `82554a00-5a57-436b-b5c8-cfcf9aa445f6`。
- `nyu-luna-publication-draft`：本物のLuna APIで下書きを1件生成。draft ID `c6bb7665-a2b0-47b3-87f1-f221f4d42a87`。
- `quality_status=structural_pass` / `editorial_status=pending_review` / `publication_allowed=false`。
- 2リクエストのusage ledger上の概算総額 **$0.0014155**（公式請求額とは異なる）。
- サイトへの自動掲載、重複記事の公開は行っていない。

## 運用状況の確認クエリ
```sql
select scope, enabled, api_enabled, circuit_open, consecutive_failures,
       max_items_per_day, max_estimated_cents_per_month
from nyu_private.nyu_ai_safety_policies where scope = 'live';

select jobid, jobname, schedule, active
from cron.job where jobname in
('nyu-luna-score-twenty-jst','nyu-luna-draft-twentyfive-jst');

select slot_at, state, detail from nyu_private.nyu_luna_score_tick_runs
order by slot_at desc limit 10;

select slot_at, state from nyu_private.nyu_luna_draft_tick_runs
order by slot_at desc limit 10;

select stage, count(*) as requests, sum(estimated_usd) as estimated_usd
from nyu_private.nyu_luna_usage_ledger
group by stage;
```

Cronの `succeeded` はスケジューラ内のSQLが成功したことを指す。Edge Functionの実際の成功は、ログ・DB出力・レスポンスで別途確認する。

## 緊急停止（公開サイト・収集は止めず、有料Lunaだけを停止）
```sql
update nyu_private.nyu_ai_safety_policies
set enabled = false, api_enabled = false, updated_at = now()
where scope = 'live';
```
もし頻度だけ元へ戻す場合、`cron.schedule` を使い両ジョブを旧スケジュール `20 3,9,15,21 * * *` / `25 3,9,15,21 * * *` に戻す。時間判定は2時間刻みのままで6時間刻みも許容するため、関数の再修正は不要。

## 次の課題
- ソースからFact Packの「正式採点可能」まで通過できる件数が現時点で少ない。未確認記事を自動的に正式採点することはしない。
- 2時間間隔のcronが実運用で正常に動くか、次回スロット以降のログを確認する。
- 人手の編集承認・一般公開は今の段階では残す。公開処理の自動化は根拠監査と重複防止を保持した専用実装が必要。
