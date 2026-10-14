# Claude Code 実装指示書・変更管理規約 (CLAUDE.md)

本リポジトリ（`kokubee/geminihall`）で作業する実装エージェントは、`SPEC.md` を唯一無二の正（Single Source of Truth）として遵守すること。

---

## 1. 絶対遵守の実装制約（ハードルール）

1. **Phase順序の厳守**: Phase 0の実機検証と受入テストがすべて完了するまで、LINE連携、キャッシュ処理、公開辞典UIに一切着手してはならない。
2. **「必須（Must-Have）」の優先**: `SPEC.md` で「余力対応（Vectorize、DOM自動抽出の高度化、ストリーミング）」および「対象外（X自動収集、LLM自動公開承認）」に分類された機能は、必須機能が全件完了するまで実装を禁ずる。
3. **構造検証（Zod）と事実性評価（Eval）の分離実装**: Zodによるスキーマ検証だけで「監査品質が担保された」とみなしてはならない。必ず `packages/eval` に20件の評価セットと4指標の測定スクリプトを実装し、プロンプトや監査ロジックの変更時に実行すること。
4. **既存コードの盲目的コピー禁止**: 隣接リポジトリ（`../e-merit`, `../disaster-life-board`, `../gxceed` 等）を参照する際は、必ず事前に該当ファイルをReadして構造を確認し、本プロジェクトの6テーブル構造・初回累計3回クォータ・所有者認可設計に合わせて書き直すこと。
5. **BYOKキーの絶対隔離**: ユーザーのAnthropic APIキーを `chrome.storage.session` 以外に保存すること、Content Scriptへ渡すこと、Honoサーバーへ転送すること、ログに出力することを固く禁ずる。直接通信が不成立の場合は自動でサーバー中継に切り替えず、BYOK機能を安全に無効化（縮退）せよ。
6. **仕様変更の管理規則**: 実装中に技術的制約等で `SPEC.md` からの仕様変更が必要となった場合は、勝手にコードを書き換えず、まず「変更理由・影響範囲・代替案」を提示して承認を得ること。

---

## 2. 各Phaseの完了報告フォーマット（虚偽報告の防止）

各Phaseの終了時、エージェントは以下の4項目を必ず出力し、確認を得てから次のPhaseへ進むこと。
**実行していないテスト（特に実機ブラウザ操作やLINE実機送信が必要なもの）を推測で `PASS` と報告することを厳禁とし、必ず `NOT TESTED` と明記すること。**

```text
### Phase X 完了判定レポート
1. 実行したテスト項目とコマンド/手順:
2. テスト結果 (PASS / FAIL / NOT TESTED):
3. 未解決事項・既知の制限 (Open Issues):
4. 次のPhaseへ進める根拠 (Exit Criteria Check):
```

---

## 3. 開発マイルストーンと受入テスト条件（2026年11月2日 12:00 〜 11月10日 14:00）

> 2026-10-15 追記: ハッカソンへの提出は取りやめた。以下の日付は拘束力を持たないが、Phase の順序と受入テストの条件はそのまま適用する。仕様の補足決定は `SPEC.md` 第6章を参照する。

### 【Phase 0】11月2日（月）12:00 〜 11月3日（火）：Chrome拡張〜Hono〜Claude多段階監査の最小E2E・認可・状態復元
* **実装タスク**:
  * [ ] モノレポ初期化（`apps/api`, `apps/extension`, `apps/web`, `packages/schema`, `packages/eval`）。WXTで2時間以内に疎通しない場合は素のMV3 + Vite + TSへ即時切替。
  * [ ] `packages/schema`: `SPEC.md` 第4章のZodスキーマ（`audit_trace` 含む）と `.superRefine()` 不変条件テストを実装。
  * [ ] `apps/api`: D1の6テーブル作成。初回累計3回クォータ管理（`quota_usage` + `audit_requests`）と、所有者認可付き `POST /api/verify`, `GET /api/requests/:id`（要 `X-Client-Token` 検証）を実装。
  * [ ] `apps/extension`: ユーザージェスチャー起点での `chrome.sidePanel` 起動、手動入力＆右クリック選択テキスト取得、Side Panel上での多段階監査工程（主張の分解・根拠照合・判定保留理由）の表示、`chrome.storage.session` を使った状態復元を実装。
  * [ ] BYOK直接通信（Background Worker ➔ Anthropic API）の実機検証と、不成立時の縮退動作の実装。
