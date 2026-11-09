# NYUNET ファクトパック下書き・検証 v0.1

AI従量課金なしで、既存のGreenリスト登録記事から、ファクトパックの**未検証下書き**を生成し、根拠・欠落を検査するSupabase Edge Functionです。

- 公開中のサイト・記事・既存の評価には影響しません。
- OpenAI APIは呼びません。
- 自動抽出は事実確認の代わりではありません。ファクトパックは必ず `needs_review` に保ち、`complete` にしません。
- この機能が生成した下書きは、**自動公開および自動AI採点に使用しません**。
- 既存ファクトパックがある場合はその内容・状態を上書きしません。

## 実装場所

- Supabase Edge Function: `nyu-factpack-prep`
- ソース: `supabase/functions/nyu-factpack-prep/index.ts`
- 認証: 内部トークン `x-nyu-token`（Supabase Vaultの `nyu_fetch_token` と照合）
- API: `POST /functions/v1/nyu-factpack-prep`
- 一度の処理: 最大10件

## モード

| リクエスト例（JSON本文） | 動作 | DB変更 |
| --- | --- | --- |
| `{"mode":"fixtures"}` | 架空の発表記事から模擬下書き生成 | なし |
| `{"mode":"preview","limit":5}` | Green候補のファクトパック下書きをプレビュー | なし |
| `{"mode":"preview","fetch_html":true,"limit":1}` | 対応する公式HTMLから文章を取得（サイズとドメイン制限あり） | なし |
| `{"mode":"save_review","limit":2}` | 出典要約のある候補のみ `needs_review` で新規保存 | `nyu_source_fact_packs` へのINSERTのみ |
| `{"mode":"validate_existing","limit":5}` | 既存ファクトパックの欠落・出典記録を点検 | なし |

任意の `source_item_id` または `domain` フィルタに対応。

## 抽出と安全策

- 出典ドメインのHTTPS URLのみを根拠として採用。
- 出典要約またはHTML内の限定された文章を下書きとして使用。
- 事実であると確認していない段階では `event_summary` を元記事抜粋として扱い、`change_summary` は空欄。
- 数値は出典抜粋から拾いますが、意味・正確性は検証しません。
- 発表・予定・実証・成果を区別する暫定ステージ判定を付与。
- `actors` / `caveats` / `key_numbers` はJSON配列として保存。
- 記事本文・PDFの取得に失敗した場合は勝手に情報を補いません。PDFの解析は未実装。
- `publish:true`, `complete:true`, `run_ai:true` を拒否します。
- `save_review` はHTML取得による未確認下書きの直接保存を受け付けません。
- 競合時は `ON CONFLICT DO NOTHING` で既存の人手確認済みファクトパックを保護。
- ブラウザに内部トークンを渡さず、サーバー側から呼び出します。

## 実施した検証

- 架空記事の下書き生成成功、評価および公開フラグはfalse
- Green候補5件を読み込んでプレビュー成功、書き込み0
- 既存ファクトパック5件の点検成功、書き込み0
- 発表内容のみで根拠が不足する記事をブロック
- PDFの原資料はHTMLとして扱わず、根拠不足で停止
- 実記事1件の `needs_review` 保存成功
- 同じ記事を再保存しても重複追加せず既存を保護
- 完了への強制昇格はHTTP 409、認証なしはHTTP 401

## 今後の実装項目

1. HTML専用パーサーの精度改善、PDF本文抽出への対応、引用箇所（ページ・節）と出典ハッシュの管理
2. 人手で事実確認して `needs_review` から `complete` にする独立したレビュー操作・画面
3. 「事実」と「編集上の善兆評価」を分離した入力スキーマの確定
4. 公式本文の根拠が確認できた項目のみモック評価に流す接続テスト
5. 最後にOpenAI APIアダプターを別実装して従量課金を開始

**注意：今回の機能では、元記事の真偽を自動的に保証することも、スコア算定・記事公開を行うこともありません。**
