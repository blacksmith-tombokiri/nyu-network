# NYUNET ファクトパック確認・承認機能 v0.1

## 目的
API未接続のファクトパック下書きを元記事と照合し、人間が確認済みと判定できるようにする。承認は記事公開ではなく、AI評価へ渡す事実情報の承認だけを意味する。

## 管理画面
- GitHub Pages: `nyu-admin/factpacks.html`
- 既存編集デスク `nyu-admin/index.html` からリンク
- 既存のSupabase Authログイン情報を利用
- `nyu_source_fact_packs` の `needs_review` のみ一覧表示
- 出典元記事のリンク、未検証の抜粋、数値候補と編集項目を表示
- 要約、具体的な変化、実施段階、留保事項、理由を編集して承認
- 承認時は元記事確認、実施段階、数字と固有名詞、留保事項の4点をチェック
- 要修正として保留することも可能

## データベース
Supabase migration: `nyu_factpack_human_review_rpc_v01`

RPC: `public.nyu_review_factpack`

- `SECURITY DEFINER` だが `auth.uid()` と `nyu_admin_users` の有効な `owner/admin/editor` ロールを明示的に確認
- `EXECUTE` は `authenticated` のみに許可し、`PUBLIC`・`anon` から撤回
- `needs_review` 以外は変更不可
- ファクトパックを行ロックし `updated_at` の一致で変更競合を防止
- Green、再利用承認済み、商用利用可、本番許可済み、削除要求なしのソースだけ承認可能
- 元記事URLの一致、取得文章のハッシュと根拠抜粋の存在、必須文量、実施段階、留保事項配列、確認チェックを検証
- 承認時は `extraction_status=complete` とし、`extra_facts.review_type=human_verified_source`、担当者・時刻・理由を記録
- `ready_for_scoring=true`、`ready_for_publication=false` を記録
- 要修正操作では `needs_review` を維持
- `nyu_articles` や `nyu_evaluations` の書き込みは行わない

## 確認したこと
- RPC関数の存在とSQL定義
- `anon` のRPC実行権限はなし
- `authenticated` へのRPC実行権限あり。実行時の有効管理者判定は別途実施
- 管理者のファクトパック、ソース記事、ソース登録情報のSELECT権限あり
- 作業後：確認待ち1、既存complete 72、公開記事29
- **ログイン済みブラウザーでの実ボタンクリックは未実施**
- **実際の承認操作は未実施**。人間による出典照合前に承認しないため

## 次に試すこと
1. 編集デスクにログインし、確認・承認画面を開く
2. 元記事と下書き記述の一致を目視確認し、必要な修正を行う
3. 内容の正しいファクトパックのみ承認する
4. 完了したファクトパックをモックAI評価に渡す段階を別途テストする
5. 既存complete 72件は今回の承認経路を通っていないため、必要に応じて出典・品質の再評価を行う

## 運用上の注意
- チェックボックスは人間による確認の記録であり、事実の自動保証ではない
- 新しいAI評価処理を実装した場合は `extra_facts.review_type=human_verified_source` と `ready_for_scoring=true` を確認してから処理すること
- 既存の `complete` という状態だけで新しい人手承認完了と見なさないこと