* **Phase 0 必須受入テスト**:
  1. 監査開始後にSide Panelを閉じて再度開いた際、完了済みの結果（`audit_trace` 含む）が復元されること。
  2. 異なる `X-Client-Token`（またはトークンなし）で `GET /api/requests/:id` を叩いた際、`HTTP 403`（`UNAUTHORIZED_REQUEST_ACCESS`）で拒否されること。
  3. 同一 `request_id` 再送時に無料枠が二重消費されず、4回目の新規リクエストで `QUOTA_EXCEEDED` となること（日付変更でもリセットされないこと）。
  4. Zod不変条件テスト：`CONFIRMED_HALLUCINATION` かつ `evidence_status: INSUFFICIENT` のデータがバリデーションエラーで弾かれること。また `UNVERIFIED_OR_AMBIGUOUS` 時に `correction` が `null` かつ `audit_trace.abstention_reason` が必須であることが強制されること。

### 【Phase 1】11月4日（水）〜 11月5日（木）：評価基盤（Eval Suite 20件）・所有権隔離キャッシュ・公開承認ゲート
* **実装タスク**:
  * [ ] `packages/eval`: `SPEC.md` 第5章に基づく20件の評価データセット（事実誤認8件、正しい主張5件、根拠不足5件、キャッシュ境界2件）の定義と、4指標（誤訂正率、判定保留の適切性、根拠対応確認率、誤キャッシュ率）を測定・レポート出力するCLIハーネスの実装。
  * [ ] `claim_cache_key` によるキャッシュ判定実装（他ユーザーには `public_entries` の `PUBLISHED` かつ有効期限内のデータのみ返却し、未公開の `audit_results` は同一 `client_key_hash` 本人にのみ返却する隔離ロジック）。
  * [ ] ユーザー同意API（`POST /api/consents`：所有者認可必須）と、管理者承認・撤回API（`POST /api/admin/reviews`：Cloudflare Access保護想定）の実装。
  * [ ] `LIVE` モードと `DEMO` モード（`quota_usage` 非消費・LIVEテーブル非汚染・UIバッジ明示）の実装。
* **Phase 1 必須受入テスト**:
  1. `packages/eval` の20件評価ベンチマークを実行し、キャッシュ境界事例（数値・否定語違い）での誤キャッシュ率が0%であること、および根拠不足ケースで適切に `UNVERIFIED_OR_AMBIGUOUS`（判定保留）となることがレポート出力されること。
  2. ユーザーAが実行した未公開の監査結果（`audit_results`）が、同じ文章を入力した別ユーザーBのキャッシュとしてヒットしないこと（情報漏洩防止テスト）。
  3. 本人同意（`publication_consents`）と管理者承認（`publication_reviews`）の両方を経て `public_entries` に昇格した事例のみが、別ユーザーBのキャッシュおよび `GET /api/public/entries` で返却されること。

### 【Phase 2】11月6日（金）〜 11月7日（土）：LINE非同期監査（Queues + Push）＆ 公開辞典UI
* **実装タスク**:
  * [ ] `POST /api/webhook/line`: 署名検証、`webhookEventId` 重複排除、`quota_usage` 予約、Cloudflare Queues投入、即時 `HTTP 200` 応答の実装。
  * [ ] Queue Consumer: テキストおよびスクショ画像監査の非同期実行と、LINE Push APIによるFlex Message送信。判読不能・エラー時はクォータを `RELEASED` に戻して案内をPush送信。
  * [ ] `apps/web`: `public_entries` テーブルのみを参照する公開辞典UI（一覧、カテゴリフィルタ、多段階監査トレース・エビデンス・制限事項の表示、`RETRACTED` 表示対応）。
* **Phase 2 必須受入テスト**:
  1. 同一 `webhookEventId` を持つLINE Webhookリクエストを再送した際、二重にQueue投入やクォータ消費が行われず `HTTP 200` が返ること。
  2. 不鮮明な画像をLINEへ送信した際、非同期処理後にクォータが `RELEASED`（返還）され、案内メッセージがPush通知されること。

### 【Phase 3】11月8日（日）〜 11月9日（月）：本番結合テスト・セキュリティ監査・（余力対応）
* **実装タスク**:
  * [ ] Cloudflare Workers / Pages / D1 / Queues 本番デプロイ（`geminihall.cc`）と管理エンドポイント保護。
  * [ ] 実機ブラウザ、Anthropic API、Cloudflare、LINEのE2E結合テスト（個人の監査 ➔ 同意 ➔ 管理者承認 ➔ 公開辞典掲載の一気通貫フロー確認）と、ログへのAPIキー・PII非混入監査。
  * [ ] ※上記すべてが `PASS` し余力がある場合のみ、Stretch Goal（DOM自動抽出ボタンまたは公開エントリ対象のVectorize類似検索）に着手。

### 【Phase 4】11月10日（火）〜 14:00：パッケージング・デモ収録・最終提出
* [ ] Chrome拡張ビルド成果物（ZIP）の作成、`README.md`（設計思想・Non-Oracle原則・Eval 20件の評価設計と結果の記載）の整備、デモ動画収録、リポジトリPublic化、提出。
