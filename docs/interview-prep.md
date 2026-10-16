# UpShift Gig Network — Technical Interview Preparation Guide

> **Purpose:** A practical, repository-grounded study guide to help you explain the architecture, implementation, security boundaries, and trade-offs of the UpShift project in technical interviews and code reviews without relying on AI.

---

## 1. Plain-English Architecture Explanation

If an interviewer asks: *"What is UpShift and how does it work?"*

> **Your Answer:**
> "UpShift is a dual-sided platform that connects student learners with verified micro-gigs across six career tracks (M1 to M6, ranging from data annotation and micro-tasks to web development and machine learning).
>
> The core problem we solve is data quality and student safety. Most online job boards are filled with expired listings, spam, misleading pay rates, and duplicates. UpShift solves this with an automated AI Discovery Engine and a human-in-the-loop review pipeline.
>
> The system has four main tiers:
> 1. **Client Tier:** A React 19 single-page application with React Router 7 and Vanilla CSS, providing separate portals for learners and administrators.
> 2. **Edge API Tier:** Cloudflare Pages Functions in production (with a local Vite middleware proxy for development) providing secure API endpoints for candidate review and discovery job dispatch.
> 3. **Worker & Ingestion Tier:** Background Node.js crawlers that fetch opportunities from permitted job boards and APIs, run multi-tier deduplication, classify listings into tracks, and calculate review priority scores.
> 4. **Persistence Tier:** A hosted Supabase PostgreSQL database protected by strict Row-Level Security (RLS), with separate tables for public gigs and unapproved staged candidates."

---

## 2. The 10 Most Important Files to Understand First

Read these files in this exact order to build a complete mental model of the project:

| # | File Path | What It Does & What To Notice |
| :-: | :--- | :--- |
| **1** | [`src/App.jsx`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/App.jsx) | **Application Root & Auth Guard.** Look at `AuthContext`, `loadProfile`, and `ProtectedRoute`. Notice how `loadProfile` fails closed to `'learner'` if the network fails or the user has no profile, preventing client-side role spoofing. |
| **2** | [`src/pages/CandidateReviewQueue.jsx`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/pages/CandidateReviewQueue.jsx) | **Admin Review Queue UI.** See how candidates are fetched, filtered by track/status/score, edited in inspection modals, and published or paused. Notice the export button triggering RFC 4180 CSV export. |
| **3** | [`src/pages/Dashboard.jsx`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/pages/Dashboard.jsx) | **Learner & Admin Dashboard.** Look at how learners filter opportunities across M1–M6 tracks, save gigs, and track applications. Look at how saved/applied gigs are stored under user-specific keys (`upshift_saved_gigs_${userId}`). |
| **4** | [`src/discovery/candidateStore.js`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/discovery/candidateStore.js) | **Repository Abstraction.** Manages storage for staged candidates. It handles dual-mode persistence (`supabase` vs `json`), enforces the **Mandatory Referral Gate** (`REF-03`), and triggers the **Pre-Publication Reachability Probe** (`PUB-02`) before inserting into `public.gigs`. |
| **5** | [`src/server/candidateApiHandler.js`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/server/candidateApiHandler.js) | **Dev Server API Gateway.** Implements `/api/candidates` in local development. Study `verifyTokenAndRole`: it verifies the JWT with Supabase Auth, queries `public.profiles` for `role = 'admin'`, and rejects unauthorized callers. |
| **6** | [`functions/api/candidates.js`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/functions/api/candidates.js) | **Cloudflare Production API.** The serverless edge equivalent of `candidateApiHandler.js`. Shows how production Cloudflare Pages Functions authenticate requests using `env.SUPABASE_SERVICE_ROLE_KEY`. |
| **7** | [`src/server/crawler.js`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/server/crawler.js) | **Resilient Crawler & SSRF Guard.** Inspect `validateSafeUrl` and `safeFetch`. Note how it resolves DNS before fetching to block loopback (`127.0.0.1`), private RFC 1918 subnets, cloud metadata (`169.254.169.254`), and re-checks DNS on every redirect hop. |
| **8** | [`src/server/moduleClassifier.js`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/server/moduleClassifier.js) | **Classification Engine.** Analyzes titles, descriptions, and tags against keyword weights to classify gigs into tracks M1–M6. Calculates `module_fit_scores` and composite `review_priority` (0–100). |
| **9** | [`src/server/deduplicator.js`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/src/server/deduplicator.js) | **Deduplication Engine.** Normalizes URLs (stripping UTM codes, tracking parameters, hashes) and hashes content to detect duplicates across different external job boards. |
| **10** | [`supabase/migrations/20261012000000_security_hardening.sql`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/supabase/migrations/20261012000000_security_hardening.sql) | **Database RLS & Security.** Defines Row-Level Security on `public.gigs` and `public.profiles`, and installs trigger `trg_protect_profile_role` preventing non-admins from escalating their role. |

