# Claude Code 実装指示書・変更管理規約 (CLAUDE.md)

本リポジトリ（`kokubee/geminihall`）で作業する実装エージェントは、`SPEC.md` を唯一無二の正（Single Source of Truth）として遵守すること。

---

## 1. 絶対遵守の実装制約（ハードルール）

1. **Phase順序の厳守**: Phase 0の実機検証と受入テストがすべて完了するまで、キャッシュ処理、公開申請・審査API、公開辞典UIに一切着手してはならない。
2. **「必須（Must-Have）」の優先**: `SPEC.md` で「余力対応（Vectorize、DOM自動抽出の高度化、ストリーミング）」および「対象外（サーバー負担の無料枠、LINE連携、X自動収集、LLM自動公開承認など）」に分類された機能は、必須機能が全件完了するまで実装を禁ずる。
3. **構造検証（Zod）と事実性評価（Eval）の分離実装**: Zodによるスキーマ検証だけで「監査品質が担保された」とみなしてはならない。必ず `packages/eval` に20件の評価セットと4指標の測定スクリプトを実装し、プロンプトや監査ロジックの変更時に実行すること。
4. **既存コードの盲目的コピー禁止**: 隣接リポジトリ（`../e-merit`, `../disaster-life-board`, `../gxceed` 等）を参照する際は、必ず事前に該当ファイルをReadして構造を確認し、本プロジェクトの6テーブル構造・初回累計3回クォータ・所有者認可設計に合わせて書き直すこと。
5. **BYOKキーの絶対隔離**: 利用者のAPIキー（Anthropic・OpenAI）を `chrome.storage.session` 以外に保存すること、Content Scriptへ渡すこと、GeminiHallのサーバーへ転送すること、ログやエラー報告に出力することを固く禁ずる。直接通信が不成立の場合もサーバー中継に切り替えず、接続失敗を表示して監査を実行しない。
6. **仕様変更の管理規則**: 実装中に技術的制約等で `SPEC.md` からの仕様変更が必要となった場合は、勝手にコードを書き換えず、まず「変更理由・影響範囲・代替案」を提示して承認を得ること。
7. **拡張機能のバージョン番号**: 利用者に試してもらう版をビルドするたびに、`apps/extension/package.json` の `version` を上げる（不具合の修正は3桁目、機能の追加は2桁目）。パネルの見出しと `chrome://extensions` に表示される `version_name`（バージョン、系統、ビルド日時）で、どの版が動いているかを利用者が確かめられるようにする。

---

## 2. 各Phaseの完了報告フォーマット（虚偽報告の防止）

各Phaseの終了時、エージェントは以下の4項目を必ず出力し、確認を得てから次のPhaseへ進むこと。
**実行していないテスト（特に実機ブラウザ操作や各社APIへの実接続が必要なもの）を推測で `PASS` と報告することを厳禁とし、必ず `NOT TESTED` と明記すること。**

```text
### Phase X 完了判定レポート
1. 実行したテスト項目とコマンド/手順:
2. テスト結果 (PASS / FAIL / NOT TESTED):
3. 未解決事項・既知の制限 (Open Issues):
4. 次のPhaseへ進める根拠 (Exit Criteria Check):
```

---

## 3. 開発マイルストーンと受入テスト条件

> 2026-10-15: ハッカソンへの提出を取りやめ、`SPEC.md` v2（利用者のキーでブラウザ内だけで監査する方式）に合わせて Phase を組み直した。日付は定めない。v1 の Phase 構成はコミット `1d6c92a` を参照。

