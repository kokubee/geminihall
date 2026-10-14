# GeminiHall (geminihall.cc) プロダクト確定仕様書 (SPEC.md)

## 1. プロダクト定義と基本原則

* **定義**: AIが生成した情報を、人間が検証・判断できる「証拠付きの監査記録（Evidence-Backed Audit Record）」へ変換し、個人の検証作業を社会的に再利用可能な集合知（構造化アーカイブ）へと昇華させる情報の信頼性インフラ。
* **基本原則（Non-Oracle & Epistemic Humility）**:
  1. **非オラクル原則**: Claudeを無謬の正解判定者として扱わない。他モデルの出力を一方的に論破するのではなく、「どの根拠に基づき、どこまでが検証可能で、どこからが判定不能か」を監査する。外部ソースによる裏付けが確認できない限り `CONFIRMED_HALLUCINATION` へ昇格させない。
  2. **多段階監査の透明性**: Claudeによる監査をブラックボックスな一発回答にせず、「①主張の原子的分解 ➔ ②外部根拠との照合 ➔ ③矛盾の特定・または確証不足による判定保留」の独立した監査工程（`audit_trace`）として構造化・可視化する。
  3. **時間的・文脈的限界の明示**: キャッシュヒットを「現在も正しい保証」として扱わない。情報の性質に応じたTTL（有効期限）と検証時点の文脈（`context_fingerprint`）を管理する。
  4. **私的監査と公的集合知の分離**: 監査の実行（プライベート履歴）と辞典への公開（本人同意＋管理者承認を経たパブリック掲載）をデータ構造・認可・キャッシュの各レベルで完全に分離する。

---

## 2. 実装スコープ区分（機能凍結）

実装優先度を以下の通り厳格に区分する。「必須（Must-Have）」がすべて受入テストを通過するまで、「余力対応」に着手してはならない。

| 区分 | 対象機能 |
| :--- | :--- |
| **必須 (Must-Have)** | ・Chrome拡張の手動入力・選択テキスト（Context Menu）・Side Panel表示（多段階監査トレース可視化）と状態復元<br>・Hono経由の無料監査（初回累計3回・`request_id` 冪等管理・所有者認可）<br>・BYOK直接通信の実機検証と不成立時の安全な縮退動作<br>・判定不能（`UNVERIFIED_OR_AMBIGUOUS`）および多段階監査トレースを含むClaude監査結果（Zod不変条件検証）<br>・20件の正解確認済み評価セット（Eval Suite）と4指標の自動測定スクリプト<br>・キャッシュ隔離（同一クライアント内プライベート再利用 ＋ 他ユーザー向け公開承認済みキャッシュ再利用）<br>・6テーブル分離構造、ユーザー同意記録、管理者公開承認ゲート（個人の検証から集合知への変換フロー）<br>・LINE非同期監査（Webhook即時応答 ＋ Cloudflare Queues ＋ Push API返信 ＋ 判読失敗時の枠解放）<br>・公開辞典の基本UI、LIVE / DEMOモードの明示的分離 |
| **余力対応 (Stretch)** | ・Gemini画面のDOM自動抽出ボタンの高度化<br>・Cloudflare Vectorize（`@cf/baai/bge-m3`）による公開承認済み事例の類似検索<br>・監査結果のストリーミング表示 |
| **対象外 (Out of Scope)** | ・X（旧Twitter）等の自動スクレイピング収集<br>・LLMによる公開自動承認<br>・一般ユーザー向けの複雑なアカウント認証基盤 |

---

## 3. コア技術仕様（確定設計）

### ① 無料枠（初回累計3回無料）の冪等管理と失敗時解放

事業モデル（PLG型フリーミアム）に合わせ、無料監査枠は「クライアント識別子（`client_key_hash`）およびチャネル単位での初回累計3回無料」に統一する。4回目以降はBYOKへの移行を促す。

