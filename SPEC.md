# GeminiHall (geminihall.cc) プロダクト仕様書 (SPEC.md) v2

> v2（2026-10-15）: ハッカソン向けの v1（コミット `1d6c92a`）から方針を変更した。サーバー負担の無料監査枠と LINE 連携を廃止し、利用者が自分の API キーで、ブラウザ内だけで監査を実行する方式にした。変更点は第8章の変更履歴にまとめる。

## 1. プロダクト定義と基本原則

* **定義**: AIが生成した情報を、人間が検証・判断できる「証拠付きの監査記録（Evidence-Backed Audit Record）」へ変換し、個人の検証作業を社会的に再利用可能な集合知（構造化アーカイブ）へと昇華させる情報の信頼性インフラ。
* **基本原則（Non-Oracle & Epistemic Humility）**:
  1. **非オラクル原則**: 監査に使うAIを無謬の正解判定者として扱わない。他モデルの出力を一方的に論破するのではなく、「どの根拠に基づき、どこまでが検証可能で、どこからが判定不能か」を監査する。監査中に実際に取得した外部ソースによる裏付けが確認できない限り、`CONFIRMED_HALLUCINATION` にも `SUPPORTED_CLAIM` にも昇格させない。
  2. **多段階監査の透明性**: 監査をブラックボックスな一発回答にせず、「①主張の原子的分解 ➔ ②外部根拠との照合 ➔ ③矛盾の特定・または確証不足による判定保留」の工程（`audit_trace`）として構造化・可視化する。
  3. **時間的・文脈的限界の明示**: キャッシュヒットを「現在も正しい保証」として扱わない。情報の性質に応じたTTL（有効期限）と検証時点の文脈（`context_fingerprint`）を管理する。
  4. **私的監査と公的集合知の分離**: 監査の実行（利用者のブラウザ内だけで完結する私的な記録）と、辞典への公開（本人の申請＋管理者の審査を経た公開掲載）を、実行場所・データ構造・認可・キャッシュの各レベルで分離する。
  5. **鍵は利用者の手元から出さない**: 利用者の API キーはブラウザの外へ出さない。GeminiHall のサーバーはキーを受け取らず、AI の利用料も負担しない。

---

## 2. 実装スコープ区分（機能凍結）

「必須（Must-Have）」がすべて受入テストを通過するまで、「余力対応」に着手してはならない。

| 区分 | 対象機能 |
| :--- | :--- |
| **必須 (Must-Have)** | ・Chrome拡張の手動入力・選択テキスト（Context Menu）・Side Panel表示（多段階監査トレース可視化）と状態復元<br>・利用者の API キーによる監査（Claude と OpenAI の2社）。キーの保存先は `chrome.storage.session` のみ<br>・判定保留（`UNVERIFIED_OR_AMBIGUOUS`）と多段階監査トレースを含む監査結果（Zod 不変条件検証、根拠 URL の実取得照合）<br>・20件の正解確認済み評価セット（Eval Suite）と4指標の自動測定スクリプト<br>・キャッシュ隔離（ブラウザ内のプライベート再利用 ＋ 公開承認済み事例の照会）<br>・公開申請（本人の同意を含む）と管理者による承認・却下・撤回<br>・公開辞典の基本UI、LIVE / DEMO モードの明示的分離 |
| **余力対応 (Stretch)** | ・Gemini画面のDOM自動抽出ボタンの高度化<br>・Cloudflare Vectorize（`@cf/baai/bge-m3`）による公開承認済み事例の類似検索<br>・監査結果のストリーミング表示<br>・3社目以降の AI（Gemini API、OpenRouter のログイン連携など） |
| **対象外 (Out of Scope)** | ・サーバー負担の無料監査枠、サーバー経由の AI 呼び出し<br>・利用者の API キーをサーバーへ送ること・保存すること<br>・LINE 連携<br>・X（旧Twitter）等の自動スクレイピング収集<br>・LLMによる公開自動承認<br>・一般ユーザー向けの複雑なアカウント認証基盤<br>・ChatGPT Plus / Claude Pro など個人向け契約のアカウントを外部から使う方式（公式の提供がないため） |

