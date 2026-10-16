/**
 * Unit Test Suite: Admin Sidebar Layout & Stationary Scrolling
 *
 * Verifies:
 * 1. Desktop shell has fixed viewport height (100dvh/100vh) and overflow: hidden.
 * 2. Left sidebar has fixed width, 100dvh/100vh height, flex column layout.
 * 3. Sidebar navigation has flex: 1 and overflow-y: auto for independent scrolling.
 * 4. User profile / sign-out footer has margin-top: auto, pinning it at the bottom.
 * 5. Main content wrapper has flex: 1, min-width: 0, min-height: 0, and overflow-y: auto.
 * 6. Body scrolling is prevented when desktop admin layout is active.
 * 7. Mobile drawer layout is preserved for tablet/mobile viewports.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Admin Dashboard Layout — Stationary Sidebar & Independent Main Scroll', () => {
  const css = fs.readFileSync(path.resolve('./src/index.css'), 'utf8');
  const dashboardSrc = fs.readFileSync(path.resolve('./src/pages/Dashboard.jsx'), 'utf8');

  test('1. Desktop shell enforces viewport height and overflow: hidden', () => {
    const desktopMedia = css.slice(css.indexOf('@media (min-width: 1025px)'));
    assert.ok(
      desktopMedia.includes('.saas-admin-shell {\n    height: 100vh;\n    height: 100dvh;\n    overflow: hidden;\n  }'),
      'Desktop .saas-admin-shell must be locked to 100dvh with overflow: hidden'
    );
  });

  test('2. Sidebar has full viewport height (100dvh) and flex column structure', () => {
    assert.ok(
      css.includes('.saas-sidebar {\n  width: 260px;\n  background: var(--saas-surface);\n  border-right: 1px solid var(--saas-border);\n  display: flex;\n  flex-direction: column;\n  flex-shrink: 0;'),
      'Sidebar must be a fixed 260px flex column'
    );
    assert.ok(
      css.includes('height: 100dvh;'),
      'Sidebar must support height: 100dvh'
    );
  });

  test('3. Sidebar navigation has flex: 1 and overflow-y: auto', () => {
    assert.ok(
      css.includes('.saas-sidebar-nav {\n  flex: 1;\n  min-height: 0;\n  padding: 20px 14px;\n  overflow-y: auto;'),
      'Sidebar navigation must have flex: 1, min-height: 0, and overflow-y: auto'
    );
  });

  test('4. Sidebar footer has margin-top: auto and flex-shrink: 0 to stay pinned at bottom', () => {
    assert.ok(
      css.includes('.saas-sidebar-footer {\n  margin-top: auto;\n  flex-shrink: 0;\n  padding: 16px;\n  border-top: 1px solid var(--saas-border);'),
      'Sidebar footer must have margin-top: auto and flex-shrink: 0 to remain at the bottom'
    );
  });

  test('5. Main content wrapper has flex: 1, min-width: 0, min-height: 0, and overflow-y: auto', () => {
    const desktopMedia = css.slice(css.indexOf('@media (min-width: 1025px)'));
    assert.ok(
      desktopMedia.includes('.saas-main-wrapper {\n    flex: 1;\n    min-width: 0;\n    min-height: 0;\n    height: 100%;\n    overflow-y: auto;\n    overflow-x: hidden;\n  }'),
      'Main content wrapper must independently scroll with overflow-y: auto'
    );
  });

  test('6. Body/HTML scrolling is locked when desktop admin layout is active', () => {
    const desktopMedia = css.slice(css.indexOf('@media (min-width: 1025px)'));
    assert.ok(
      desktopMedia.includes('html:has(.saas-admin-shell)') && desktopMedia.includes('body.admin-body-lock'),
      'Body and html must be locked to overflow: hidden on desktop'
    );
    assert.ok(
      dashboardSrc.includes("document.body.classList.add('admin-body-lock')"),
      'Dashboard.jsx must apply admin-body-lock class on mount and remove on unmount'
    );
  });

  test('7. Mobile drawer remains responsive on mobile/tablet viewports (<=1024px)', () => {
    const mobileMedia = css.slice(css.indexOf('@media (max-width: 1024px)'));
    assert.ok(
      mobileMedia.includes('.saas-sidebar {\n    position: fixed;'),
      'Mobile sidebar must transition to fixed drawer on mobile'
    );
    assert.ok(
      mobileMedia.includes('.saas-sidebar.open {\n    transform: translateX(0);'),
      'Mobile drawer must slide in smoothly when open'
    );
  });
});