* **クォータ管理テーブル (`quota_usage`)**: `client_key_hash` と `channel`（`CHROME` / `LINE`）の複合主キーで、`consumed_count`（確定消費数）と `reserved_count`（処理中予約数）を管理する。日付によるリセットは行わない。
* **クォータ状態 (`quota_state`)**: `RESERVED`（予約） / `CONSUMED`（検証成功により確定消費） / `RELEASED`（失敗・入力不正により解放）の3段階で管理する。
* **原子的予約と冪等性**:
  1. 新規 `request_id` 受付時、`consumed_count + reserved_count < 3` を条件として `reserved_count` を `+1` し、`audit_requests` に `quota_state = 'RESERVED'`, `audit_state = 'PENDING'` として同一トランザクション（D1 `batch` または条件付きUPDATE）で登録する。
  2. 同一 `request_id` が再送された場合は、新たに枠を予約せず、既存の処理状態または結果を返す。
  3. 監査が正常完了した時点でのみ `reserved_count - 1`, `consumed_count + 1`, `quota_state = 'CONSUMED'` へ遷移させる。
  4. 入力不正、LINE画像の判読不能、外部API障害、または予約から120秒以上停止したレコードは、`quota_state` が `RESERVED` の場合に限り一度だけ `RELEASED` へ遷移させ、`reserved_count - 1` で枠を返還する（二重減算の防止）。

### ② LINE Webhookの非同期処理（Cloudflare Queues + Push API）

LINE Messaging APIの仕様（Webhookの即時応答要件および `replyToken` の有効期限1分制限）を遵守し、完全非同期アーキテクチャとする。

* **処理フロー**:
  1. **Webhook受信・検証 (`POST /api/webhook/line`)**: `x-line-signature` を検証後、LINEイベントの `webhookEventId` を確認する。既にD1に同一 `webhookEventId` が存在する場合は再配信とみなし、処理を行わず即座に `HTTP 200 OK` を返す。
  2. **冪等登録・キュー投入**: `quota_usage` の予約と `audit_requests` への登録を行い、ジョブを **Cloudflare Queues** へ投入する。
  3. **即時応答**: 必要に応じて `replyToken` を用いて受付メッセージを即時返信し、Webhook自体は1〜2秒以内に `HTTP 200 OK` を返して終了する。
  4. **Queue Consumer処理**: バックグラウンドのQueue Consumerがメッセージを受信し、Claude監査および外部根拠確認を実行し、結果をD1へ保存する。
  5. **結果送信 (LINE Push API)**: 監査完了後（または判読失敗による枠解放後）、LINEの **Push Message API (`POST /v2/bot/message/push`)** を用いてユーザーの `userId` 宛にFlex Message（またはフォールバック案内）を送信する。

### ③ キャッシュの所有権隔離・TTL・文脈管理

キャッシュの一致を理由に他人のプライベートな監査結果を返却してはならない。

* **再利用スコープの厳格な分離**:
  1. **パブリックキャッシュ (`public_entries` 参照)**: 公開承認ゲートを通過し、`publication_status = 'PUBLISHED'` かつ `expires_at > now` の事例は、全ユーザーに対してキャッシュヒットとして再利用可能とする。
  2. **プライベートキャッシュ (`audit_results` 参照)**: 未公開または個人利用の監査結果は、リクエスト元の `client_key_hash` が完全に一致する場合（同一クライアントからの再照会）に限り、`expires_at > now` の範囲で再利用を許可する。他ユーザーのプライベート監査結果は一切参照しない。
* **キャッシュキー算出式**:
  `claim_cache_key = SHA256(normalized_claim + "|" + context_fingerprint + "|" + audit_policy_version + "|" + locale)`
* **初期TTL設定**:
  * `HISTORICAL_FACT`（歴史的事実・確定した過去の出来事）: 30日
  * `LAW_OR_INSTITUTION`（法令・制度・企業仕様）: 24時間
  * `CURRENT_NEWS`（ニュース・現在の出来事）: 1時間
  * `REALTIME`（リアルタイム情報）: 再利用なし（TTL = 0）

