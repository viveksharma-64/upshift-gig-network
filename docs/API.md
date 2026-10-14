# UpShift AI Gig Discovery Engine — API & Interface Contracts

> **Document Version:** 1.0  
> **FRD Reference:** FRD v1.0 Section 20, 26 (Deliverable #44)  

---

## 1. REST API Endpoints

### 1.1. `GET /api/candidates`
Retrieves discovery candidates from the staging store.

- **Authentication:** Required (`Authorization: Bearer <access_token>`).
- **Authorization:** Admin only (`role: 'admin'`). Non-admin or anonymous requests fail closed (`401 Unauthorized` or `403 Forbidden`).
- **Query Parameters:**
  - `status` *(optional, string)*: Filter by review status (`pending_review`, `approved`, `rejected`, `duplicate`, `paused`, `stopped`, `needs_recheck`, `all`).
  - `track_id` *(optional, string)*: Filter by module (`M1`, `M2`, `M3`, `M4`, `M5`, `M6`).
  - `activity_status` *(optional, string)*: Filter by activity state (`Active`, `Paused`, `Stopped`, `Needs Review`).
  - `sort` *(optional, string)*: Sort order (`priority`, `confidence`, `completeness`, `newest`). Default: `priority`.
- **Response Format (200 OK):**
```json
[
  {
    "id": "cand_sample_001",
    "external_gig_id": "EXT-SAMPLE-0001",
    "source_name": "Remotive AI",
    "source_type": "api",
    "title": "Short-form Reels Producer - Apex Creative Studio",
    "organization": "Apex Creative Studio",
    "location": "Remote (Worldwide)",
    "work_arrangement": "remote",
    "payment_amount": "$25 - $40 / hour",
    "min_amount": 25,
    "max_amount": 40,
    "currency": "USD",
    "compensation_type": "hourly",
    "track_id": "M1",
    "matched_modules": ["M1"],
    "module_fit_scores": { "M1": 85 },
    "activity_status": "Active",
    "activity_confidence": 80,
    "activity_evidence": [
      "HTTP 200 verification confirmed.",
      "Clear application flow and active hiring posting."
    ],
    "review_priority": 98,
    "data_completeness": 85,
    "is_duplicate": false,
    "referral_required": false,
    "referral_id": null,
    "referral_url": null,
    "status": "pending_review",
    "application_url": "https://jobs.example.com/view/1?src=upshift",
    "original_url": "https://jobs.example.com/view/1"
  }
]
```

---

### 1.2. `POST /api/candidates`
Updates candidate review state, logs admin notes, modifies module assignment, configures referrals, or changes status.

- **Authentication:** Required (`Authorization: Bearer <access_token>`).
- **Authorization:** Admin only.
- **Request Body:** Partial or complete candidate object.
- **Permitted Mutations:**
  - Status transitions (`status`): Subject to `isValidStatusTransition()` matrix.
  - Reviewer controls: Pause (`status: 'paused'`, `activity_status: 'Paused'`), Stop (`status: 'stopped'`, `activity_status: 'Stopped'`), Resume (`status: 'pending_review'`).
  - Referral setup: `referral_required` *(boolean)*, `referral_id` *(string)*, `referral_url` *(string)*. Automatically appends audit record to `referral_history`.
  - Module override: `track_id` (`M1`–`M6`).
- **Error Responses:**
  - `400 Bad Request`: Invalid lifecycle transition or malformed payload.
  - `401 Unauthorized`: Missing or invalid session token.
  - `403 Forbidden`: Authenticated user lacks `admin` privileges.

---

## 2. Programmatic CLI & Worker Interfaces

### 2.1. Discovery Worker (`npm run worker:discover`)
Runs a crawler ingestion cycle from permitted external sources into the staging repository.

- **CLI Usage:**
  ```bash
  npm run worker:discover
  # With options
  node src/server/worker.js --provider=arbeitnow --max=50
  ```
- **Programmatic API:**
  ```javascript
  import { DiscoveryPipeline } from './src/server/pipeline.js';
  import { defaultCandidateRepository } from './src/server/candidateRepository.js';

  const pipeline = new DiscoveryPipeline({
    repository: defaultCandidateRepository,
    rateLimitPerMinute: 30
  });

  const results = await pipeline.runIngestionCycle();
  // returns: { processed: number, inserted: number, duplicates: number, errors: [] }
  ```

---

### 2.2. Daily Health Monitor (`npm run monitor:health`)
Executes automated health checks on existing candidates and external sources.

- **CLI Usage:**
  ```bash
  npm run monitor:health
  ```
- **Programmatic API:**
  ```javascript
  import { runHealthMonitoringCycle } from './src/server/monitor.js';

  const summary = await runHealthMonitoringCycle({
    maxCheck: 50,
    dryRun: false
  });
  // returns: { candidates_checked, candidates_healthy, candidates_stopped, sources_checked, ... }
  ```

---

## 3. Notification Dispatcher Events (`src/server/notifications.js`)

| Event Constant | Key | Description | Guard Rule |
| :--- | :--- | :--- | :--- |
| `OPPORTUNITY_PUBLISHED` | `opportunity.published` | Dispatched when candidate is approved and published to live gigs | **NOT-03**: Strictly blocked if candidate is unapproved or stopped |
| `PUBLICATION_FAILED` | `opportunity.publish_failed` | Dispatched if approval, referral gate, or pre-publish check fails | Identifies candidate ID and failure reason |
| `HEALTH_STATUS_CHANGED` | `opportunity.health_status_changed` | Dispatched when monitor detects closed listing and sets to `Stopped` | Surfaces closed/removed opportunity |
| `SOURCE_FAILURE` | `source.failure` | Dispatched when external source encounters >= 3 consecutive errors | Records source degradation |

---

## 4. 19-Column CSV Contract (`src/discovery/csvExport.js`)

- **Export Function:** `exportGigsTo19ColCSV(gigs, { filterApproved: true })`
- **Output Standards:** RFC 4180 escaping (commas, quotes `""`, and CRLF newlines).
- **Exact Column Order (19 Columns):**
  1. `external_gig_id`
  2. `title`
  3. `track_id`
  4. `payment_amount`
  5. `compensation_type`
  6. `min_amount`
  7. `max_amount`
  8. `currency`
  9. `priority`
  10. `is_featured`
  11. `is_local_business`
  12. `posted_at`
  13. `origin_url`
  14. `short_description`
  15. `overview`
  16. `responsibilities`
  17. `deliverables`
  18. `requirements`
  19. `proof_spec`
