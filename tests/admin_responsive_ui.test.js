import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Admin Responsive UI — Mobile, Tablet & Desktop Layouts', () => {
  const css = fs.readFileSync('./src/index.css', 'utf8');
  const dashboardSrc = fs.readFileSync('./src/pages/Dashboard.jsx', 'utf8');
  const queueSrc = fs.readFileSync('./src/pages/CandidateReviewQueue.jsx', 'utf8');

  // =========================================================================
  // 1. TOPBAR & ADMIN TOP NAVIGATION
  // =========================================================================
  test('1. Desktop topbar preserves 64px row layout with identical visual order and hidden hamburger', () => {
    // Base desktop topbar
    assert.ok(css.includes('.saas-topbar {'), 'Base .saas-topbar class must exist');
    assert.ok(css.includes('height: 64px;'), 'Desktop topbar must be 64px height');

    // Desktop order and contents
    assert.ok(css.includes('.admin-top-nav .saas-topbar-main-row {\n  display: contents;\n}'), '.saas-topbar-main-row must use display: contents on desktop');
    assert.ok(css.includes('.admin-top-nav .saas-topbar-left {\n  order: 1;'), 'saas-topbar-left must be order: 1');
    assert.ok(css.includes('.admin-top-nav .dashboard-unified-nav {\n  order: 2;'), 'dashboard-unified-nav must be order: 2');
    assert.ok(css.includes('.admin-top-nav .saas-topbar-right {\n  order: 3;'), 'saas-topbar-right must be order: 3');

    // Mobile controls hidden on desktop
    assert.ok(css.includes('.saas-mobile-toggle-btn {\n  display: none;'), 'Hamburger button must be display: none on desktop');
    assert.ok(css.includes('.saas-sidebar-close-btn {\n  display: none;'), 'Sidebar close button must be display: none on desktop');
  });

  test('2. Tablet & mobile topbar (<=1024px) expands to 2-row layout without cramped overlap', () => {
    const media1024 = css.slice(css.indexOf('@media (max-width: 1024px)'));
    assert.ok(media1024.includes('.saas-topbar.admin-top-nav {'), 'Responsive topbar rule must exist under 1024px');
    assert.ok(media1024.includes('height: auto;'), 'Topbar height must be auto on narrow screens');
    assert.ok(media1024.includes('flex-direction: column;'), 'Topbar must stack rows vertically');
    assert.ok(media1024.includes('.admin-top-nav .saas-mobile-toggle-btn {\n    display: inline-flex;'), 'Hamburger button must be visible on narrow screens');
    assert.ok(media1024.includes('.admin-top-nav .dashboard-unified-nav {'), 'Unified nav styling must exist under 1024px');
    assert.ok(media1024.includes('overflow-x: auto;'), 'Unified nav must scroll horizontally instead of wrapping/overlapping');
  });

  test('3. Topbar navigation items on phone (<=480px and <=360px) adapt gracefully', () => {
    const media480 = css.slice(css.indexOf('@media (max-width: 480px)'));
    assert.ok(media480.includes('.admin-top-nav {'), 'Responsive topbar rule must exist under 480px');
    assert.ok(media480.includes('.admin-top-nav .admin-header-title {'), 'Header title must scale down under 480px');

    const media360 = css.slice(css.indexOf('@media (max-width: 360px)'));
    assert.ok(media360.includes('.admin-top-nav .btn-admin-nav-text {\n    display: none;\n  }'), 'Sign out text must hide on <=360px to preserve icon-only button and prevent cramped overlap');
  });

  test('4. Dashboard.jsx header markup preserves accessible controls and tab IDs', () => {
    // Accessible hamburger
    assert.ok(dashboardSrc.includes('aria-label="Toggle Navigation Menu"'), 'Hamburger must have aria-label');
    assert.ok(dashboardSrc.includes('aria-expanded={mobileNavOpen}'), 'Hamburger must have aria-expanded');

    // Sidebar close button
    assert.ok(dashboardSrc.includes('className="saas-sidebar-close-btn"'), 'Sidebar close button must exist');
    assert.ok(dashboardSrc.includes('aria-label="Close Navigation Menu"'), 'Sidebar close button must have aria-label');

    // Unified tab IDs for test compatibility
    assert.ok(dashboardSrc.includes('id="tab-overview"'), 'tab-overview id must be preserved');
    assert.ok(dashboardSrc.includes('id="tab-published-gigs"'), 'tab-published-gigs id must be preserved');
    assert.ok(dashboardSrc.includes('id="tab-ai-discovery-queue"'), 'tab-ai-discovery-queue id must be preserved');

    // Sign out button
    assert.ok(dashboardSrc.includes('className="btn-admin-nav"'), 'btn-admin-nav class must be used');
    assert.ok(dashboardSrc.includes('btn-admin-nav-icon'), 'btn-admin-nav-icon must exist');
    assert.ok(dashboardSrc.includes('btn-admin-nav-text'), 'btn-admin-nav-text must exist');
  });

  // =========================================================================
  // 2. SIDEBAR DRAWER & SAFE AREAS
  // =========================================================================
  test('5. Sidebar drawer respects mobile safe areas and viewport bounds on narrow screens', () => {
    const media1024 = css.slice(css.indexOf('@media (max-width: 1024px)'));
    assert.ok(media1024.includes('.saas-sidebar {'), 'Sidebar rule must exist under 1024px');
    assert.ok(media1024.includes('width: min(290px, 85vw);'), 'Sidebar drawer must never exceed 85vw');
    assert.ok(media1024.includes('z-index: 999;'), 'Sidebar drawer must have high z-index above backdrop');
    assert.ok(media1024.includes('env(safe-area-inset-top)'), 'Sidebar drawer must respect safe-area-inset-top');
    assert.ok(media1024.includes('env(safe-area-inset-bottom)'), 'Sidebar drawer must respect safe-area-inset-bottom');
    assert.ok(media1024.includes('.saas-drawer-overlay.open {\n    display: block;\n  }'), 'Drawer backdrop overlay must display when open');
    assert.ok(dashboardSrc.includes('setMobileNavOpen(false)'), 'Clicking backdrop must close mobile drawer');
    assert.ok(dashboardSrc.includes("if (e.key === 'Escape') setMobileNavOpen(false);"), 'Keyboard Escape must close mobile drawer');
  });

  // =========================================================================
  // 3. OVERVIEW CARDS & STATISTICS
  // =========================================================================
  test('6. Overview cards and statistics collapse across 768px and 480px breakpoints', () => {
    assert.ok(css.includes('.overview-stats-grid {'), 'overview-stats-grid class must exist');
    const media768 = css.slice(css.indexOf('@media (max-width: 768px)'));
    assert.ok(media768.includes('.overview-stats-grid {\n    grid-template-columns: 1fr 1fr;'), 'overview-stats-grid must collapse to 2 columns on tablets (<=768px)');

    const media480 = css.slice(css.indexOf('@media (max-width: 480px)'));
    assert.ok(media480.includes('.overview-stats-grid {\n    grid-template-columns: 1fr;'), 'overview-stats-grid must collapse to 1 column on phones (<=480px)');
  });

  // =========================================================================
  // 4. PUBLISHED GIGS DIRECTORY & ACTIONS
  // =========================================================================
  test('7. Published Gigs directory header actions and table wrapper handle mobile widths cleanly', () => {
    assert.ok(css.includes('.directory-table-wrapper {\n  overflow-x: auto;'), 'Table wrapper must have overflow-x: auto to prevent page-level scroll');
    const media768 = css.slice(css.indexOf('@media (max-width: 768px)'));
    assert.ok(media768.includes('.directory-header-row {\n    flex-direction: column;'), 'Directory header row must stack vertically on <=768px');

    const media480 = css.slice(css.indexOf('@media (max-width: 480px)'));
    assert.ok(media480.includes('.directory-header-actions {\n    flex-direction: column;'), 'Directory header actions must stack vertically on <=480px');
    assert.ok(media480.includes('.directory-header-actions .btn-bulk-import,\n  .directory-header-actions .btn-add-gig {\n    width: 100%;'), 'Action buttons must expand to full width on phone screens');
  });

  // =========================================================================
  // 5. DISCOVERY QUEUE, FILTERS & CANDIDATE CARDS
  // =========================================================================
  test('8. Candidate Review Queue operational status, filters, and cards collapse on mobile', () => {
    // Filter controls stack vertically on <=768px
    const media768 = css.slice(css.indexOf('@media (max-width: 768px)'));
    assert.ok(media768.includes('.discovery-filter-bar {\n    flex-direction: column;'), 'Filter bar must stack vertically on narrow screens');
    assert.ok(media768.includes('.discovery-search-input,\n  .discovery-filter-select {\n    width: 100%;'), 'Filter inputs must take full width on narrow screens');

    // Candidate cards collapse to 1 column
    assert.ok(media768.includes('.candidate-cards-grid {\n    grid-template-columns: 1fr;'), 'Candidate cards must collapse to 1 column on <=768px');

    // Operational schedule status grid collapses to 1 column
    assert.ok(media768.includes('.operational-status-grid {\n    grid-template-columns: 1fr !important;'), 'Operational status grid must collapse to 1 column on <=768px');

    // Candidate card footer actions wrap cleanly on <=480px
    const media480 = css.slice(css.indexOf('@media (max-width: 480px)'));
    assert.ok(media480.includes('.candidate-card-footer {\n    flex-direction: column;'), 'Card footer must stack vertically on phone screens');
    assert.ok(media480.includes('.btn-inspect-edit {\n    width: 100%;'), 'Inspect & Edit button must take full width on phone screens');
    assert.ok(media480.includes('.candidate-card-state-btns {\n    display: grid;\n    grid-template-columns: repeat(2, 1fr);'), 'State buttons must form a clean 2-column touch grid on phones');
  });

  // =========================================================================
  // 6. MODALS & DIALOGS RESPONSIVENESS
  // =========================================================================
  test('9. Modals and candidate review dialogs fit mobile viewports and respect safe areas', () => {
    assert.ok(css.includes('.modal-overlay {'), 'modal-overlay rule must exist');
    assert.ok(css.includes('env(safe-area-inset-top)'), 'Modal overlay must respect safe-area-inset-top');

    const media640 = css.slice(css.indexOf('@media (max-width: 640px)'));
    assert.ok(media640.includes('.modal-card {\n    padding: 20px 16px;'), 'Modal card padding must adapt on mobile');
    assert.ok(media640.includes('.candidate-modal-grid-2 {\n    grid-template-columns: 1fr;'), 'Modal 2-column grid must collapse to 1fr on mobile');
    assert.ok(media640.includes('.candidate-referral-grid {\n    grid-template-columns: 1fr;'), 'Referral grid must collapse to 1fr on mobile');
    assert.ok(media640.includes('.candidate-score-grid {\n    grid-template-columns: repeat(2, 1fr);'), 'Score cards must collapse to 2 columns on mobile');
    assert.ok(media640.includes('.candidate-modal-footer {\n    flex-direction: column;'), 'Modal footer actions must stack vertically on mobile');
  });

  // =========================================================================
  // 7. LEARNER PORTAL NON-REGRESSION
  // =========================================================================
  test('10. Learner styling rules remain intact and unmutated', () => {
    assert.ok(css.includes('.learner-nav {'), 'learner-nav must remain preserved');
    assert.ok(css.includes('.learner-hero-banner {'), 'learner-hero-banner must remain preserved');
    assert.ok(css.includes('.learner-opps-grid {'), 'learner-opps-grid must remain preserved');
    assert.ok(css.includes('.learner-opp-card {'), 'learner-opp-card must remain preserved');
    assert.ok(dashboardSrc.includes('LearnerDashboard'), 'LearnerDashboard component must remain preserved');
  });

  // =========================================================================
  // 8. FOCUSED BREAKPOINT VERIFICATION (320px, 360px, 390px, 430px, 768px, 1440px)
  // =========================================================================
  test('11. 320px Viewport (Ultra-Compact Phone): compact title, icon-only sign out, and full drawer access', () => {
    // Media query <= 360px applies to 320px
    const media360 = css.slice(css.indexOf('@media (max-width: 360px)'));
    assert.ok(media360.includes('.admin-top-nav .btn-admin-nav-text {\n    display: none;\n  }'), '320px must hide sign-out text to prevent cramped overlap');

    // Media query <= 480px applies to 320px
    const media480 = css.slice(css.indexOf('@media (max-width: 480px)'));
    assert.ok(media480.includes('.admin-top-nav .admin-header-title-full {\n    display: none;\n  }'), '320px must hide full title');
    assert.ok(media480.includes('.admin-top-nav .admin-header-title-compact {\n    display: inline;\n  }'), '320px must display compact title');

    // Drawer options accessible on 320px
    assert.ok(dashboardSrc.includes('id="drawer-tab-overview"'), 'Overview accessible in drawer');
    assert.ok(dashboardSrc.includes('id="drawer-tab-published-gigs"'), 'Published Gigs accessible in drawer');
    assert.ok(dashboardSrc.includes('id="drawer-tab-ai-discovery-queue"'), 'AI Discovery Queue accessible in drawer');
  });

  test('12. 360px Viewport (Standard Compact Phone): unclipped navigation with scroll affordance & trailing spacer', () => {
    const media1024 = css.slice(css.indexOf('@media (max-width: 1024px)'));
    assert.ok(media1024.includes('scrollbar-width: thin;'), 'Must have thin scrollbar affordance');
    assert.ok(media1024.includes('.admin-top-nav .dashboard-unified-nav::-webkit-scrollbar {\n    height: 4px;\n    display: block;\n  }'), 'Must have 4px visible scrollbar for WebKit');
    assert.ok(media1024.includes('.admin-top-nav .dashboard-unified-nav::after {\n    content: \'\';\n    display: block;\n    flex: 0 0 16px;'), 'Must have 16px trailing flex spacer so last button is never clipped against viewport edge');
    assert.ok(media1024.includes('scroll-snap-type: x proximity;'), 'Must support scroll snap on horizontal nav');
    assert.ok(dashboardSrc.includes('adminNavTabsRef'), 'adminNavTabsRef must exist to auto-scroll active tab into view');
    assert.ok(dashboardSrc.includes('scrollIntoView'), 'Must scroll active tab into view automatically');
  });

  test('13. 390px Viewport (Standard iPhone): readable tab labels without unreadable shrinking', () => {
    const media480 = css.slice(css.indexOf('@media (max-width: 480px)'));
    assert.ok(media480.includes('.admin-unified-tab {\n    padding: 6px 10px;\n    font-size: 12px;\n  }'), 'Tab labels must maintain readable 12px font size on 390px');
    assert.ok(dashboardSrc.includes('data-testid="tab-overview"'), 'Overview tab accessible');
    assert.ok(dashboardSrc.includes('data-testid="tab-published-gigs"'), 'Published Gigs tab accessible');
    assert.ok(dashboardSrc.includes('data-testid="tab-ai-discovery-queue"'), 'AI Discovery Queue tab accessible');
  });

  test('14. 430px Viewport (Large Phone): space-between header row prevents overlap without horizontal overflow', () => {
    assert.ok(css.includes('.admin-top-nav .saas-topbar-main-row {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;'), 'Header row must use space-between flexbox');
    assert.ok(css.includes('.saas-admin-shell {\n  display: flex;\n  min-height: 100vh;\n  min-height: 100dvh;\n  background-color: var(--saas-bg);\n  color: var(--saas-text-body);\n  width: 100%;\n  max-width: 100vw;\n  overflow-x: hidden;\n  position: relative;\n}'), 'Page shell must have overflow-x: hidden to prevent horizontal page overflow');
  });

  test('15. 768px Viewport (Tablet Portrait): 2-row layout with full title, hamburger, and spacious tab row', () => {
    const media1024 = css.slice(css.indexOf('@media (max-width: 1024px)'));
    assert.ok(media1024.includes('.saas-topbar.admin-top-nav {\n    height: auto;'), 'Tablet must use auto-height topbar');
    assert.ok(media1024.includes('flex-direction: column;'), 'Tablet topbar must stack into 2 rows');
    assert.ok(media1024.includes('.admin-top-nav .saas-mobile-toggle-btn {\n    display: inline-flex;'), 'Hamburger must be visible on tablet');
    assert.ok(css.includes('.admin-header-title-full {\n  display: inline;\n}'), 'Full title must be displayed on tablet (>480px)');
  });

  test('16. 1440px Viewport (Desktop Widescreen): single 64px row with exact visual order and hidden mobile controls', () => {
    assert.ok(css.includes('.saas-topbar {\n  height: 64px;'), 'Desktop topbar must be 64px height');
    assert.ok(css.includes('.admin-top-nav .saas-topbar-main-row {\n  display: contents;\n}'), 'Main row must use display: contents on desktop');
    assert.ok(css.includes('.admin-top-nav .saas-topbar-left {\n  order: 1;'), 'Left section order: 1');
    assert.ok(css.includes('.admin-top-nav .dashboard-unified-nav {\n  order: 2;'), 'Unified nav order: 2');
    assert.ok(css.includes('.admin-top-nav .saas-topbar-right {\n  order: 3;'), 'Right section order: 3');
    assert.ok(css.includes('.saas-mobile-toggle-btn {\n  display: none;'), 'Hamburger must be hidden on desktop');
  });
});