---

## 3. 全体構成

```
[Chrome 拡張]                                   [geminihall.cc（Cloudflare）]
 Side Panel ── Background Service Worker          Workers + D1
                 │  利用者のキーで直接接続              ├ 公開事例の照会 API
                 ├──► Anthropic API（Claude）         ├ 公開申請の受付 API
                 └──► OpenAI API（Responses）         ├ 管理者の審査 API（Cloudflare Access 保護）
                 │                                   └ 公開辞典（Pages）
                 └── 公開照会・公開申請 ──────────────►
                     （キーは送らない）
```

* 監査は拡張機能の Background Service Worker が、利用者のキーで各社の API に直接接続して実行する。
* サーバーは、公開済み事例の照会、公開申請の受付、管理者の審査、公開辞典の表示だけを担う。

---

## 4. コア技術仕様

### ① 利用者のキーによる監査（BYOK）

* **対応する AI**: Claude（Anthropic Messages API、web search サーバーツール）と OpenAI（Responses API、`web_search` ツール）。利用者は設定画面で AI の種類・キー・モデル名を選ぶ。
* **キーの隔離**: キーは `chrome.storage.session` にだけ保存し、`setAccessLevel` で `TRUSTED_CONTEXTS` に限定する。Content Script、GeminiHall のサーバー、ログには一切渡さない。ブラウザを再起動するとキーは消えるため、再入力が必要になる（キーをディスクに残さないための仕様）。
* **直接接続**: Background Service Worker から各社 API へ直接接続する。Anthropic にはブラウザからの直接接続を示すヘッダー（SDK の `dangerouslyAllowBrowser`）を付ける。拡張の `host_permissions` は `https://api.anthropic.com/*` と `https://api.openai.com/*` と GeminiHall のサーバーに限る。
* **接続できない場合**: サーバー経由に切り替えない。設定画面に接続失敗を表示し、監査を実行しない。
* **費用の表示**: 監査は利用者の API 利用料で実行されることを、設定画面と初回実行時に明示する。

### ② 根拠の実取得照合

* `evidence_sources[].verified` は、その URL が同じ監査の中で検索ツールが実際に返した URL に含まれていた場合だけ `true` にする。AI が自分で書いた `verified` の値は採用しない。
  * Claude: `web_search_tool_result` に含まれる `web_search_result.url`
  * OpenAI: `web_search_call.action.sources`（`include: ["web_search_call.action.sources"]` で取得）と `url_citation` 注釈の URL
* URL の照合では、フラグメントと `utm_*` クエリを除き、末尾のスラッシュをそろえてから比較する。
* AI が `CONFIRMED_HALLUCINATION` または `SUPPORTED_CLAIM` と判定しても、照合済みの根拠が1件もない場合は `UNVERIFIED_OR_AMBIGUOUS` に格下げする。訂正案は `unverified_notes` に「未確認の訂正候補」として移し、制約事項と保留理由を追記する。

### ③ キャッシュの所有権隔離・TTL・文脈管理

* **プライベートキャッシュ**: 自分の監査結果は、自分のブラウザの `chrome.storage.session` に `claim_cache_key` 付きで保存し、有効期限内なら再利用する。サーバーには置かない。
* **公開キャッシュ**: 監査の前に、`claim_cache_key` で公開済み事例をサーバーへ照会する（`GET /api/public/lookup?key=`）。`publication_status = 'PUBLISHED'` かつ `expires_at > now` の事例だけが返る。照会で送るのはハッシュ値だけで、主張の本文は送らない。照会は設定画面で無効にできる。
* **キャッシュキー算出式**:
  `claim_cache_key = SHA256(normalized_claim + "|" + context_fingerprint + "|" + audit_policy_version + "|" + locale)`
  * `normalized_claim`: NFKC 変換、前後空白の除去、連続空白を1つに圧縮、ラテン文字の小文字化。数字と否定語は変更しない。
  * `context_fingerprint`: `SHA256("ctx-v1|" + 正規化した文脈文字列)`。文脈がなければ空文字列。
  * どちらも AI を呼ぶ前に拡張側で決定的に計算する。AI の出力に同名の値があっても採用しない。
