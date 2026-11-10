# ぜんにゅー 除外記事監査 Ver.0.1

実装日: 2026-11-10。大量の記事を最初から一覧表示しない「集計 + 条件検索 + 必要な1件のみ復活」方式。

## 管理画面
- `nyu-admin/exclusion-audit.html`
- 既存の編集デスク `nyu-admin/index.html` から移動
- 初期表示は二次除外のみ、1ページ最大20件
- 一次除外は明示的に選択したときだけ一覧を取得
- 除外段階、情報源、除外理由、タイトルキーワードで検索
- 情報源別と除外理由別に件数集計。全文一括表示を行わない
- 復活操作は理由8〜500文字必須、確認ダイアログ付き

## サーバー側
- `public.nyu_exclusion_audit(p_stage,p_domain,p_reason,p_query,p_page,p_limit)`
  - 管理者（有効なowner/admin/editor）に限定
  - 一次除外は `nyu_source_items.metadata.zencho_prefilter.decision=skip` で、二次ルーターのキューが存在しない記事
  - 二次除外は `nyu_factpack_review_queue.decision=skip AND status=pending`
  - 除外理由、ドメイン、総件数、ページ数、記事一覧、現在の復活可能判定をJSONで返す
  - 検索時にも1ページ20件のサーバーページングを適用（最大30件、ページ上限200）
- `public.nyu_reopen_excluded_article(p_source_item_id,p_reason,p_expected_stage)`
  - 有効な管理者、情報源Green/本番利用承認/商用利用可能/停止・削除要求なしを必須
  - 評価済み・ファクトパック作成済み・掲載済みの記事は操作不可
  - 一次除外は元の事前判定JSONを `previous_verdict` に保存し、確認キューへ直接登録
  - 二次除外は既存キューの状態を確認待ちへ変更
  - 元の判断と復活理由、担当者、日時を `nyu_private.nyu_exclusion_reopen_audit` に保存
  - 復活先は `nyu_factpack_review_queue` の未承認 `review/pending` のみ。AI評価・記事公開なし
- `PUBLIC`・`anon` から両関数の実行権限を削除、`authenticated` への実行許可と関数内管理者認証を併用

## テスト結果
- 匿名実行権限なし、認証のみで管理者でない場合 `admin_required` と拒否
- 管理者相当の認証コンテキストによる検索・集計をテスト
- 全除外393件（一次370件、二次23件）
- 4Gamerの一次除外295件、検索ページには最大20件のみ
- タイトル検索「アーカイブ」で2件ヒット
- 一次・二次の復活RPCをそれぞれトランザクション内で実行し、想定結果を確認した上で`ROLLBACK`、実データは変更なし
- 最新のJSONに `can_reopen` フラグがあり、情報源不許可・処理済みは復活ボタン無効
- 公開記事29件、既存の評価記録130件、確認待ち4件は変更なし

## 未確認
- GitHub Pagesからの実ブラウザー表示および管理者のクリック操作テストは未実施
- 例外キューからの人手承認・模擬AI評価の実記事結合テストは別工程
- 一次除外の中の見逃しを自動発見するのではなく、検索・手動復活を用意した段階
