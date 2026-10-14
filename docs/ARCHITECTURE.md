# UpShift AI Gig Discovery Engine — Architecture & System Design

> **Document Version:** 1.0  
> **FRD Reference:** FRD v1.0 Section 19, 26 (Deliverable #42)  
> **Status:** Verified Active Implementation  

---

## 1. Executive Summary

The **UpShift AI Gig Discovery Engine** is a high-reliability, automated opportunity ingestion, classification, verification, and human-in-the-loop publishing pipeline. It continuously scans permitted external data providers, extracts and validates structured gig data, categorizes listings into six distinct UpShift modules (**M1–M6**), isolates unapproved listings in a secure staging repository, and publishes verified opportunities to the learner directory only after human administrator approval and automated network availability checks.

---

## 2. System Architecture Diagram

```mermaid
graph TB
    subgraph External_Sources["1. Permitted External Sources (FRD Sec 10)"]
        S1["Arbeitnow API<br/>(M4/M6 Tech Jobs)"]
        S2["Remotive API<br/>(M1-M5 Remote)"]
        S3["We Work Remotely<br/>(RSS Feeds)"]
        S4["Hugging Face / Devpost<br/>(Bounties & Tasks)"]
        S5["Kaggle / Curated Feeds<br/>(Data & AI Gigs)"]
    end

    subgraph Ingestion_Pipeline["2. Ingestion & Normalization Worker (FRD Sec 19)"]
        SR["Source Registry & Health Tracker<br/>(src/server/sources.js)"]
        FETCH["HTTP / API Ingestion Engine<br/>(Rate limits & Robots.txt)"]
        DEDUP["Deduplication Engine<br/>(URL, Ext ID & Canonical Hash)"]
    end

    subgraph AI_Verification["3. AI Classification & Verification (FRD Sec 11, 14)"]
        EXTRACT["Data Extractor<br/>(Compensation, Roles, Dates)"]
        VERIFY["Activity Verifier<br/>(Active / Paused / Stopped / Needs Review)"]
        MODULE["Module Matcher M1-M6<br/>(Weighted Keyword & Fit Scoring)"]
        PRIORITY["Composite Review Priority Scorer<br/>(0 - 100 Scale)"]
    end

    subgraph Staging_Isolation["4. Isolated Staging Layer (FRD Sec 16, 26)"]
        STAGING[("public.gig_candidates<br/>(Supabase Isolated Staging)")]
        LOCAL_STORE[("data/candidates.json<br/>(Local Dev Persistence)")]
        RLS["Row Level Security (RLS)<br/>(Admins: Full Access / Learners: Blocked)"]
    end

    subgraph Admin_Review["5. Human Review & Approval Gateway (FRD Sec 17, 21)"]
        UI_QUEUE["Candidate Review Queue UI<br/>(CandidateReviewQueue.jsx)"]
        INSPECT["Modal Inspector & Editor<br/>(Module, Tracked URLs, Audit Notes)"]
        REV_CTRL["Pause / Stop Controls<br/>(REV-06 Human Overrides)"]
        GATE["Mandatory Referral Gate<br/>(REF-03 Gate Verification)"]
        PRECHECK["Pre-Publish Network Recheck<br/>(PUB-02 Live Availability Probe)"]
    end

    subgraph Published_Directory["6. Production Directory & Output (FRD Sec 18, 22)"]
        NOTIF["Notification Event Dispatcher<br/>(src/server/notifications.js)"]
        CSV["19-Column CSV Exporter<br/>(src/discovery/csvExport.js)"]
        LIVE_GIGS[("public.gigs<br/>(Live Learner Directory)")]
        LEARNER_UI["Learner Opportunities View<br/>(Opportunities.jsx)"]
    end

    subgraph Monitoring_Daemon["7. Daily Health Monitor (FRD Sec 21)"]
        MONITOR["Health Monitoring Worker<br/>(src/server/monitor.js)"]
    end

    %% Flow Connections
    External_Sources --> FETCH
    SR --> FETCH
    FETCH --> DEDUP
    DEDUP --> EXTRACT
    EXTRACT --> VERIFY
    VERIFY --> MODULE
    MODULE --> PRIORITY
    PRIORITY --> STAGING
    PRIORITY --> LOCAL_STORE
    STAGING --- RLS

    STAGING --> UI_QUEUE
    UI_QUEUE --> INSPECT
    INSPECT --> REV_CTRL
    REV_CTRL --> GATE
    GATE --> PRECHECK
    PRECHECK -->|Healthy & Approved| LIVE_GIGS
    PRECHECK -->|Healthy & Approved| NOTIF
    PRECHECK -->|HTTP 404 / Closed| STAGING
    LIVE_GIGS --> LEARNER_UI
    LIVE_GIGS --> CSV

    MONITOR -->|Recheck Active Listings| LIVE_GIGS
    MONITOR -->|Mark Stopped on 404| STAGING
    MONITOR -->|Record Source Health| SR
```

---

## 3. Core Component Subsystems

### 3.1. External Ingestion & Source Registry (`src/server/sources.js`)
- **Permitted Sources:** Arbeitnow, Remotive, We Work Remotely, Hugging Face, Devpost, Kaggle, Contra.
- **Constraints (`SRC-01`, `SRC-02`, `SRC-03`):** Public feeds and APIs only. Zero bypass of authentication, paywalls, or CAPTCHA. Strict per-source rate limiting (10–60 RPM).
- **Health Tracking (`SRC-05`):** Tracks `consecutive_errors`, `last_checked_at`, `total_discoveries`, and flags sources as `healthy`, `degraded`, or `failing`.

### 3.2. Extraction & Verification Engine (`src/server/activityVerifier.js`, `pipeline.js`)
- **Canonical Activity States:** `Active`, `Paused`, `Stopped`, and `Needs Review`.
- **Truth In Advertising:** Never fabricates missing compensation or dates (`T07`, `T08`). If compensation is unspecified, records `"Unspecified"` and sets numeric ranges to `0`.
- **Deduplication:** Normalizes URLs and checks `external_gig_id` and `source_listing_id` before inserting records.

### 3.3. Isolated Staging Layer (`public.gig_candidates`)
- Staging table separated from live learner table (`public.gigs`).
- **PostgreSQL RLS:** `Admins have full access to gig_candidates` enforces `is_admin()`. Anonymous clients receive `401 / 42501 (permission denied)`. Authenticated learners receive `[]` (zero rows) and zero write access.

### 3.4. Human Approval Gateway & Safety Constraints (`src/discovery/candidateStore.js`)
- **Approval Gate (`REV-01`, `T10`):** No candidate can transition to live gigs without explicit `approved` status.
- **Mandatory Referral Gate (`REF-03`, `T12`):** When `referral_required: true`, publishing is strictly blocked if `referral_id` or `referral_url` is missing.
- **Pre-Publication Reachability Recheck (`PUB-02`, `VER-08`, `T11`):** Immediately before insertion into `public.gigs`, the engine performs an automated network probe. If the target URL returns 404, 410, or closed signals, the candidate is marked `Stopped` and publishing is aborted.

### 3.5. 19-Column CSV Contract (`src/discovery/csvExport.js`)
- Generates exact RFC 4180 compliant CSV exports matching the 19 required columns in exact specification order:
  `external_gig_id`, `title`, `track_id`, `payment_amount`, `compensation_type`, `min_amount`, `max_amount`, `currency`, `priority`, `is_featured`, `is_local_business`, `posted_at`, `origin_url`, `short_description`, `overview`, `responsibilities`, `deliverables`, `requirements`, `proof_spec`.
- Strictly filters out unapproved, paused, rejected, or stopped records (`T13`).

### 3.6. Scheduled Health Monitoring (`src/server/monitor.js`)
- Daily / continuous daemon that re-verifies active opportunities.
- Prevents false `Active` states (`PUB-05`): dead listings are downgraded to `Stopped`, and `opportunity.health_status_changed` notifications are dispatched.

---

## 4. Security & Boundary Architecture

| Boundary | Mechanism | Verification Method |
| :--- | :--- | :--- |
| **Database Permissions** | `REVOKE` excessive grants from `anon` & `authenticated` | `information_schema.role_table_grants` |
| **Learner Isolation** | Row Level Security (RLS) with `is_admin()` policy | REST API probe returned `HTTP 200 []` |
| **Server Secrets** | Strict server-side isolation; no `VITE_` prefix on service keys | Automated scan (`scripts/verify_bundle_secrets.mjs`) |
| **Production Shield** | Standalone dev database; zero prod migrations executed | Isolated config verification |