---

## 3. Walkthrough of the Candidate Discovery-to-Publication Flow

Be ready to explain this complete 10-step lifecycle on a whiteboard:

1. **Scheduled Ingestion:** GitHub Actions (`scheduled-discovery.yml`) runs every 12 hours or an admin clicks "Run AI Discovery" in the queue.
2. **SSRF-Protected Fetching:** `crawler.js` checks the URL against DNS denylists before performing HTTP GET.
3. **HTML Sanitization & Normalization:** `htmlNormalizer.js` parses raw job page markup, strips dangerous schemes (`javascript:`, `data:`), and extracts structured fields.
4. **Truth-in-Advertising Enforcement:** If compensation or deadlines are not explicitly listed in the source, the system stores `"Unspecified"` and `min_amount: 0`. It never fabricates numbers.
5. **Track Classification (M1–M6):** `moduleClassifier.js` evaluates keyword matches and computes a fit score (0–100) for tracks M1 to M6.
6. **Deduplication & Clustering:** `deduplicator.js` checks if the normalized URL or body hash matches existing candidates. If so, it sets `is_duplicate: true` and links to the primary cluster ID.
7. **Isolated Staging Insertion:** The candidate is saved to `public.gig_candidates` with status `pending_review`. Staging is isolated by PostgreSQL RLS: standard learners cannot view it.
8. **Admin Review Queue:** The administrator inspects the candidate in `CandidateReviewQueue.jsx`. The admin can edit titles, descriptions, track assignment, or referral links.
9. **Referral Gate Check (`REF-03`):** If `referral_required` is true, approval is blocked until a valid `referral_url` and `referral_id` are provided.
10. **Pre-Publication Reachability Probe & Live Insertion (`PUB-02`):** Immediately before insertion into `public.gigs`, the engine makes an asynchronous HTTP HEAD/GET probe to the destination URL. If it returns 404, 410, or closed, the candidate is marked `Stopped`. If it returns HTTP 200, it is inserted into `public.gigs` and becomes visible to learners.

---

## 4. How React State and Components Work in This Project

- **Component Hierarchy:**
  ```
  App (Root router, global theme, notification banner)
  └── AuthContext.Provider (user, profile, role, loading, signIn, signOut)
      └── Routes
          ├── /dashboard -> Dashboard.jsx (Learner opportunity feed & admin tab container)
          ├── /admin -> CandidateReviewQueue.jsx (Admin curation queue with modal editor)
          ├── /login -> Login.jsx
          └── /signup -> Signup.jsx
  ```
- **State Architecture:**
  - Standard React hooks only: `useState`, `useEffect`, `useMemo`, `useCallback`, `useContext`.
  - No external state libraries (Redux, MobX, Zustand) are used, keeping bundle size low and code easy to trace.
- **Learner Storage Isolation:**
  - Bookmarked gigs, applied gigs, and notifications are stored in `localStorage` partitioned by the user's authoritative ID: `upshift_saved_gigs_${userId}`.
  - When a user logs out, state is cleared immediately; when another user logs in, their distinct storage key is loaded.