### ④ D1データベース設計（6テーブル構造）とリクエスト所有者認可

1. `quota_usage`: クォータ累計管理
   * `client_key_hash` (TEXT), `channel` (TEXT: `CHROME` | `LINE`), `consumed_count` (INTEGER), `reserved_count` (INTEGER), `updated_at` (TEXT)
   * PRIMARY KEY (`client_key_hash`, `channel`)
2. `audit_requests`: 監査リクエスト・所有者・冪等管理
   * `request_id` (TEXT PK), `webhook_event_id` (TEXT UNIQUE NULLABLE), `client_key_hash` (TEXT NOT NULL), `channel` (TEXT NOT NULL), `quota_state` (TEXT: `RESERVED` | `CONSUMED` | `RELEASED`), `audit_state` (TEXT: `PENDING` | `RUNNING` | `COMPLETED` | `FAILED`), `error_code` (TEXT NULLABLE), `created_at` (TEXT), `updated_at` (TEXT)
3. `audit_results`: プライベート監査結果
   * `result_id` (TEXT PK), `request_id` (TEXT UNIQUE FK), `client_key_hash` (TEXT NOT NULL), `claim_cache_key` (TEXT), `audit_status` (TEXT), `evidence_status` (TEXT), `result_json` (TEXT), `verified_at` (TEXT), `expires_at` (TEXT), `evidence_checked_at` (TEXT NULLABLE)
4. `publication_consents`: ユーザーの公開提供同意記録
   * `consent_id` (TEXT PK), `request_id` (TEXT FK), `result_id` (TEXT FK), `client_key_hash` (TEXT NOT NULL), `consent_version` (TEXT NOT NULL), `agreed_at` (TEXT NOT NULL)
5. `public_entries`: 公開承認済みの編集・サニタイズ済み辞典エントリ（公開APIが参照する唯一のテーブル）
   * `entry_id` (TEXT PK), `result_id` (TEXT UNIQUE FK), `claim_cache_key` (TEXT INDEX), `publication_status` (TEXT: `PUBLISHED` | `RETRACTED`), `category` (TEXT), `severity_score` (INTEGER), `sanitized_title` (TEXT), `sanitized_claim` (TEXT), `correction` (TEXT), `evidence_json` (TEXT), `audit_trace_json` (TEXT), `estimated_error_pattern` (TEXT), `verified_at` (TEXT), `expires_at` (TEXT), `published_at` (TEXT)
6. `publication_reviews`: 管理者による承認・却下・公開撤回の監査証跡
   * `review_id` (TEXT PK), `entry_id` (TEXT FK), `reviewer_id` (TEXT NOT NULL), `action` (TEXT: `APPROVE` | `REJECT` | `RETRACT`), `reason` (TEXT), `created_at` (TEXT)

* **エンドポイントの所有者認可 (`GET /api/requests/:id`, `POST /api/consents`)**:
  リクエストヘッダーの `X-Client-Token` をサーバー側でSHA-256ハッシュ化し、対象レコードの `audit_requests.client_key_hash` と一致することを検証する（不一致時は `HTTP 403 Forbidden` を返す）。

### ⑤ Chrome拡張の状態管理とBYOKゼロトラスト設計

* **状態復元**: `request_id` とクライアントトークンを `chrome.storage.session` に保持し、Side Panelの再表示時に `GET /api/requests/:id`（要 `X-Client-Token` ヘッダー）で状態を復元する。
* **BYOKの隔離と縮退動作**:
  * APIキーは `chrome.storage.session`（`TRUSTED_CONTEXTS` 限定）にのみ保持し、Content ScriptやHonoサーバーへは一切送信・記録しない。
  * Phase 0でBackground Service WorkerからAnthropic APIへの直接通信を検証する。成立しない場合はサーバー中継を自動有効化せず、BYOK機能を無効化（無料枠のみ提供）する安全な縮退動作とする。

