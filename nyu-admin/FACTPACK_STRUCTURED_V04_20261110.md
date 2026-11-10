# ぜんにゅー・ファクトパック Ver.0.4：構造化抽出と安全性検証

実装日：2026年11月10日。実装対象：Supabase Edge Function `nyu-factpack-auto`（v20）。実際の本番保存は行わず、preview/fixturesとロールバックDBテストで検証。

## 目的

従来の見出しを `event_summary` に複写するだけの方式から、公式HTML本文で裏付けられた構造化情報を取り出す。原文にない事実を生成しない。

### 出力スキーマ

`structured_v04` をファクトパックの `extra_facts` に格納する。

- `subject`: {value,quote,status}。対象となる主語・主題で、発表機関と行為主体を混同しない。不明なら null/unknown。
- `action`: {value,quote,status}。「決定」「採択」「認定」等の明示された事実の行動のみ。推定動詞は禁止。
- `stage`: announced / started / completed / result_reported / unknown。現在、厳密に扱える既成動詞の範囲のみ。発表済みと施行済みは同一視しない。
- `numbers`: [{value,unit,label,quote,role}]。本文の確認済み行動を含む原文から数値を抽出。賞のランクなどラベルも紐づける。本文全体から数字を無制限に収集しない。
- `source`: {publisher,url,published_at,quote,method}。URLと一次発表日を紐づける。
- `planned_actions`: 将来形を含む原文の記述。完了済み事実として扱わない。
- `evidence_quotes`: 事実確認に使った原文。
- `warnings`: 主語・行動・根拠の日付が確認できないなどの理由。
- `ready_for_scoring`: 上記の安全判定を通った場合だけ true。
- `ready_for_publication`: つねに false。

既存の `nyu_source_fact_packs` の `schema_version='auto-0.4'` とし、`event_summary`、`key_numbers`、`implementation_stage`、`change_summary`、`extra_facts` に必要情報を保存する形式（保存経路はまだ本番実行していない）。

## 動作方針と失敗時挙動

- 公式HTMLのページとRSSの見出し・日付が一致した場合のみ構造化処理を開始。
- 主語や行動の検証に失敗しても、見出しや日時から「ありがちな文章」を補完しない。
- HTML取得と照合自体が成功し、構造化だけ失敗した記事は、`route_queue` で単純除外せず人間の `review` に回す。
- 「誰が行ったか」の主体と「何が決定されたか」の対象は違う。自動抽出は過度に主語を広げず、`actors` は空配列のまま維持して推定の組織名を挿入しない。
- 有料AIは呼び出さない。公開も行わない。
- このv0.4は保守的な規則ベースの抽出であり、あらゆる日本語の構文解析を保証するものではない。

## 実記事の代表例

農林水産省 2026年10月27日のプレスリリース
`https://www.maff.go.jp/j/press/shokuhin/gaisyoku/261027.html`

「第17回農林水産省料理人顕彰制度『料理マスターズ』受賞者の決定及び授与式の開催について」

結果（previewのみ）：

- subject = 「受賞者」
- action = 「決定」
- stage = 「announced」 / 日本語表示「発表済み」
- counts = 「ゴールド賞1名」「シルバー賞3名」「ブロンズ賞3名」
- planned_actions = 「授与式は、令和8年11月16日（月曜日）に帝国ホテル東京で開催します。」
- ready_for_scoring = true、ready_for_publication = false
- 受賞者の決定を既成事実として照合したが、授与式の実施完了は主張しない。
- 引用元の句読点・括弧・全角文字を保つ。

一方、デジタル庁のAI実証手順書など、発表見出しと本文の裏づけが不十分なページは従来どおり `needs_review`。

## テスト結果

- `fixtures` の **23項目**すべて true（当初18項目から拡張）。
- 想定外の主語「ブロンズ賞3名）」への誤切り取りを検出して修正。
- 「受賞者」という対象と3種類の受賞人数を正しく分類。
- 将来予定の式典を完了済みに変換しない。
- 主語や行動が不明なら null/unknown のまま。
- 本文照合成功でも構造化失敗なら人間レビューへ回す条件を追加。
- DB保存形式のテストは `BEGIN ... ROLLBACK` により行い、`schema_version`、JSONB配列、`structured_v04`、`ready_for_publication=false` を検証。
- 実記事の `auto_save` と `route_queue` による構造化ファクトパックの本番DB保存は未実施。

## 作業後のデータ確認

- ファクトパック73件（自動確認保存は0件）
- 評価130件
- 公開記事29件
- 二次除外47件と以前の手動判断済み5件は変更なし
- API課金0円・今回の新規公開0件

## 残課題

1. 行為の種類・実施段階に関する日本語の多様な書き方への対応。現在は限定的な定型形にとどまる。
2. 主語の抽出では、行為者（農林水産省など）と対象（受賞者など）を厳密に分けるより高精度な設計が必要。現バージョンは対象を安全に抽出する設計。
3. 数値は同じ根拠文中の「名・件・社」等を保守的に抽出。目標値・前年との比較・数量の意味を理解する処理ではない。
4. PDFからの自動抽出は行わない。
5. **実記事の自動保存→安全装置付き模擬評価→プレビュー生成の実DB一気通貫テストは未完了**。この次の工程で、公開を抑止した状態で実施する。