- **Optimistic UI Updates with Rollback:**
  - In `CandidateReviewQueue.jsx`, clicking "Approve", "Pause", or "Stop" immediately updates local React state so the UI feels instantaneous.
  - If the server API call fails (e.g., pre-publication probe returns 404 or referral URL is missing), an error banner is shown and the candidate state is rolled back.

---

## 5. How Supabase Is Used for Authentication and Data Access

- **Client Authentication:**
  - Browser initializes the Supabase client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (`src/lib/supabase.js`).
  - `supabase.auth.signInWithPassword()` authenticates credentials and stores the session JWT in browser storage.
- **Database Profiles & Roles:**
  - User records in `auth.users` are paired with application profiles in `public.profiles`.
  - The `profiles` table stores the authoritative `role` column (`admin` vs `learner`).
- **Row-Level Security (RLS):**
  - **`public.gigs`:** Public and learners can execute `SELECT` where `status = 'Active'`. Only administrators can `INSERT`, `UPDATE`, or `DELETE`.
  - **`public.gig_candidates`:** Only administrators (`public.is_admin()`) can read or modify staged records. Standard learner queries return zero rows.
  - **`public.profiles`:** Users can read profiles, but a BEFORE UPDATE trigger (`trg_protect_profile_role`) strictly prevents learners from updating their own `role` field.
- **Service Role Key Isolation:**
  - The privileged `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and is used exclusively by backend workers (`src/server/worker.js`) and API functions (`functions/api/candidates.js`). It is never bundled into the client build.

---

## 6. How the Backend Protects Admin Operations

- **Dev/Prod Parity:**
  - Both production Cloudflare Pages Functions (`functions/api/candidates.js`) and local Vite middleware (`src/server/candidateApiHandler.js`) share identical authorization logic.
- **Token Verification:**
  - Extracts the `Authorization: Bearer <token>` header.
  - Queries Supabase Auth (`supabase.auth.getUser(token)`) to verify token signature, expiration, and user identity.
- **Strict Role Verification:**
  - Once the user identity is confirmed, the server queries `public.profiles` for `role = 'admin'`.
  - The backend explicitly ignores client-supplied claims in `user_metadata.role` (which could be forged during signup).
  - If the profile is missing or the role is `'learner'`, the request is rejected with `HTTP 403 Forbidden`.
  - If the token is invalid or missing, the request is rejected with `HTTP 401 Unauthorized`.

---

## 7. How Duplicate Detection and SSRF Protection Work

### Duplicate Detection (`src/server/deduplicator.js`)
1. **Canonical URL Normalization:** Strips URL fragments (`#`), tracking query parameters (`utm_*`, `ref`, `source`, `fbclid`), and lowercases hostnames.
2. **External Listing ID Matching:** Compares platform-specific identifiers (e.g., `remotive-18923`).
3. **Content Hashing:** Computes an MD5 digest of `title + organization + normalized_description`.
4. **Clustering:** If a new candidate matches an existing record, the system assigns a shared `duplicate_cluster_id`, flags the new item as `is_duplicate: true`, and links it via `duplicate_of`.

### SSRF Protection (`src/server/crawler.js`)
1. **Scheme Validation:** Rejects non-HTTP schemes (`javascript:`, `data:`, `file:`, `ftp:`).
2. **IP & DNS Resolution:** Resolves the hostname to IP addresses before initiating a network connection.
3. **Denylist Verification:** Blocks connection if the resolved IP falls into:
   - Loopback: `127.0.0.0/8`, `::1`
   - Private RFC 1918 subnets: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - Cloud Metadata Services: `169.254.169.254`, `metadata.google.internal`
   - Carrier-Grade NAT: `100.64.0.0/10`
   - Link-local and Unique-local IPv6: `fe80::/10`, `fc00::/7`
