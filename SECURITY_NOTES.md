# UpShift Security Verification Notes

## Verification Record: `public.gig_candidates` Staging Isolation

- **Verification Date**: 2026-10-13
- **Target Table**: `public.gig_candidates`
- **Scope**: Candidate staging table access control and learner read path isolation

---

### 1. Live Database Permissions & RLS Configuration

- **Row-Level Security (RLS)**: Enabled (`relrowsecurity = true`).
- **Table Owner**: `postgres`.
- **Active Policy**: `"Admins have full access to gig_candidates"` enforcing `public.is_admin()` on both `USING` and `WITH CHECK`.
- **Table-Level Privileges**:
  - `anon`: Revoked all privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`).
  - `authenticated`: Granted `SELECT`, `INSERT`, `UPDATE` only. `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` are strictly revoked.
  - `service_role`: Full worker table access preserved; retains PostgreSQL `BYPASSRLS`.
- **Column-Level Privileges**: Explicit column ACL overrides revoked from `anon` and `PUBLIC`.

---

### 2. Live REST API Test Results

#### A. Unauthenticated (`anon`) Probes
- **Live Endpoint**: `POST /rest/v1/gig_candidates`, `GET /rest/v1/gig_candidates?select=*`
- **Result**: HTTP 401 Unauthorized
- **Database Engine Response**:
  ```json
  {
    "code": "42501",
    "details": null,
    "hint": "Grant the required privileges to the current role...",
    "message": "permission denied for table gig_candidates"
  }
  ```
- **Finding**: Unauthenticated callers are completely denied table access by PostgreSQL engine permission checks before RLS evaluation.

#### B. Authenticated Learner Read Path Probe
- **Live Endpoint**: `GET /rest/v1/gig_candidates?select=*`
- **Caller Context**: Valid authenticated learner session token (`profile.role = 'learner'`).
- **Result**: HTTP 200 OK
- **Response Payload**: `[]` (empty array, zero records returned).
- **Finding**: The learner read path is verified. PostgreSQL Row-Level Security evaluates `public.is_admin()` to `false` for non-admin accounts, filtering all candidate records so no staging data is exposed to learners.

---

### 3. Automated Regression Verification

- **Test Suite**: `tests/discovery_engine.test.js`
- **Results**: 54 automated tests across 12 suites passing (`npm test`).
  - Suite 8: Approval Gateway blocks learner candidate publication.
  - Suite 9: Server API `/api/candidates` enforces token verification, rejects browser-supplied role headers, and returns HTTP 403 to non-admins.
  - Suite 12: Supabase Candidate Repository enforces RLS boundaries (0 rows returned to learners; learner insert/update rejected with RLS violation; learner/admin delete blocked with permission denied).
- **Bundle & Secret Scan**: `npm run build` and `npm run verify:secrets` passing with zero secret leaks.

---

### 4. Live End-to-End Learner Smoke Test Verification

- **Test Date**: 2026-10-13
- **Execution**: Live application smoke test conducted against dev server (`http://localhost:5174/`) and live Supabase instance.
- **Results**: All 6 checks passed successfully.

| # | Smoke Test Check | Result | Verification Detail |
|---|---|:---:|---|
| 1 | Learner Sign-In | **PASS** | Successfully authenticated via Learner tab; database profile loaded; session persisted cleanly in `localStorage`. |
| 2 | Learner Dashboard Load | **PASS** | Dashboard rendered at `/dashboard`; "Commercial Opportunity Board" loaded active briefs without errors. |
| 3 | Gig Discovery & Application Flows | **PASS** | Real-time text search, M1–M6 track filtering, discovery pills, and detail modal functioned as expected; outbound gateway links routed properly. |
| 4 | Admin Route Access Barrier | **PASS** | Navigating to `/admin` while signed in as learner immediately rendered the "Access Denied" barrier; admin dashboard and `CandidateReviewQueue` remained unmounted. |
| 5 | Browser Console & Network | **PASS** | Console clean with zero unhandled errors or warnings; network panel confirmed zero requests or leaks to `gig_candidates`. |
| 6 | Automated Regression & Build | **PASS** | 54/54 tests passing; production bundle compiled cleanly in 5.02s; secret scan confirmed 0 leaks. |

---

### 5. Final Authorization Review: Learner vs Admin Matrix

