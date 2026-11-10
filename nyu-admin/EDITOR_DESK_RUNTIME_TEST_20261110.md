# 『ぜんにゅー』編集デスク 実動作検証 Ver.0.1

実施日：2026年11月10日

## テスト対象

- 編集デスク `nyu-admin/index.html`
- ファクトパック確認・承認 `nyu-admin/factpacks.html`
- 記事の例外確認 `nyu-admin/factpack-queue.html`
- 二次除外記事の監査 `nyu-admin/exclusion-audit.html`
- Supabase RLS、管理者専用RPC、情報源利用許可、更新競合チェック

**テストの範囲：** 接続ブラウザーはタブ・ページテキストを参照できるが、Chatモードのブラウザーツールではクリックや入力を制御できない。したがって、**ログイン済み編集デスクの読み取り確認と、DBトランザクション内での管理者操作・検証を実施**した。UIの実クリックを伴うE2E完走は未実施。実ブラウザーテスト完了と誤認しないこと。

## 結果

| 項目 | 結果 | 補足 |
| --- | --- | --- |
| 管理者ログイン状態のページ表示 | 確認 | 接続ブラウザーの開いた `nyu-admin/?brand=zen` タブから媒体、記事一覧、管理リンク、ログイン済み管理者の表示を確認 |
| 管理画面のリンク | PASS | ファクトパック・例外確認・二次除外監査・AI安全管理への導線 |
| JavaScript構文（4画面） | PASS | GitHub上のHTML内のインラインJSを構文解析 |
| 管理者RLSでの取得 | PASS | `nyu_admin_users` 1人・既存ファクトパック確認待ち1件・例外確認待ち0件・二次除外47件を読める |
| 二次除外→確認待ちへ復活 | PASS | `nyu_reopen_excluded_article` |
| 確認待ち→ファクトパック下書き | PASS | `nyu_prepare_factpack_from_queue` |
| ファクトパックの「要修正」保留 | PASS | `nyu_review_factpack`, `p_approve=false` |
| ファクトパックの承認 | PASS | `nyu_review_factpack`, チェック4項目と事実・出典を入力、`complete` を確認。ただし**架空文章を使ったロールバック限定のDBテスト**であり、実在記事の正式承認ではない |
| 承認後の公開ガード | PASS | `ready_for_publication=false` を維持。記事を公開する操作を呼ばない |
| 非管理者のRPC実行拒否 | PASS（5項目） | 復活・下書き・除外・承認・監査がすべて `admin_required` |
| 同じ記事の再復活 | PASS（拒否） | `not_currently_excluded` |
| 短い根拠文 | PASS（拒否） | 40文字未満 |
| 二重の下書き作成 | PASS（拒否） | キューが処理済みになると作れない |
| 古い更新時刻での承認 | PASS（拒否） | `review_conflict_reload_required` |
| 確認チェック不足での承認 | PASS（拒否） | `all_review_confirmations_required` |
| 情報源の削除要求後の下書き作成 | PASS（拒否） | `nyu_prepare_factpack_from_queue` に `takedown_status` チェックを追加して検証 |
| 実データの変更なし | PASS | テストはすべて `ROLLBACK`、最新数値は下記 |

## 本番データの状態（検証後）

- 公開中の記事：29件
- 評価記録：130件
- ファクトパック：73件、うち `needs_review` 1件
- 例外キュー：要確認0件、以前の要確認から除外済み5件、二次除外47件
- 復活監査履歴：0件
- 今回の新規記事公開：0件
- 今回の有料AI API呼び出し：0回

## 改善・セキュリティ確認

- `public.nyu_prepare_factpack_from_queue` を変更し、情報源の利用許可チェックに加えて `coalesce(takedown_status,'none')='none'` を必須化
- Supabase Security Advisorには、認証済みユーザーが呼べる `SECURITY DEFINER` RPCに対して警告がある。これらのRPCは管理画面での意図的な利用であり、関数内で `auth.uid()` を有効な管理者レコードと照合している。今回非管理者による拒否を実証
- その他、pg_netがpublicスキーマ内、流出済みパスワード対策無効などの既存警告が残る。今回のテストでは設定を変更していない。詳細：[Supabase Security Advisor](https://supabase.com/dashboard/project/nfjqakbsaahjkyoylemy/advisors/security)

## 次に残るブラウザー操作

ブラウザー上の**クリック操作を伴う**テストのみ未完了。以下を実際に確認する必要がある。

1. `https://blacksmith-tombokiri.github.io/nyu-network/nyu-admin/?brand=zen` のログイン済み画面から、確認・承認／例外確認／二次除外監査をそれぞれ開く
2. `factpacks.html` で既存の確認待ち1件が表示されること。実記事を承認しない
3. `factpack-queue.html` で確認待ち0件が正常表示されること
4. `exclusion-audit.html` で二次除外47件の集計、情報源・理由別検索、20件ずつのページング、元記事リンク、復活ボタン（操作せず）を確認
5. セッション失効時の再認証、スマートフォン表示、ブラウザーの通信・スクリプトエラーがないことを確認

**判定：管理者RPCとバックエンド連携は合格。画面上の実クリックE2Eは未完了。OpenAI API接続へ進む前に、実ブラウザーテストを追加実施すること。**