* **初期TTL設定**:
  * `HISTORICAL_FACT`（歴史的事実・確定した過去の出来事）: 30日
  * `LAW_OR_INSTITUTION`（法令・制度・企業仕様）: 24時間
  * `CURRENT_NEWS`（ニュース・現在の出来事）: 1時間
  * `REALTIME`（リアルタイム情報）: 再利用なし（TTL = 0）

### ④ 公開申請と管理者審査

* **公開申請（`POST /api/submissions`）**: 利用者が監査結果を見て「公開に同意して申請」を押すと、監査結果・元の主張・同意文のバージョンをサーバーへ送る。キーは送らない。申請は本人同意の記録を兼ねる。
  * ヘッダー `X-Client-Token`（拡張がインストール時に生成し `chrome.storage.local` に保存する32バイト以上の乱数）をサーバーで SHA-256 化し、`client_key_hash` として記録する。
  * サーバーは監査結果を Zod で検証し、不正なら `400 INVALID_INPUT` を返す。
  * 申請状態は `GET /api/submissions/:id` で確認できる。`client_key_hash` が一致しない場合は `403 UNAUTHORIZED_REQUEST_ACCESS` を返す。
  * 濫用対策として、Cloudflare の Rate Limiting で IP とクライアントごとに申請数を制限する。
* **管理者審査（`POST /api/admin/reviews`、Cloudflare Access で保護）**: 管理者は根拠 URL を実際に開いて内容を確かめ、PII を除いた公開用の文面を作ってから承認する。承認した時点で `public_entries` を作る。却下と撤回も記録する。
* **真正性の限界**: 監査結果は利用者のブラウザで作られるため、サーバーはそれが改ざんされていないことを保証できない。公開の可否は管理者の審査で担保する。公開辞典にもこの点を明記する。

### ⑤ D1 データベース（3テーブル）

1. `submissions`: 公開申請（本人同意の記録を兼ねる）
   * `submission_id` (TEXT PK), `client_key_hash` (TEXT NOT NULL), `claim_cache_key` (TEXT NOT NULL), `original_claim` (TEXT NOT NULL), `context` (TEXT NULLABLE), `locale` (TEXT NOT NULL), `result_json` (TEXT NOT NULL), `provider` (TEXT NOT NULL), `model` (TEXT NOT NULL), `consent_version` (TEXT NOT NULL), `review_state` (TEXT: `PENDING` | `APPROVED` | `REJECTED`), `created_at` (TEXT), `updated_at` (TEXT)
2. `public_entries`: 公開承認済みの編集・サニタイズ済み辞典エントリ（公開APIが参照する唯一のテーブル）
   * `entry_id` (TEXT PK), `submission_id` (TEXT UNIQUE FK), `claim_cache_key` (TEXT INDEX), `publication_status` (TEXT: `PUBLISHED` | `RETRACTED`), `audit_status` (TEXT), `category` (TEXT NULLABLE), `severity_score` (INTEGER NULLABLE), `sanitized_title` (TEXT), `sanitized_claim` (TEXT), `correction` (TEXT NULLABLE), `evidence_json` (TEXT), `audit_trace_json` (TEXT), `limitations_json` (TEXT), `estimated_error_pattern` (TEXT NULLABLE), `ttl_category` (TEXT), `provider` (TEXT), `model` (TEXT), `verified_at` (TEXT), `expires_at` (TEXT), `published_at` (TEXT)
3. `publication_reviews`: 管理者による承認・却下・撤回の監査証跡
   * `review_id` (TEXT PK), `submission_id` (TEXT NOT NULL FK), `entry_id` (TEXT NULLABLE FK), `reviewer_id` (TEXT NOT NULL), `action` (TEXT: `APPROVE` | `REJECT` | `RETRACT`), `reason` (TEXT), `created_at` (TEXT)

### ⑥ Chrome 拡張の状態管理