#### A. Client-Side & Component Boundaries
- **Route Guard**: `<ProtectedRoute requiredRole="admin">` authoritatively derives user role from `public.profiles` (falling back safely to `learner`). Rejects non-admin users with an explicit inline access barrier.
- **Component Isolation**: `CandidateReviewQueue` is exclusively imported and rendered inside `AdminDashboard`. It is never loaded or rendered in `LearnerDashboard`.
- **Role Switching**: If an authenticated learner attempts to sign in via the Admin login tab, the session is cleared (`signOut()`) and denied immediately.

#### B. Supabase Row-Level Security & Table Grants
- **`public.profiles`**:
  - `RLS`: Enabled. Users can only select/update their own profile (`auth.uid() = id`), or admins view all.
  - `Role Escalation Protection`: `protect_profile_role` trigger rejects any UPDATE modifying `role` unless `public.is_admin()` is true.
  - `Signup Role Default`: `handle_new_user` trigger strictly defaults all new signups to `'learner'`.
- **`public.gigs`**:
  - `RLS`: Enabled. SELECT permitted for active gigs (`status = 'Active' or is_admin()`).
  - `Mutations`: INSERT, UPDATE, DELETE strictly restricted to `is_admin()`.
- **`public.gig_candidates`**:
  - `RLS`: Enabled. Policy `"Admins have full access to gig_candidates"` restricts all operations to `is_admin()`.
  - `anon`: All privileges revoked (`42501 permission denied`).
  - `authenticated`: Table grants limited to `SELECT`, `INSERT`, `UPDATE`; `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` strictly revoked. Under RLS, non-admins receive `[]` (0 rows exposed).
  - `service_role`: Full worker pipeline access preserved.

#### C. Server Secrets Isolation
- **Environment Separation**: Server secrets (`DATABASE_URL`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are not prefixed with `VITE_` and are never loaded by the client bundle.
- **Client Bundle**: Client bundle contains only public configuration (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- **Secret Scanner**: Automated build verifier (`scripts/verify_bundle_secrets.mjs`) scans `dist/` and validates zero server keys or connection strings exist in production assets.

---

### 6. Certification Boundary & Audit Scope Notice

> [!NOTE]
> **Audit Scope & Non-Certified Boundary**:
> - **Verified**: Learner read path isolation on `public.gig_candidates`, role enforcement in `public.profiles` and `public.gigs`, client-side route protection, bundle secret absence, and live learner application smoke flows.
> - **Not Certified / Out of Scope**: This review covers only the specified authorization and staging boundaries. It does not certify the application against DDoS attacks, third-party dependency vulnerabilities (e.g. npm audit items), network-level infrastructure, physical infrastructure, or external OAuth provider compromises. Database permissions and RLS policies must remain strictly preserved.

---

### 7. FRD v1.0 Compliance & Safety Gate Verification (2026-10-13)

| Security Control | Implementation Mechanism | Verification Result |
| :--- | :--- | :--- |
| **Mandatory Referral Publishing Gate** | `validateForPublishing()` blocks candidate promotion when `referral_required: true` without referral ID/link (`REF-03`) | **PASS** (Scenario T12 verified) |
| **Pre-Publication Live Availability Verification** | Automated network reachability probe immediately prior to insertion into `public.gigs` (`PUB-02`, `VER-08`) | **PASS** (Scenario T11 verified; HTTP 404 sets `Stopped`) |
| **Approval Isolation** | Unapproved candidates (pending, rejected, duplicate, paused, stopped) strictly prevented from publishing | **PASS** (Scenarios T05, T06, T10 verified) |
| **Deduplication & Provenance Across All Stages** | Multi-tier duplicate checks (ext ID, canonical URL, content similarity, cross-source flags), concurrency locking, and in-place daily re-verification updates | **PASS** (10/10 deduplication lifecycle scenarios verified; `deduplication_lifecycle.test.js`) |
| **Truth in Advertising (Anti-Hallucination)** | Zero fabrication of missing compensation or dates; preserves null/unspecified | **PASS** (Scenarios T07, T08 verified) |
| **Automated Daily Re-verification Scheduler** | 24h background daemon with mutex overlap protection, retries, and audit logging (`npm run monitor:daemon`) | **PASS** (7/7 scheduler scenarios verified; `tests/scheduler.test.js`) |
| **Full Automated Verification Suite** | 88/88 unit, integration, RLS, and FRD minimum scenarios passing across 15 test suites | **PASS** (`npm test` 88 passed, 0 failed) |


