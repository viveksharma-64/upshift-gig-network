# UpShift — AI Gig Discovery Engine & Student Opportunity Platform

> **FRD Specification:** FRD v1.0 Compliant Implementation  
> **Development Target:** Standalone Isolated Development System  
> **Test Status:** 189/189 Automated Tests Passing across 28 suites (100%) | Build Passing | Secrets Scan Passing  

---

## 1. Project Overview

UpShift bridges learners with verified, paid micro-gigs across six targeted tracks (**M1–M6**). The **AI Gig Discovery Engine** continuously aggregates opportunities from permitted external job boards, RSS feeds, and APIs, classifies them into track modules, verifies real-world availability, isolates unapproved listings in a secure staging queue (`public.gig_candidates`), and enforces human administrator approval with mandatory referral validation before publishing to the live learner directory (`public.gigs`).

---

## 2. Quick Start & Setup

### 2.1. Prerequisites
- **Node.js:** v20+ recommended
- **Environment:** Isolated development environment (`.env`)

### 2.2. Installation & Running
```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables (copy from .env.example)
# Note: Keep all service role keys server-side only!
cp .env.example .env

# 3. Start development server
npm run dev

# 4. Access local portal:
# Learner Portal: http://localhost:5173/dashboard
# Admin Discovery Queue: http://localhost:5173/admin
```

---

## 3. CLI Commands & Worker Tasks

| Command | Purpose | FRD Reference |
| :--- | :--- | :--- |
| `npm run dev` | Starts Vite local development server | Dev Environment |
| `npm test` | Runs the full 189-test automated verification suite across 28 test suites | Section 28, 33 |
| `npm run build` | Compiles production assets with strict bundle verification | Quality Gate |
| `npm run verify:secrets` | Scans production bundle assets for leaked secrets or private keys | SEC-04 |
| `npm run worker:discover` | Runs crawler/API ingestion cycle into staging repository | Section 19 |
| `npm run monitor:health` | Runs single-pass daily health monitor; checks active opportunities & sources | Section 21, PUB-05 |
| `npm run monitor:daemon` | Starts automated 24h background health monitor daemon with overlap protection & retries | Section 11, 21 |

---

## 4. Key Architectural Deliverables & Documentation

- 🏆 **Final FRD Compliance Report:** [`docs/FINAL_FRD_COMPLIANCE_REPORT.md`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/docs/FINAL_FRD_COMPLIANCE_REPORT.md) (Consolidated final milestone report)
- 📋 **FRD Compliance & Deduplication Matrix:** [`docs/FRD_COMPLIANCE_MATRIX.md`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/docs/FRD_COMPLIANCE_MATRIX.md) (Clause-by-clause audit)
- 📐 **Architecture & Component Diagram:** [`docs/ARCHITECTURE.md`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/docs/ARCHITECTURE.md) (Mermaid workflow, 7 lifecycle subsystems)
- 🗄️ **Database Schema & ERD:** [`docs/DATABASE_ERD.md`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/docs/DATABASE_ERD.md) (Mermaid entity-relationship diagram, staging vs. live tables)
- 🔌 **API & Interface Specifications:** [`docs/API.md`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/docs/API.md) (`/api/candidates`, workers, notification events)
- ⚠️ **Known Limitations & Future Scope:** [`docs/LIMITATIONS.md`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/docs/LIMITATIONS.md) (Technical constraints & planned enhancements)
- 🛡️ **Security Audit & RLS Verification:** [`SECURITY_NOTES.md`](file:///c:/Users/vivek/OneDrive/Desktop/gigs%20project/upshift/SECURITY_NOTES.md) (Confirmed learner isolation evidence)

---

## 5. Core Feature Highlights

### 5.1. Exact 19-Column RFC 4180 CSV Export
- Fully implements FRD Section 18 & Data Contract.
- Export buttons available in both the Admin Dashboard and the Discovery Queue.
- Exports only approved/published opportunities in the required order with RFC 4180 escaping.

### 5.2. Mandatory Referral Gate & Audit Trail (`REF-03`, `REV-07`)
- When `referral_required: true`, publication to live gigs is strictly blocked if `referral_id` or `referral_url` is missing.
- Every reviewer modification to referral parameters is automatically captured in `referral_history` with timestamp and editor ID.

### 5.3. Canonical Activity States & Reviewer Controls
- Standardizes statuses to **Active**, **Paused**, **Stopped**, and **Needs Review**.
- Reviewers have explicit **Pause**, **Stop**, and **Resume** controls on candidate inspection modals and cards.

### 5.4. Pre-Publication Live Reachability Verification (`PUB-02`, `VER-08`)
- Immediately before copying any candidate to `public.gigs`, the engine probes the live URL. If HTTP 404, 410, or closure notice is encountered, publication is blocked and the candidate is marked `Stopped`.

### 5.5. Source Registry & Resilience (`SRC-01`–`SRC-05`)
- Pre-registers approved sources (Arbeitnow, Remotive, We Work Remotely, Hugging Face, Devpost, Kaggle).
- Automatically tracks health status (`healthy`, `degraded`, `failing`), logs errors, and emits notifications without corrupting the store.