* 監査の状態（`request_id`、入力、進行状態、結果）は `chrome.storage.session` に保持し、Side Panel を閉じて開き直したときに復元する。
* 監査は Background Service Worker で実行し、Side Panel が閉じていても完了まで続ける。Service Worker が途中で停止した場合は、その監査を「中断」として表示し、再実行を促す。
* Side Panel はユーザー操作（アクションボタンまたは右クリックメニュー）を起点に開く。

### ⑦ 再現可能なデモモード（LIVE / DEMO の分離）

* `mode = 'DEMO'` は、事前に用意したシードデータを返し、画面に `DEMO / Recorded Result` を明示する。AI を呼ばず、プライベートキャッシュにも保存せず、公開申請もできない。

---

## 5. 機械検証可能なスキーマ定義

スキーマの実装は `packages/schema/src/index.ts` を正とする。本章はその不変条件を定める。

* **列挙値**
  * `audit_status`: `CONFIRMED_HALLUCINATION` / `SUPPORTED_CLAIM` / `UNVERIFIED_OR_AMBIGUOUS`
  * `evidence_status`: `VERIFIED` / `CONFLICTING` / `INSUFFICIENT` / `UNAVAILABLE` / `OUTDATED`
  * `category`: `Fact_Fabrication` / `Chronological_Error` / `Logic_Collapse` / `Citation_Ghost` / `Calculation_Bug` / `Other`
  * `ttl_category`: `HISTORICAL_FACT` / `LAW_OR_INSTITUTION` / `CURRENT_NEWS` / `REALTIME`
  * `audit_trace.decomposed_claims[].status`: `CONTRADICTED` / `SUPPORTED` / `UNVERIFIABLE`
* **監査結果の項目**: `request_id`(uuid), `mode`, `auditor`（`provider`: `ANTHROPIC` | `OPENAI`, `model`）, `is_valid_input`, `contains_pii`, `audit_status`, `evidence_status`, `severity_score`(1〜5 または null), `category`, `ttl_category`, `verified_at`, `expires_at`, `evidence_checked_at`, `normalized_claim`, `context_fingerprint`, `audit_trace`（`decomposed_claims` 1件以上、`alignment_reasoning`、`abstention_reason`）, `hallucinated_claim`, `correction`, `unverified_notes`, `evidence_sources`（`title`, `url`, `snippet`, `verified`）, `estimated_error_pattern`, `limitations`
* **不変条件**
  1. `CONFIRMED_HALLUCINATION`: `evidence_status = VERIFIED`、`verified = true` の根拠1件以上、`hallucinated_claim` と `correction` が必須。
  2. `SUPPORTED_CLAIM`: `evidence_status = VERIFIED`、`verified = true` の根拠1件以上が必須。
  3. `UNVERIFIED_OR_AMBIGUOUS`: `correction = null`。`limitations` 1件以上と `audit_trace.abstention_reason` が必須。