4. **Redirect Hop Revalidation:** `safeFetch` disables default redirect following and re-runs full DNS and IP validation on every redirect location header to prevent DNS-rebinding attacks.

---

## 8. Asynchronous Discovery Jobs & Worker Coordination

- **Job Queue Table (`public.discovery_jobs`):**
  - Columns: `id`, `job_type`, `status` (`pending`, `running`, `succeeded`, `failed`), `lease_expires_at`, `claimed_by`.
- **Concurrency Control with `SKIP LOCKED`:**
  - When a worker starts, it invokes PostgreSQL stored function `claim_discovery_job(worker_id, lease_seconds)`.
  - The function uses `SELECT ... FOR UPDATE SKIP LOCKED` to atomically claim the next pending job and set a lease expiration (e.g., 15 minutes).
  - If multiple workers run simultaneously, they never process the same job.
- **Lease Expiration & Crash Recovery:**
  - If a worker crashes or drops off without completing, its lease expires. The next scheduler run reclaims expired jobs without deadlock.
- **Job Status Polling:**
  - The UI dispatches `POST /api/discovery/run`, receives a `job_id`, and polls `GET /api/discovery/status?job_id=...` until `status` is `succeeded`.

---

## 9. How Automated Tests Are Organized

- **Test Runner:** Node.js native test runner (`node --test`), requiring zero external dependencies like Jest or Mocha.
- **Coverage:** 293 tests across 38 suites in 14 test files (`tests/`).
- **Core Test Suites:**
  - `tests/security_remediation.test.js`: SSRF defense, CSV formula injection, frontend role spoofing prevention, dev/prod auth parity.
  - `tests/discovery_engine.test.js`: Ingestion pipeline, source rate-limiting, batch candidate processing.
  - `tests/deduplication_lifecycle.test.js`: URL normalization, external IDs, MD5 hashing, duplicate clustering.
  - `tests/frd_scenarios.test.js`: Referral gate rules (`REF-03`), pre-publication availability probe (`PUB-02`), 19-column RFC 4180 CSV export.
  - `tests/production_architecture.test.js`: RLS policy verification, table permissions, service key isolation.
  - `tests/scheduler.test.js`: Health monitoring, 24h daemon, source health degradation.
  - `tests/queue_sync_regression.test.js`: Review decisions, status transitions, data integrity of canonical 221 candidates.
  - `tests/admin_responsive_ui.test.js`: Mobile header drawer, navigation scrolling, and tablet layouts.

---

## 10. Three Technical Trade-Offs in the Implementation

Be prepared to discuss these design choices:

1. **Dual Storage Persistence (Database vs Local File):**
   - *Choice:* The system supports both Supabase PostgreSQL (`CANDIDATE_STORAGE=supabase`) and a local JSON file (`CANDIDATE_STORAGE=json`).
   - *Why:* Enables full offline local development, fast unit testing, and continuous integration without requiring active external cloud credentials.
   - *Trade-Off:* Requires `candidateStore.js` to maintain two repository implementations, requiring synchronization tests to ensure parity.
2. **Deterministic Keyword Scoring with Optional LLM Second-Pass:**
   - *Choice:* The module classifier uses weighted keyword heuristics as the primary classification engine, using LLMs only for optional enrichment.
   - *Why:* Eliminates cloud inference costs, guarantees ₹0 operating budget, and ensures predictable, millisecond classification latency.
   - *Trade-Off:* Complex job descriptions with ambiguous wording require careful keyword weighting dictionaries rather than pure semantic embeddings.
3. **Client-Side Optimistic Updates with Error Rollback:**
   - *Choice:* Admin review queue updates candidate cards immediately before the server response returns.
   - *Why:* Gives administrators a lightning-fast review experience without UI lag on high-volume batches.
   - *Trade-Off:* Adds state rollback logic in the component to restore previous state if the pre-publication network probe or database write fails.

---

## 11. Ten Likely Interview Questions & Model Answers