### ⑥ 再現可能なデモモード（LIVE / DEMO の分離）

* `mode = 'DEMO'` のリクエストは、事前に検証・用意されたシードデータを返却し、画面上に `DEMO / Recorded Result` を明示する。
* **統計・履歴の汚染防止**: `DEMO` モードの実行は `quota_usage` を消費せず、LIVE用の `audit_requests` / `audit_results` にも記録・集計しない。

---

## 4. 機械検証可能なスキーマ定義（Zod Invariants & Multi-Step Audit Trace）

Zodスキーマは「JSONの構造的妥当性と状態間の論理的不変条件」を機械検証するものであり、後述する第5章の「事実としての正しさの評価基盤（Eval Suite）」と組み合わせて品質を担保する。

```typescript
import { z } from "zod";

export const AuditStatusEnum = z.enum([
  "CONFIRMED_HALLUCINATION",
  "SUPPORTED_CLAIM",
  "UNVERIFIED_OR_AMBIGUOUS",
]);

export const EvidenceStatusEnum = z.enum([
  "VERIFIED",
  "CONFLICTING",
  "INSUFFICIENT",
  "UNAVAILABLE",
  "OUTDATED",
]);

export const CategoryEnum = z.enum([
  "Fact_Fabrication",
  "Chronological_Error",
  "Logic_Collapse",
  "Citation_Ghost",
  "Calculation_Bug",
  "Other",
]);

export const TtlCategoryEnum = z.enum([
  "HISTORICAL_FACT",
  "LAW_OR_INSTITUTION",
  "CURRENT_NEWS",
  "REALTIME",
]);

export const EvidenceSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string().min(1),
  verified: z.boolean(),
});

// Claude固有の多段階監査工程を可視化するトレース構造
export const AuditTraceSchema = z.object({
  decomposed_claims: z.array(
    z.object({
      sub_claim: z.string().min(1),
      verification_target: z.string().min(1),
      status: z.enum(["CONTRADICTED", "SUPPORTED", "UNVERIFIABLE"]),
    })
  ).min(1),
  alignment_reasoning: z.string().min(1),
  abstention_reason: z.string().nullable(),
});

export const AuditResultSchema = z
  .object({
    request_id: z.string().uuid(),
    mode: z.enum(["LIVE", "DEMO"]),
    is_valid_input: z.boolean(),
    contains_pii: z.boolean(),
    audit_status: AuditStatusEnum,
    evidence_status: EvidenceStatusEnum,
    severity_score: z.number().int().min(1).max(5).nullable(),
    category: CategoryEnum.nullable(),
    ttl_category: TtlCategoryEnum,
    verified_at: z.string().datetime(),
    expires_at: z.string().datetime(),
    evidence_checked_at: z.string().datetime().nullable(),
    normalized_claim: z.string().min(1),
    context_fingerprint: z.string().min(1),
    audit_trace: AuditTraceSchema,
    hallucinated_claim: z.string().nullable(),
    correction: z.string().nullable(),
    unverified_notes: z.string().nullable(),
    evidence_sources: z.array(EvidenceSourceSchema),
    estimated_error_pattern: z.string().nullable(),
    limitations: z.array(z.string()),
  })
  .superRefine((data, ctx) => {
    // 不変条件1: CONFIRMED_HALLUCINATION の場合、evidence_status は必ず VERIFIED かつ検証済みソースが1件以上必須
    if (data.audit_status === "CONFIRMED_HALLUCINATION") {
      if (data.evidence_status !== "VERIFIED") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CONFIRMED_HALLUCINATION requires evidence_status to be VERIFIED",
          path: ["evidence_status"],
        });
      }
      if (!data.evidence_sources.some((s) => s.verified)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CONFIRMED_HALLUCINATION requires at least one verified evidence source",
          path: ["evidence_sources"],
        });
      }
      if (!data.correction || !data.hallucinated_claim) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CONFIRMED_HALLUCINATION requires both hallucinated_claim and correction",
          path: ["correction"],
        });
      }
    }

    // 不変条件2: UNVERIFIED_OR_AMBIGUOUS の場合、未確認の訂正内容を確定事実 (correction) として格納してはならない
    if (data.audit_status === "UNVERIFIED_OR_AMBIGUOUS") {
      if (data.correction !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "UNVERIFIED_OR_AMBIGUOUS must have correction = null; use unverified_notes and limitations instead",
          path: ["correction"],
        });
      }
      if (data.limitations.length === 0 || !data.audit_trace.abstention_reason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "UNVERIFIED_OR_AMBIGUOUS requires limitation explanation and audit_trace.abstention_reason",
          path: ["limitations"],
        });
      }
    }
  });
```