* **API 標準エラー応答**

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "入力内容が不正です。",
    "request_id": null
  }
}
```

* **エラーコード**: `INVALID_INPUT` / `UNAUTHORIZED_REQUEST_ACCESS` / `RATE_LIMITED` / `UPSTREAM_AI_UNAVAILABLE` / `INTERNAL_AUDIT_SCHEMA_VIOLATION` / `INTERNAL_ERROR`（`UPSTREAM_AI_UNAVAILABLE` と `INTERNAL_AUDIT_SCHEMA_VIOLATION` は拡張内部の表示用）

---

## 6. 監査品質の評価基盤（Eval Suite）

JSON スキーマの構造検証とは独立して、「監査結果が事実および設計原則に照らして妥当か」を検証する評価基盤（`packages/eval`）を実装の中心に据える。拡張と同じ監査コード（`packages/audit-core`）を Node から呼び、AI の種類ごとに測定する。実行は開発者自身のキーで行い、1回の実行で何件呼ぶかを事前に表示する。

### ① 評価データセット構成（計20件のGround Truthケース）
※ 監査プロセスの妥当性を確かめるための設計値であり、統計的な性能保証を意味しない。

1. **明確な事実誤認（8件）**: 施行年・数値・制度内容等に一次資料で裏付け可能な誤りがあるケース（期待出力: `CONFIRMED_HALLUCINATION` かつ正しい根拠と訂正）。
2. **正しい主張（5件）**: 事実と合致しているケース（期待出力: `SUPPORTED_CLAIM`）。
3. **根拠不足・曖昧・未来予測（5件）**: 一次資料が存在しない、または見解が分かれるケース（期待出力: `UNVERIFIED_OR_AMBIGUOUS` かつ `correction: null`）。
4. **キャッシュ境界事例（2件・ペア検証）**: 同一文脈で「数値のみ」「否定表現のみ」が異なる類似文ペア（期待動作: 異なる `claim_cache_key` となること）。

### ② 測定する4つの評価指標
* **誤訂正率 (False Correction Rate)**: 正しい主張（5件）や根拠不足（5件）に対し、誤って `CONFIRMED_HALLUCINATION` と断定した割合（目標: 0%）。
* **判定保留の適切性 (Abstention Accuracy)**: 根拠不足・曖昧な主張（5件）で `UNVERIFIED_OR_AMBIGUOUS` とし、保留理由を明示できた割合。
* **根拠の実在・対応確認率 (Evidence Grounding Rate)**: `evidence_sources` の URL が実在し、スニペットが検証内容と整合している割合。
* **誤キャッシュ率 (False Cache Hit Rate)**: キャッシュ境界事例および異なる `context_fingerprint` 間で誤ってキャッシュが再利用された割合（目標: 0%）。

---

## 7. デモの成功条件（End-to-End Story）

「Geminiを論破する」対立的な演出は行わず、「個人の検証から社会の集合知への変換プロセス」を一気通貫で示す。
1. **多段階監査と保留の誠実さ**: Chrome拡張から自分のキーで監査を実行し、Side Panel上で「主張の分解 ➔ 根拠照合 ➔ 判定（確証がない場合は保留）」の工程が可視化されること。
2. **集合知への昇華フロー**: ①本人が公開に同意して申請し、②管理者が根拠とPIIを確認して承認することで初めて、③公開辞典（`geminihall.cc`）に掲載され、他の利用者の公開キャッシュとして照会できるようになること。

---

## 8. 変更履歴

* **2026-10-15 v2**: 方針変更により、以下を v1 から変更した。
  * サーバー負担の無料監査枠（初回累計3回）、`quota_usage`、`audit_requests`、`audit_results` を廃止した。監査は利用者のキーでブラウザ内だけで実行する。
  * 対応する AI を Claude と OpenAI の2社にした。
  * LINE 連携を対象外にした。
  * プライベートキャッシュをサーバーからブラウザ内へ移した。
  * 本人同意（v1 の `publication_consents`）を公開申請（`submissions`）に統合した。
  * `publication_reviews` の参照先を `submission_id` にした（v1 では却下時に参照先の行がなく、外部キーが成立しなかった）。
  * `SUPPORTED_CLAIM` にも検証済みの根拠を必須とした（非オラクル原則に合わせるため）。
  * 監査結果に `auditor`（AI の種類とモデル）を追加した。
  * Zod 4 を使う。
* **2026-10-15 v2.1**（Phase 1 実装時）:
  * `submissions` に `context` と `locale`、`public_entries` に `ttl_category` を追加した。サーバーが申請内容からキャッシュキーを再計算し、監査結果の `normalized_claim` と `context_fingerprint` と一致しない申請を拒否するため、および公開辞典で情報の種類を表示するため。
  * エラーコードに `INTERNAL_ERROR` を追加した（サーバー内部の予期しない失敗用）。
  * 公開申請の識別子（`submission_id`）には監査結果の `request_id` を使い、同じ申請の再送を冪等にした。
  * `UNVERIFIED_OR_AMBIGUOUS` の申請を承認する場合、管理者が訂正文を入力しても公開エントリの `correction` は `null` にする（不変条件3を公開側にも適用するため）。
