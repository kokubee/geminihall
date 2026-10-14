CREATE TABLE submissions (
  submission_id TEXT PRIMARY KEY,
  client_key_hash TEXT NOT NULL,
  claim_cache_key TEXT NOT NULL,
  original_claim TEXT NOT NULL,
  context TEXT,
  locale TEXT NOT NULL,
  result_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  review_state TEXT NOT NULL CHECK (review_state IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_submissions_review ON submissions (review_state, created_at);
CREATE INDEX idx_submissions_client ON submissions (client_key_hash, created_at);

CREATE TABLE public_entries (
  entry_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions (submission_id),
  claim_cache_key TEXT NOT NULL,
  publication_status TEXT NOT NULL CHECK (publication_status IN ('PUBLISHED', 'RETRACTED')),
  audit_status TEXT NOT NULL,
  category TEXT,
  severity_score INTEGER,
  sanitized_title TEXT NOT NULL,
  sanitized_claim TEXT NOT NULL,
  correction TEXT,
  evidence_json TEXT NOT NULL,
  audit_trace_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  estimated_error_pattern TEXT,
  ttl_category TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE INDEX idx_public_entries_cache ON public_entries (claim_cache_key, publication_status, expires_at);
CREATE INDEX idx_public_entries_list ON public_entries (publication_status, published_at);

CREATE TABLE publication_reviews (
  review_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions (submission_id),
  entry_id TEXT REFERENCES public_entries (entry_id),
  reviewer_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'RETRACT')),
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_publication_reviews_submission ON publication_reviews (submission_id, created_at);