### 【Phase 0】Chrome拡張での BYOK 監査の最小E2E・状態復元
* **実装タスク**:
  * [ ] モノレポ初期化（`apps/extension`, `apps/api`, `apps/web`, `packages/schema`, `packages/audit-core`, `packages/eval`）。WXTで2時間以内に疎通しない場合は素のMV3 + Vite + TSへ即時切替。
  * [ ] `packages/schema`: `SPEC.md` 第5章のZodスキーマと不変条件テスト。
  * [ ] `packages/audit-core`: 正規化・キャッシュキー、Claude と OpenAI の監査アダプター、根拠URLの実取得照合、格下げ処理、結果の組み立て。各社 API の応答はテストでは模擬応答を使う。
  * [ ] `apps/extension`: 設定画面（AIの種類・キー・モデル）、ユーザー操作起点の `chrome.sidePanel` 起動、手動入力＆右クリック選択テキスト取得、Background での監査実行、Side Panel 上の多段階監査工程の表示、`chrome.storage.session` による状態復元。
  * [ ] 各社 API への直接接続の実機検証（Claude・OpenAI 各1回）。
* **Phase 0 必須受入テスト**:
  1. 監査開始後にSide Panelを閉じて再度開いた際、完了済みの結果（`audit_trace` 含む）が復元されること。
  2. キーが `chrome.storage.session` 以外（`chrome.storage.local`、Content Script、ネットワーク送信先のうち各社API以外、コンソール出力）に現れないこと。
  3. 検索ツールが返していない URL を根拠に挙げた `CONFIRMED_HALLUCINATION` が、`UNVERIFIED_OR_AMBIGUOUS` に格下げされること（模擬応答で確認）。
  4. Zod不変条件テスト：`CONFIRMED_HALLUCINATION` かつ `evidence_status: INSUFFICIENT` のデータが弾かれること。`UNVERIFIED_OR_AMBIGUOUS` 時に `correction` が `null` かつ `audit_trace.abstention_reason` が必須であること。

### 【Phase 1】評価基盤（Eval Suite 20件）・キャッシュ・公開申請と審査API
* **実装タスク**:
  * [ ] `packages/eval`: 20件の評価データセットと4指標を測定・レポート出力するCLI。実行前に呼び出し件数を表示する。
  * [ ] プライベートキャッシュ（ブラウザ内）と公開キャッシュの照会（`GET /api/public/lookup`）。
  * [ ] `apps/api`: D1 の3テーブル、公開申請（`POST /api/submissions`、`GET /api/submissions/:id`、所有者認可）、管理者審査（`POST /api/admin/reviews`：Cloudflare Access保護）、公開一覧（`GET /api/public/entries`）。
  * [ ] `LIVE` / `DEMO` モードの分離。
* **Phase 1 必須受入テスト**:
  1. 20件の評価を実行し、キャッシュ境界事例での誤キャッシュ率が0%であること、根拠不足ケースで判定保留となることがレポート出力されること。
  2. 異なる `X-Client-Token`（またはトークンなし）で `GET /api/submissions/:id` を叩いた際、`HTTP 403`（`UNAUTHORIZED_REQUEST_ACCESS`）で拒否されること。
  3. 管理者が承認した申請だけが `GET /api/public/lookup` と `GET /api/public/entries` で返り、未審査・却下・撤回済みは返らないこと。

### 【Phase 2】公開辞典UI
* [ ] `apps/web`: `public_entries` のみを参照する公開辞典UI（一覧、カテゴリフィルタ、多段階監査トレース・根拠・制限事項・監査に使ったAIの表示、`RETRACTED` 表示、利用者のブラウザで作られた結果であることの明記）。

### 【Phase 3】本番結合テスト・セキュリティ監査・（余力対応）
* [ ] Cloudflare Workers / Pages / D1 本番デプロイ（`geminihall.cc`、`workers_dev: false`）と管理エンドポイント保護。
* [ ] 実機ブラウザでの E2E（監査 ➔ 公開申請 ➔ 管理者承認 ➔ 公開辞典掲載 ➔ 別の利用者の公開照会）と、ログへのキー・PII非混入監査。
* [ ] ※上記すべてが `PASS` し余力がある場合のみ、Stretch Goal に着手。

### 【Phase 4】パッケージング・公開
* [ ] Chrome拡張ビルド成果物（ZIP）、`README.md`（設計思想・Non-Oracle原則・Eval 20件の評価設計と結果）の整備、デモ動画、リポジトリPublic化。