### Q1: How do you prevent a student learner from accessing unapproved candidate gigs?
> **Answer:** "Through multi-layered defense. First, candidate listings live in a dedicated staging table (`public.gig_candidates`), completely separate from the live directory (`public.gigs`). Second, PostgreSQL Row-Level Security on `public.gig_candidates` explicitly restricts `SELECT` to users where `public.is_admin() = true`. If an unauthenticated user or learner queries this table directly via PostgREST, PostgreSQL returns zero rows. Third, the `/api/candidates` endpoint verifies the caller's JWT against Supabase Auth and checks `public.profiles` for `role = 'admin'` before returning data."

### Q2: Why is the Supabase publishable key visible in the frontend, and is that a security risk?
> **Answer:** "No, that is by design. The `VITE_SUPABASE_ANON_KEY` is a publishable API key intended for browser clients. Supabase security does not rely on hiding the anon key; it relies on PostgreSQL Row-Level Security (RLS). The anon key allows the client to identify the project and communicate with Supabase Auth and PostgREST, but the database enforces RLS policies on every query. The secret service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is kept strictly server-side and is never bundled in frontend assets."

### Q3: How do you prevent CSV formula injection when exporting gigs?
> **Answer:** "When users open CSV files in Microsoft Excel or Google Sheets, cells starting with `=`, `+`, `-`, `@`, `|`, or `%` can be executed as spreadsheet macros or formulas. In `src/discovery/csvExport.js`, we run every string field through a sanitization function that detects formula triggers (including those preceded by whitespace or control characters) and prepends an apostrophe (`'`). We preserve legitimate negative numbers, and then apply standard RFC 4180 escaping (wrapping in double quotes and escaping inner quotes)."

### Q4: How does UpShift prevent SSRF attacks during automated web scraping?
> **Answer:** "When fetching external listings, an attacker could try to make our server request internal resources like `http://169.254.169.254` (cloud instance metadata) or `http://127.0.0.1:5432`. In `src/server/crawler.js`, our `validateSafeUrl` function parses the URL, performs a DNS lookup to resolve the host to an IP address, and verifies that the IP is not loopback, private RFC 1918, link-local, carrier-grade NAT, or cloud metadata. Furthermore, `safeFetch` disables automatic redirect following and validates each redirect destination before fetching, mitigating DNS-rebinding attacks."

### Q5: What happens if the network drops while loading user profile roles on login?
> **Answer:** "We follow a strict fail-closed pattern in `src/App.jsx`. When `loadProfile` executes, if the database query fails or encounters a network error, the role is assigned to `'learner'` and `roleVerified` is set to `false`. We never trust `localStorage` claims for admin access. Even if an attacker manually modifies `localStorage` to claim `admin`, the application fails closed to learner permissions, and the backend API independently validates the session against the database."

### Q6: What is the purpose of the Mandatory Referral Gate?
> **Answer:** "Certain student gigs are sourced through referral agreements where tracking IDs are required for students to get paid or verified. The referral gate (`REF-03` in `candidateStore.js`) enforces that if a candidate has `referral_required: true`, the publishing workflow blocks promotion to `public.gigs` unless both `referral_id` and `referral_url` are present. Any changes made to referral metadata during admin review are recorded in an audit array (`referral_history`) with timestamps and reviewer IDs."

### Q7: Why do you probe the URL before publishing a gig?
> **Answer:** "To prevent 'ghost gigs'—opportunities that were active when crawled, but filled or closed before an administrator reviewed them. The pre-publication reachability recheck (`PUB-02`) performs an asynchronous network probe right before writing to `public.gigs`. If the endpoint returns an HTTP 404, 410, or closure notice, the system blocks publication, updates the candidate's status to `Stopped`, and notifies the admin."

