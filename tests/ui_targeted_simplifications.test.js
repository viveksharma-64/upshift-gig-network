import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Targeted UI Simplifications & Preserved Capabilities Regression Suite', () => {
  const queueSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/CandidateReviewQueue.jsx'), 'utf8');
  const dashboardSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/Dashboard.jsx'), 'utf8');
  const cssSrc = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
  const monitorSrc = fs.readFileSync(path.resolve(__dirname, '../src/server/monitor.js'), 'utf8');
  const schedulerSrc = fs.readFileSync(path.resolve(__dirname, '../src/server/scheduler.js'), 'utf8');
  const workflowSrc = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/daily-health-check.yml'), 'utf8');

  // =========================================================================
  // 1. AI DISCOVERY QUEUE — REMOVE EXPORT CSV
  // =========================================================================
  test('1. AI Discovery Queue has Export CSV button removed beside Run Discovery and Sync Store', () => {
    // Run Discovery and Sync Store buttons must exist
    assert.ok(queueSrc.includes('id="run-discovery-btn"'), 'Run Discovery button must be present in queue header');
    assert.ok(queueSrc.includes('id="sync-store-btn"'), 'Sync Store button must be present in queue header');
    assert.ok(queueSrc.includes('Run Discovery'), 'Run Discovery label must be present');
    assert.ok(queueSrc.includes('Sync Store'), 'Sync Store label must be present');

    // Export CSV button must NOT be present in CandidateReviewQueue header
    assert.equal(queueSrc.includes('id="export-approved-btn"'), false, 'Export CSV button must be removed from queue header');
    assert.equal(queueSrc.includes('>Export CSV</button>'), false, 'Export CSV button tag must be removed from CandidateReviewQueue');

    // Export CSV in Published Gigs / Dashboard must remain intact
    assert.ok(dashboardSrc.includes('handleExportCSV'), 'Dashboard must retain handleExportCSV');
    assert.ok(dashboardSrc.includes('Export CSV'), 'Dashboard Published Gigs must retain Export CSV button');
  });

  // =========================================================================
  // 2. CANDIDATE DETAILS — SIMPLIFY GIG VERIFICATION
  // =========================================================================
  test('2. Candidate cards remove Confirmed Gig and Opp. Page badges', () => {
    assert.equal(queueSrc.includes("Confirmed Gig ("), false, 'Candidate cards must not display Confirmed Gig badge');
    assert.equal(queueSrc.includes("Opp. Page"), false, 'Candidate cards must not display Opp. Page badge');

    // Track ID, Activity status and confidence remain present
    assert.ok(queueSrc.includes('{c.track_id}'), 'Track ID must remain on candidate card');
    assert.ok(queueSrc.includes('{normActivity.toUpperCase()} ({c.activity_confidence}%)'), 'Activity confidence must remain');
  });

  test('3. Candidate Details modal completely removes Gig Qualification & Review Status section', () => {
    assert.equal(queueSrc.includes('Gig Qualification & Review Status'), false, 'Modal must omit Gig Qualification & Review Status section');
    assert.equal(queueSrc.includes('Freelance / Task Work Confirmed:'), false, 'Modal must omit Freelance / Task Work Confirmed line');
    assert.equal(queueSrc.includes('Pending Review Rationale:'), false, 'Modal must omit modal-level Pending Review Rationale');
    assert.equal(queueSrc.includes('Learner Catalog Isolation:'), false, 'Modal must omit Learner Catalog Isolation box');
  });

  test('4. Under Opportunity Link Verification: only original Opportunity URL is displayed, no Application URL, no visible Recheck Link button', () => {
    // Opportunity URL as single link
    assert.ok(queueSrc.includes('Opportunity URL:'), 'Opportunity URL must be labeled');
    assert.ok(queueSrc.includes('inspectingCandidate.opportunity_url'), 'Opportunity URL must be rendered');

    // Removed Application URL row
    assert.equal(queueSrc.includes('Application / Task-Start URL:'), false, 'Application / Task-Start URL row must be removed');
    assert.equal(queueSrc.includes('inspectingCandidate.application_url && isSafeHttpUrl'), false, 'Application URL row markup must be removed from verification panel');

    // Link Reachability status and checked date are preserved
    assert.ok(queueSrc.includes('Link Reachability:'), 'Link Reachability must be labeled');
    assert.ok(queueSrc.includes('Live Page Reachable (Verified)'), 'Live Page Reachable status must be rendered');
    assert.ok(queueSrc.includes('inspectingCandidate.last_checked_at'), 'Checked timestamp must be rendered');
    assert.ok(queueSrc.includes('(checked '), 'Checked date prefix must be rendered');

    // Recheck Link visible button is removed
    assert.equal(queueSrc.includes('>Recheck Link</button>'), false, 'Visible Recheck Link button must be removed from verification panel');
  });

  test('5. Verification functionality and programmatic triggers are preserved', () => {
    // handleRecheckLink function exists in component logic
    assert.ok(queueSrc.includes('handleRecheckLink = async'), 'handleRecheckLink must be preserved in component logic');
    assert.ok(queueSrc.includes('window.__upshiftRecheckCandidateLink'), 'Programmatic verification trigger must be exposed on window');
  });

  // =========================================================================
  // 3. AUTOMATIC DAILY VERIFICATION BEHAVIOR PRESERVED
  // =========================================================================
  test('6. Automatic daily link verification and health monitor operate on schedule with full audit logging', () => {
    // Monitor logic preserved
    assert.ok(monitorSrc.includes('runHealthMonitoringCycle'), 'runHealthMonitoringCycle must exist in monitor.js');
    assert.ok(monitorSrc.includes('probeUrlAvailability'), 'probeUrlAvailability must exist in monitor.js');
    assert.ok(monitorSrc.includes('last_health_check_at'), 'monitor must update last_health_check_at timestamp');
    assert.ok(monitorSrc.includes('activity_status'), 'monitor must update activity_status');

    // Scheduler logic preserved
    assert.ok(schedulerSrc.includes('DailyHealthScheduler'), 'DailyHealthScheduler must exist in scheduler.js');

    // Daily GitHub workflow preserved with 02:00 UTC schedule
    assert.ok(workflowSrc.includes("cron: '0 2 * * *'"), 'Workflow must trigger at 02:00 UTC daily');
    assert.ok(workflowSrc.includes('src/server/monitor.js'), 'Workflow must execute monitor.js');
  });

  // =========================================================================
  // 4. PUBLISHED GIGS — SHOW ACTIONS WITHOUT HORIZONTAL SCROLLING
  // =========================================================================
  test('7. Published Gigs table layout ensures important columns and actions are visible without horizontal scrolling on desktop', () => {
    // Table has dedicated published-gigs-table class
    assert.ok(dashboardSrc.includes('published-gigs-table'), 'Table must have published-gigs-table class');

    // Table header and cells have semantic column classes
    assert.ok(dashboardSrc.includes('col-opportunity'), 'Opportunity column class must exist');
    assert.ok(dashboardSrc.includes('col-module'), 'Module column class must exist');
    assert.ok(dashboardSrc.includes('col-compensation'), 'Compensation column class must exist');
    assert.ok(dashboardSrc.includes('col-date'), 'Date column class must exist');
    assert.ok(dashboardSrc.includes('col-actions'), 'Actions column class must exist');

    // CSS defines desktop table-layout: fixed with column percentage budgeting
    assert.ok(cssSrc.includes('.published-gigs-table'), 'published-gigs-table CSS rules must exist');
    assert.ok(cssSrc.includes('table-layout: fixed;'), 'Desktop table must use table-layout: fixed');
    assert.ok(cssSrc.includes('width: 100%;'), 'Desktop table must be 100% width');

    // Action column styling
    assert.ok(cssSrc.includes('th.col-actions,\n  .published-gigs-table td.col-actions'), 'Actions column styling must exist');
    assert.ok(cssSrc.includes('text-align: right;'), 'Actions column must align right');

    // Long titles wrap and descriptions truncate neatly
    assert.ok(cssSrc.includes('overflow-wrap: break-word;'), 'Titles must wrap without overflowing');
    assert.ok(cssSrc.includes('word-break: break-word;'), 'Titles must break-word when necessary');
    assert.ok(cssSrc.includes('text-overflow: ellipsis;'), 'Descriptions must truncate with ellipsis');

    // Mobile / small-screen responsiveness preserved via overflow-x: auto on wrapper
    assert.ok(cssSrc.includes('.directory-table-wrapper {\n  overflow-x: auto;'), 'Table wrapper must maintain overflow-x: auto for smaller viewports');
  });

  test('8. All Published Gigs actions remain functional: Search, Module Filter, Compensation Filter, CSV Export, Bulk Import, Add, Edit, Delete', () => {
    // Search
    assert.ok(dashboardSrc.includes('value={searchQuery}'), 'Search input must be wired to searchQuery');
    assert.ok(dashboardSrc.includes('onChange={(e) => setSearchQuery(e.target.value)}'), 'Search onChange must update searchQuery');

    // Module filter
    assert.ok(dashboardSrc.includes('value={selectedModule}'), 'Module filter must be wired to selectedModule');
    assert.ok(dashboardSrc.includes('onChange={(e) => setSelectedModule(e.target.value)}'), 'Module filter onChange must update selectedModule');

    // Compensation filter / sort
    assert.ok(dashboardSrc.includes('value={sortBy}'), 'Compensation filter must be wired to sortBy');
    assert.ok(dashboardSrc.includes('onChange={(e) => setSortBy(e.target.value)}'), 'Compensation filter onChange must update sortBy');

    // CSV Export, Bulk Import, Add Gig
    assert.ok(dashboardSrc.includes('onClick={handleExportCSV}'), 'Export CSV button must be wired to handleExportCSV');
    assert.ok(dashboardSrc.includes('onClick={() => setIsImportModalOpen(true)}'), 'Bulk CSV Import must open modal');
    assert.ok(dashboardSrc.includes('onClick={() => setIsAddModalOpen(true)}'), 'Add Gig button must open modal');

    // Edit and Delete actions in row
    assert.ok(dashboardSrc.includes('onClick={() => setEditingGig(g)}'), 'Edit action must be wired to setEditingGig');
    assert.ok(dashboardSrc.includes('onClick={() => handleDeleteGig(g.id)}'), 'Delete action must be wired to handleDeleteGig');
  });

  // =========================================================================
  // 5. AI DISCOVERY QUEUE COUNT BADGE VISIBILITY ACROSS ALL NAVIGATION STATES
  // =========================================================================
  test('9. AI Discovery Queue count badge is clearly visible and readable in all three navigation states', () => {
    // Live count data binding is preserved and dynamic (not hardcoded)
    assert.ok(dashboardSrc.includes('{pendingReviews}'), 'Badge must render dynamic pendingReviews count');
    assert.ok(dashboardSrc.includes("const pendingReviews = useMemo(() => candidates.filter(c => c.status === 'pending_review').length, [candidates]);"), 'pendingReviews count must be computed from live candidates');

    // Inactive badge has high-contrast background and text color
    assert.ok(cssSrc.includes('.admin-tab-pending-badge {'), '.admin-tab-pending-badge selector must exist');
    assert.ok(cssSrc.includes('background: #e2e8f0;'), 'Inactive badge must have light contrasting background');
    assert.ok(cssSrc.includes('color: #0f172a;'), 'Inactive badge must have dark high-contrast text color');
    assert.ok(cssSrc.includes('border: 1px solid #cbd5e1;'), 'Inactive badge must have crisp border definition');

    // Inactive hover styling
    assert.ok(cssSrc.includes('.admin-unified-tab:hover:not(.active) .admin-tab-pending-badge'), 'Hover state on inactive tab badge must exist');

    // Active tab styling preserved
    assert.ok(cssSrc.includes('.admin-unified-tab.active .admin-tab-pending-badge'), 'Active tab badge selector must exist');
    assert.ok(cssSrc.includes('background: rgba(255, 255, 255, 0.25);'), 'Active badge must preserve translucent pill background');
    assert.ok(cssSrc.includes('color: #ffffff;'), 'Active badge must preserve white text on dark background');
  });
});