### API標準エラー応答スキーマ

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "初回無料枠（3回）を使い切りました。設定画面からBYOKを設定してください。",
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "quota_released": true
  }
}
```

* **エラーコード列挙値 (`error.code`)**:
  * `INVALID_INPUT` / `QUOTA_EXCEEDED` / `UNAUTHORIZED_REQUEST_ACCESS` / `UPSTREAM_AI_UNAVAILABLE` / `INTERNAL_AUDIT_SCHEMA_VIOLATION`

---

## 5. 監査品質の評価基盤（Eval Suite）とデモ成功条件

JSONスキーマの構造検証とは独立して、「監査結果が事実および設計原則に照らして妥当か」を検証する評価基盤（`packages/eval`）を実装の中心に据える。

### ① 評価データセット構成（計20件のGround Truthケース）
※本件数はハッカソン期間内で監査プロセスの妥当性を検証するための評価設計値であり、統計的な性能保証を意味しない。

1. **明確な事実誤認（8件）**: 施行年・数値・制度内容等に一次資料で裏付け可能な誤りがあるケース（期待出力: `CONFIRMED_HALLUCINATION` かつ正しい根拠と訂正）。
2. **正しい主張（5件）**: 事実と合致しているケース（期待出力: `SUPPORTED_CLAIM`、過剰な誤り指摘＝False Positiveを起こさないこと）。
3. **根拠不足・曖昧・未来予測（5件）**: 一次資料が存在しない、または見解が分かれるケース（期待出力: `UNVERIFIED_OR_AMBIGUOUS` かつ `correction: null` で適切に判定保留すること）。
4. **キャッシュ境界事例（2件・ペア検証）**: 同一文脈で「数値のみ」「否定表現のみ」が異なる類似文ペア（期待動作: 異なる `claim_cache_key` となり、誤って同一キャッシュが返却されないこと）。

### ② 測定する4つの評価指標（Eval Metrics）
* **誤訂正率 (False Correction Rate)**: 正しい主張（5件）や根拠不足（5件）に対し、誤って `CONFIRMED_HALLUCINATION` と断定・訂正してしまった割合（目標: 0%）。
* **判定保留の適切性 (Abstention Accuracy)**: 根拠不足・曖昧な主張（5件）において、無理に断定せず `UNVERIFIED_OR_AMBIGUOUS` として保留理由（`abstention_reason`）を明示できた割合。
* **根拠の実在・対応確認率 (Evidence Grounding Rate)**: 出力された `evidence_sources` のURLが実在し、かつスニペットが主張の検証内容と整合している割合。
* **誤キャッシュ率 (False Cache Hit Rate)**: キャッシュ境界事例および異なる `context_fingerprint` 間で誤ってキャッシュ再利用された割合（目標: 0%）。

### ③ デモおよびプレゼンテーションの成功条件（End-to-End Story）
プレゼンテーションでは「Geminiを論破する」対立的な演出を行わず、以下の「個人の検証から社会の集合知への変換プロセス」を一気通貫で実演する。
1. **多段階監査と保留の誠実さ**: Chrome拡張から監査を実行し、Side Panel上で「主張の分解 ➔ 根拠照合 ➔ 判定（および確証がない場合の保留表示）」の工程（`audit_trace`）が可視化されること。
2. **集合知への昇華フロー**: 個人の監査結果に対し、①本人が公開提供に同意（`POST /api/consents`）し、②管理者がPII・根拠を確認して承認（`POST /api/admin/reviews`）することで初めて、③公開辞典（`geminihall.cc`）に掲載され他ユーザーのキャッシュとして再利用可能になる一連のガバナンスを示すこと。

---

## 6. 実装時の補足決定（2026-10-15）

本章は、第1〜5章で未定義だった点、または第1〜5章どうしが矛盾していた点について、実装開始時に決めた内容を記録する。第1〜5章と食い違う場合は本章を優先する。

1. **キャッシュキーの算出時点**: `normalized_claim` と `context_fingerprint` は、Claude を呼ぶ前にサーバー側で決定的に計算する。正規化は NFKC 変換、前後空白の除去、連続空白を1つに圧縮、ラテン文字の小文字化とする。数字と否定語は変更しない。`context_fingerprint` は、文脈文字列（取得元の種別と、利用者が与えた任意の文脈）を正規化したものの SHA-256 とする。Claude の出力に含まれる同名の値は採用せず、サーバーの値で上書きする。
2. **完了と枠解放の競合**: CONSUMED への遷移は、`quota_state = 'RESERVED'` の行に限る条件付き更新とする。先に RELEASED になっていた場合、結果は保存せず、`audit_state = 'FAILED'`、`error_code = 'RESERVATION_EXPIRED'` とする。Claude 呼び出しのタイムアウトは100秒とし、120秒の解放期限より短くする。
3. **原子的予約**: D1 の `batch` を1トランザクションとして使う。①`quota_usage` の行がなければ作成する。②`consumed_count + reserved_count < 3` かつ同じ `request_id` が未登録の場合だけ `reserved_count` を1増やす。③直前の更新が1行だった場合（`changes() = 1`）だけ `audit_requests` を登録する。
4. **公開審査テーブル**: `publication_reviews` に `result_id`（NOT NULL）を追加し、`entry_id` は NULL を許す。REJECT は `result_id` だけで記録する。APPROVE のときに `public_entries` を作成し、`entry_id` を記録する。
5. **BYOK 結果の扱い**: BYOK の監査結果はサーバーへ送らず、`chrome.storage.session` にだけ保持する。キャッシュにも公開申請にも使わず、無料枠も消費しない。サーバーはその結果が実際に Claude の出力であることを確かめられないため、公開経路に乗せない。
6. **外部根拠の確認手段**: Claude の web search サーバーツール（`web_search_20260209`）を使う。`evidence_sources[].verified` は、その URL が同じ監査中の web search 結果に実際に含まれていた場合だけ、サーバー側で `true` にする。Claude が自分で書いた `verified` の値は採用しない。
7. **LINE 利用者の公開同意**: 結果の Flex Message に「公開に同意」ボタン（postback）を付ける。同じ `userId` から届いた postback だけを同意として記録する（Phase 2 で実装）。
8. **キャッシュヒット時の無料枠**: プライベートキャッシュでも公開キャッシュでも、ヒットした場合は無料枠を消費しない。
9. **SUPPORTED_CLAIM の不変条件**: 非オラクル原則に合わせ、`SUPPORTED_CLAIM` にも `evidence_status = 'VERIFIED'` と、検証済みの根拠1件以上を必須とする。
10. **Zod のバージョン**: Zod 4 を使う。カスタム検証のエラーコードは `"custom"` と書く。
11. **監査モデル**: `claude-opus-5-5` を使い、`output_config.effort` を明示する。拒否された場合に備え、サーバー側フォールバック（`fallbacks: "default"`）を有効にする。
