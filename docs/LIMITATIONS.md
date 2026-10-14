# UpShift AI Gig Discovery Engine — Known Limitations & Future Improvements

> **Document Version:** 1.0  
> **FRD Reference:** FRD v1.0 Section 26 (Deliverable #48)  
> **Status:** Verified Active Assessment  

---

## 1. Overview

In accordance with FRD compliance boundaries and the principle of **truth in engineering**, this document transparently records confirmed operating boundaries, environment constraints, and planned architectural evolutions.

---

## 2. Confirmed Limitations in Development Environment

### 2.1. External Crawler Resilience & Anti-Bot Protections
- **Current Behavior:** The engine ingests from public endpoints (e.g. Arbeitnow JSON API, We Work Remotely RSS feeds) and respects `robots.txt` and polite rate limits (10–60 RPM).
- **Limitation:** Sites utilizing active JavaScript challenges (Cloudflare Turnstile, PerimeterX) cannot be scraped without headless browser sidecars or proxy networks.
- **Mitigation:** The architecture gracefully isolates external failures via `SourceRegistry` health tracking (`SRC-05`), downgrading failing sources to `degraded`/`failing` without corrupting existing records or crashing worker processes.

### 2.2. Dual-Mode Storage Synchronization
- **Current Behavior:** The system supports both PostgreSQL Supabase persistent storage (`public.gig_candidates`) and local fallback persistence (`data/candidates.json` + `localStorage`).
- **Limitation:** When running the Vite frontend without a live Supabase network connection, UI state operates on local cached discovery queues. Changes are queued and synced to server endpoints when connectivity resumes.

### 2.3. Scheduled Cron Monitoring in Standalone Development
- **Current Behavior:** The health monitor (`src/server/monitor.js`) and ingestion worker (`src/server/worker.js`) are executable via Node CLI scripts (`npm run monitor:health`, `npm run worker:discover`).
- **Limitation:** In a standalone workstation environment, tasks run on-demand or via local process execution rather than managed cloud schedulers (e.g. AWS EventBridge, Temporal, or Google Cloud Scheduler).

### 2.4. Optional AI LLM Provider Fallback
- **Current Behavior:** The pipeline supports Gemini and secondary LLM providers for natural language reasoning. When API keys are absent or exhausted, the system automatically falls back to the high-accuracy deterministic classifier (`classifyActivityDeterministic`) and rule-based module matcher.
- **Limitation:** Nuanced contextual ambiguities in listings without structured text require admin review (`Needs Review`) rather than full autonomous resolution.

---

## 3. High-Priority Future Enhancements

1. **Distributed Cloud Worker Deployment:** Containerize worker and health monitor into Dockerized ECS / Cloud Run microservices triggered on cron schedules.
2. **Real-time Webhook Ingestion:** Implement inbound webhook receivers for partner platforms to push opportunities instantaneously instead of polling.
3. **Multi-Agent Quality Scoring:** Integrate secondary LLM consensus voting for borderline module assignments (e.g. M4 Coding vs. M6 Automation overlap).
4. **Automated Dead-Link Web Archive Verification:** Query Wayback Machine or cache servers when listings return transient 5xx errors to confirm permanent versus temporary removal.