### Q8: How does the Daily Health Monitor work?
> **Answer:** "In `src/server/monitor.js`, the health monitor runs once daily (via GitHub Actions at 02:00 UTC, or via background daemon `scheduler.js`). It scans all active listings in `public.gigs`, probes each URL with conservative timeout and bot-challenge handling, and if a listing returns a permanent failure (404/410), it downgrades its status to `Stopped`. It also tracks source reliability in `sources.json`, flagging sources as `degraded` or `failing` if consecutive errors occur."

### Q9: How do database migrations prevent role tampering?
> **Answer:** "In migration `20261012000000_security_hardening.sql`, we create a PostgreSQL trigger function `trg_protect_profile_role` on `public.profiles`. If an `UPDATE` statement attempts to change the `role` column, the trigger executes `is_admin()`. If the caller is not an administrator, the trigger raises an exception and aborts the transaction. This guarantees that even if a learner tries to issue a direct SQL update through PostgREST, they cannot elevate their role."

### Q10: How do you verify that private keys never leak into the frontend bundle?
> **Answer:** "We enforce a pre-release security verification script (`scripts/verify_bundle_secrets.mjs`) that runs via `npm run verify:secrets`. The script analyzes all compiled JavaScript files in `dist/assets/` using regular expressions that match Supabase service-role keys, private keys, database connection strings, and provider API keys. If any private token is detected, the build pipeline fails with an exit code of 1."

---

## 12. Five Realistic Follow-Up Questions an Interviewer Might Ask

1. **"If the crawler processes thousands of listings simultaneously, how do you handle rate-limiting and avoid getting blocked by external job boards?"**
   *Answer:* `src/server/sources.js` maintains per-source rate limits (e.g., 10 to 60 requests per minute) and back-off delays. Crawlers respect `robots.txt`, set honest `User-Agent` headers, and use exponential backoff on HTTP 429 responses.
2. **"Why use Node.js built-in test runner instead of Jest or Vitest?"**
   *Answer:* Node.js native `node --test` requires zero dependencies, starts in milliseconds, executes tests in isolated worker threads, and avoids version conflicts with modern ESM imports. Our 293 tests complete in under 30 seconds.
3. **"How does the discovery job queue avoid race conditions when multiple worker instances are running in parallel?"**
   *Answer:* We use PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` inside `claim_discovery_job`. When a worker queries for a pending job, PostgreSQL locks the row and skips already-locked rows for other workers, ensuring each job is claimed by exactly one worker.
4. **"What happens if Supabase Auth is unavailable or goes down?"**
   *Answer:* The client UI displays an authentication error banner, and API endpoints fail closed (returning HTTP 401/500). Stored credentials are never processed by custom insecure fallbacks.
5. **"Why use Vanilla CSS instead of Tailwind or styled-components?"**
   *Answer:* Vanilla CSS keeps the dependency graph lightweight, avoids CSS-in-JS runtime performance overhead, ensures fast Vite builds, and gives full control over responsive design tokens and accessibility media queries.

---

## 13. Complicated Code Sections to Study Before the Interview

Review these specific code sections in detail:

1. **`src/server/crawler.js` (lines 35–120):**
   Study the IP address parsing, DNS resolution via `dns.promises.lookup`, and the custom redirect loop in `safeFetch`. Be ready to explain how it prevents DNS-rebinding attacks.
2. **`src/server/candidateApiHandler.js` (lines 74–140):**
   Study `verifyTokenAndRole`. Notice how it queries Supabase Auth, retrieves the role from `public.profiles`, and why it explicitly avoids trusting `user_metadata.role`.
3. **`src/discovery/csvExport.js` (lines 15–75):**
   Study `neutralizeFormulaInjection` and `escapeRFC4180Field`. Understand the regex that tests for `=`, `+`, `-`, `@`, `|`, `%` and why prepending an apostrophe prevents macro execution in spreadsheet software.
4. **`src/discovery/candidateStore.js` (lines 280–360):**
   Study `updateCandidate`. Understand how it detects a transition to `status = 'approved'`, runs the referral gate check, calls `probeUrlAvailability`, and conditionally updates either the staging table or the live gigs table.
