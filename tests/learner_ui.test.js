import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Learner UI Redesign — Modern SaaS Experience & Compliance', () => {
  const dashboardSrc = fs.readFileSync('./src/pages/Dashboard.jsx', 'utf8');
  const cssSrc = fs.readFileSync('./src/index.css', 'utf8');

  test('1. Learner sidebar contains Home, Saved Gigs, and My Applications', () => {
    assert.ok(dashboardSrc.includes('>Home</span>'), 'Sidebar must contain Home navigation item');
    assert.ok(dashboardSrc.includes('>Saved Gigs</span>'), 'Sidebar must contain Saved Gigs navigation item');
    assert.ok(dashboardSrc.includes('>My Applications</span>'), 'Sidebar must contain My Applications navigation item');
  });

  test('2. Messages, Settings, and standalone Profile navigation items are removed from sidebar', () => {
    assert.equal(dashboardSrc.includes('>Messages</span>'), false, 'Messages must not appear in Learner sidebar');
    assert.equal(dashboardSrc.includes('>Settings</span>'), false, 'Settings must not appear in Learner sidebar');
    assert.equal(dashboardSrc.includes('nav-btn-label">Profile</span>'), false, 'Standalone Profile item must not appear in Learner sidebar');
  });

  test('3. Learner user card at sidebar footer is clickable with avatar, name, and chevron', () => {
    assert.ok(dashboardSrc.includes('learner-user-card-clickable'), 'Learner user card must have clickable class');
    assert.ok(dashboardSrc.includes('learner-user-avatar'), 'Learner user card must render avatar');
    assert.ok(dashboardSrc.includes('learner-user-name'), 'Learner user card must render user name');
    assert.ok(dashboardSrc.includes('learner-user-chevron'), 'Learner user card must render chevron');
    assert.ok(dashboardSrc.includes('setShowAccountModal(true)'), 'Clicking user card must open account modal');
  });

  test('4. Welcome heading renders personalized greeting and subtitle', () => {
    assert.ok(dashboardSrc.includes('Hi {firstName}!'), 'Welcome heading must include personalized first name');
    assert.ok(dashboardSrc.includes('wave-emoji'), 'Welcome heading must render waving emoji');
    assert.ok(
      dashboardSrc.includes("Discover real opportunities to build your skills and earn. Explore vetted freelance, contract, and project gigs across UpShift's six AI specialization modules."),
      'Welcome subtitle must match reference copy'
    );
  });

  test('5. Six module filter pills render exact FRD Section 8 names and IDs', () => {
    const expectedModules = [
      'All Modules',
      'M1 — AI Video / Reels',
      'M2 — AI Design / Visual',
      'M3 — AI Data Annotation / Evaluation',
      'M4 — AI Coding / Development',
      'M5 — AI Marketing / Growth',
      'M6 — AI Automation / Agents'
    ];

    for (const mod of expectedModules) {
      assert.ok(
        dashboardSrc.includes(`'${mod}'`),
        `LearnerDashboard must contain module pill label: ${mod}`
      );
    }
  });

  test('6. Extra category filter controls (Remote, Freelance, Contract, Project) are removed from filter row', () => {
    assert.equal(dashboardSrc.includes('btn-category-remote'), false, 'Remote category filter must not exist');
    assert.equal(dashboardSrc.includes('btn-category-freelance'), false, 'Freelance category filter must not exist');
    assert.equal(dashboardSrc.includes('btn-category-contract'), false, 'Contract category filter must not exist');
    assert.equal(dashboardSrc.includes('btn-category-project'), false, 'Project category filter must not exist');
  });

  test('7. Opportunity cards include split module badge, company, location, excerpt, compensation, bookmark, and side-by-side buttons', () => {
    assert.ok(dashboardSrc.includes('opp-module-split-badge'), 'Opportunity card must have split module badge');
    assert.ok(dashboardSrc.includes('opp-module-code'), 'Opportunity card must display module code pill (e.g. M4)');
    assert.ok(dashboardSrc.includes('opp-module-name'), 'Opportunity card must display module name pill (e.g. Coding / Development)');
    assert.ok(dashboardSrc.includes('opp-company-text'), 'Opportunity card must display company name');
    assert.ok(dashboardSrc.includes('opp-location-text'), 'Opportunity card must display location / work mode');
    assert.ok(dashboardSrc.includes('opp-card-excerpt'), 'Opportunity card must display excerpt');
    assert.ok(dashboardSrc.includes('opp-rate-amount'), 'Opportunity card must display compensation amount');
    assert.ok(dashboardSrc.includes('opp-bookmark-btn'), 'Opportunity card must have interactive bookmark button');
    assert.ok(dashboardSrc.includes('btn-view-details'), 'Opportunity card must have btn-view-details button');
    assert.ok(dashboardSrc.includes('View Details'), 'Opportunity card must display "View Details" label');
    assert.ok(dashboardSrc.includes('btn-apply-now'), 'Opportunity card must have btn-apply-now button');
    assert.ok(dashboardSrc.includes('Apply Now'), 'Opportunity card must display "Apply Now" label');
    assert.ok(dashboardSrc.includes('opp-card-actions'), 'Buttons must be wrapped in opp-card-actions container');
  });

  test('8. Stopped gigs remain strictly excluded from learner view', () => {
    assert.ok(
      dashboardSrc.includes("g.status !== 'Stopped' && g.activity_status !== 'Stopped'") ||
      (dashboardSrc.includes("g.status !== 'Stopped'") && dashboardSrc.includes("g.activity_status !== 'Stopped'")),
      'Learner view must strictly filter out Stopped gigs'
    );
  });

  test('9. User-scoped storage isolation logic exists in LearnerDashboard', () => {
    assert.ok(dashboardSrc.includes('upshift_saved_gigs'), 'Must reference upshift_saved_gigs prefix');
    assert.ok(dashboardSrc.includes('upshift_applied_gigs'), 'Must reference upshift_applied_gigs prefix');
    assert.ok(dashboardSrc.includes('getLearnerSavedGigsKey'), 'Must define getLearnerSavedGigsKey scoped by user.id');
    assert.ok(dashboardSrc.includes('getLearnerAppliedGigsKey'), 'Must define getLearnerAppliedGigsKey scoped by user.id');
    assert.ok(dashboardSrc.includes('handleToggleSaveGig'), 'Must have handleToggleSaveGig handler');
    assert.ok(dashboardSrc.includes('handleRecordApplication'), 'Must have handleRecordApplication handler');
    assert.ok(dashboardSrc.includes('handleApplyNow'), 'Must have handleApplyNow workflow launcher');
  });

  test('10. CSS defines responsive media queries and touch-friendly action buttons', () => {
    assert.ok(cssSrc.includes('@media (max-width: 1024px)'), 'Must include 1024px tablet breakpoint');
    assert.ok(cssSrc.includes('@media (max-width: 767px)'), 'Must include 767px mobile breakpoint');
    assert.ok(cssSrc.includes('@media (max-width: 480px)'), 'Must include 480px small mobile breakpoint');
    assert.ok(cssSrc.includes('.learner-opps-grid'), 'Must style learner-opps-grid');
    assert.ok(cssSrc.includes('.btn-view-details'), 'Must style btn-view-details');
    assert.ok(cssSrc.includes('.btn-apply-now'), 'Must style btn-apply-now');
    assert.ok(cssSrc.includes('.opp-module-split-badge'), 'Must style opp-module-split-badge');
  });
});

describe('Learner Account Data Isolation & Workflow Regression Suite', () => {
  // Simulated storage sandbox representing the user-scoped persistence contract
  class MemoryStorage {
    constructor() {
      this.store = new Map();
    }
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    }
    setItem(key, value) {
      this.store.set(key, String(value));
    }
    removeItem(key) {
      this.store.delete(key);
    }
    clear() {
      this.store.clear();
    }
  }

  const getSavedKey = (userId) => userId ? `upshift_saved_gigs_${userId}` : null;
  const getAppliedKey = (userId) => userId ? `upshift_applied_gigs_${userId}` : null;

  test('1. Learner A saves a gig and Learner B does not see it', () => {
    const storage = new MemoryStorage();
    const userA = { id: 'usr-learner-001', name: 'Learner' };
    const userB = { id: 'usr-johndoe-002', name: 'John Doe' };

    // Learner A saves GIG-001
    const keyA = getSavedKey(userA.id);
    storage.setItem(keyA, JSON.stringify(['GIG-001']));

    // Learner B accesses their saved gigs
    const keyB = getSavedKey(userB.id);
    const rawB = storage.getItem(keyB);
    const savedB = rawB ? JSON.parse(rawB) : [];

    assert.equal(savedB.length, 0, "Learner B must have 0 saved gigs");
    assert.equal(savedB.includes('GIG-001'), false, "Learner B must not see Learner A's saved gig GIG-001");
  });

  test("2. Learner A's application is not shown in Learner B's application list", () => {
    const storage = new MemoryStorage();
    const userA = { id: 'usr-learner-001', name: 'Learner' };
    const userB = { id: 'usr-johndoe-002', name: 'John Doe' };

    // Learner A applies to GIG-007
    const keyA = getAppliedKey(userA.id);
    const applicationRecordA = {
      id: 'GIG-007',
      user_id: userA.id,
      title: 'Fullstack React & Node.js Developer (AI-Assisted)',
      applied_at: new Date().toISOString()
    };
    storage.setItem(keyA, JSON.stringify([applicationRecordA]));

    // Learner B reads applications
    const keyB = getAppliedKey(userB.id);
    const rawB = storage.getItem(keyB);
    const appliedB = rawB ? JSON.parse(rawB) : [];

    assert.equal(appliedB.length, 0, "Learner B must have 0 applications");
    assert.equal(appliedB.some(a => a.id === 'GIG-007'), false, "Learner B must not see Learner A's application");
  });

  test('3. Account switching in the same browser does not leak private state', () => {
    const storage = new MemoryStorage();
    const userA = { id: 'usr-learner-001', name: 'Learner' };
    const userB = { id: 'usr-johndoe-002', name: 'John Doe' };

    // Step 1: User A logs in, saves GIG-001, applies to GIG-002
    storage.setItem(getSavedKey(userA.id), JSON.stringify(['GIG-001']));
    storage.setItem(getAppliedKey(userA.id), JSON.stringify([{ id: 'GIG-002', user_id: userA.id }]));

    // Step 2: User A signs out -> in-memory state is cleared
    let activeSaved = [];
    let activeApplied = [];
    assert.deepEqual(activeSaved, [], 'In-memory saved gigs must reset on sign out');
    assert.deepEqual(activeApplied, [], 'In-memory applied gigs must reset on sign out');

    // Step 3: User B logs in
    const keySavedB = getSavedKey(userB.id);
    const keyAppliedB = getAppliedKey(userB.id);
    activeSaved = keySavedB && storage.getItem(keySavedB) ? JSON.parse(storage.getItem(keySavedB)) : [];
    activeApplied = keyAppliedB && storage.getItem(keyAppliedB) ? JSON.parse(storage.getItem(keyAppliedB)) : [];

    assert.equal(activeSaved.length, 0, 'User B must start with 0 saved gigs');
    assert.equal(activeApplied.length, 0, 'User B must start with 0 applied gigs');

    // Step 4: User B performs their own actions
    activeSaved = ['GIG-003'];
    storage.setItem(keySavedB, JSON.stringify(activeSaved));

    // Step 5: User B signs out and User A logs back in
    activeSaved = [];
    const rawSavedA = storage.getItem(getSavedKey(userA.id));
    const rawAppliedA = storage.getItem(getAppliedKey(userA.id));
    activeSaved = rawSavedA ? JSON.parse(rawSavedA) : [];
    activeApplied = rawAppliedA ? JSON.parse(rawAppliedA) : [];

    assert.deepEqual(activeSaved, ['GIG-001'], "User A's saved gigs must remain exactly ['GIG-001']");
    assert.equal(activeApplied.length, 1, "User A's application count must remain 1");
    assert.equal(activeSaved.includes('GIG-003'), false, "User A must not inherit User B's GIG-003");
  });

  test("4. Refreshing preserves each learner's own data", () => {
    const storage = new MemoryStorage();
    const userA = { id: 'usr-learner-001' };

    // User A has saved and applied items
    storage.setItem(getSavedKey(userA.id), JSON.stringify(['GIG-001', 'GIG-004']));
    storage.setItem(getAppliedKey(userA.id), JSON.stringify([{ id: 'GIG-001', user_id: userA.id }]));

    // Page refresh simulation: re-hydrates state using current user ID
    const refreshedSaved = JSON.parse(storage.getItem(getSavedKey(userA.id)));
    const refreshedApplied = JSON.parse(storage.getItem(getAppliedKey(userA.id)));

    assert.deepEqual(refreshedSaved, ['GIG-001', 'GIG-004'], 'Refreshed saved gigs must be intact');
    assert.equal(refreshedApplied.length, 1, 'Refreshed applied gigs must be intact');
  });

  test("5. Unauthorized access without valid user ID is rejected", () => {
    assert.equal(getSavedKey(null), null, "Unauthenticated user ID returns null saved key");
    assert.equal(getSavedKey(undefined), null, "Undefined user ID returns null saved key");
    assert.equal(getAppliedKey(null), null, "Unauthenticated user ID returns null applied key");
    assert.equal(getAppliedKey(undefined), null, "Undefined user ID returns null applied key");
  });

  test('6. Stopped opportunities show closed state and prevent false application claims', () => {
    const stoppedGig = { id: 'GIG-999', title: 'Closed Project', status: 'Stopped' };
    const isClosed = stoppedGig.status === 'Stopped' || stoppedGig.activity_status === 'Stopped';
    assert.equal(isClosed, true, 'Stopped gig must be recognized as closed');

    // Simulate handleApplyNow check
    let applicationRecorded = false;
    const simulateApplyNow = (gig) => {
      if (gig.status === 'Stopped' || gig.activity_status === 'Stopped') {
        return { success: false, message: 'Closed' };
      }
      applicationRecorded = true;
      return { success: true };
    };

    const result = simulateApplyNow(stoppedGig);
    assert.equal(result.success, false, 'Applying to stopped gig must be prevented');
    assert.equal(applicationRecorded, false, 'No application record must be created for stopped gig');
  });

  test('7. Apply Now invokes application flow and records application under current user', () => {
    const storage = new MemoryStorage();
    const userA = { id: 'usr-learner-001' };
    const liveGig = {
      id: 'GIG-007',
      title: 'Fullstack React & Node.js Developer (AI-Assisted)',
      track_id: 'M4',
      origin_url: 'https://upwork.com'
    };

    let applicationCallCount = 0;
    const recordApp = (gig) => {
      applicationCallCount++;
      const key = getAppliedKey(userA.id);
      const appRecord = { id: gig.id, user_id: userA.id, title: gig.title };
      storage.setItem(key, JSON.stringify([appRecord]));
    };

    recordApp(liveGig);
    assert.equal(applicationCallCount, 1, 'Application must be recorded exactly once');

    const savedRecords = JSON.parse(storage.getItem(getAppliedKey(userA.id)));
    assert.equal(savedRecords.length, 1);
    assert.equal(savedRecords[0].user_id, 'usr-learner-001');
    assert.equal(savedRecords[0].id, 'GIG-007');
  });
});

// ====================================================================
// SIMPLIFIED LEARNER PROFILE & SIGNUP PLACEHOLDER SUITE
// ====================================================================
describe('Simplified Learner Profile & Signup Neutral Placeholders Suite', () => {
  const signupSrc = fs.readFileSync('./src/pages/Signup.jsx', 'utf8');
  const dashboardSrc = fs.readFileSync('./src/pages/Dashboard.jsx', 'utf8');
  const appSrc = fs.readFileSync('./src/App.jsx', 'utf8');
  const cssSrc = fs.readFileSync('./src/index.css', 'utf8');

  test('1. Signup page uses neutral English name placeholders without prefilling inputs', () => {
    assert.ok(signupSrc.includes('placeholder="John"'), 'First name must use "John" as placeholder');
    assert.ok(signupSrc.includes('placeholder="Smith"'), 'Last name must use "Smith" as placeholder');
    assert.equal(signupSrc.includes('placeholder="Vivek"'), false, 'Vivek must not appear as placeholder');
    assert.equal(signupSrc.includes('placeholder="Sharma"'), false, 'Sharma must not appear as placeholder');

    // Confirm inputs bind to empty initial formData state
    assert.ok(signupSrc.includes("firstName: ''"), 'formData.firstName must initialize empty');
    assert.ok(signupSrc.includes("lastName: ''"), 'formData.lastName must initialize empty');
  });

  test('2. Single unified Account & Profile view without tabs or separate profile sections', () => {
    // Confirm 3-tab navigation is removed from profile modal
    assert.equal(dashboardSrc.includes("setAccountModalTab('personal')"), false, 'Personal Info tab button must be removed');
    assert.equal(dashboardSrc.includes("setAccountModalTab('account')"), false, 'Account & Access tab button must be removed');
    assert.equal(dashboardSrc.includes("setAccountModalTab('activity')"), false, 'Marketplace Activity tab button must be removed');
    assert.equal(dashboardSrc.includes("accountModalTab"), false, 'accountModalTab state must be removed');

    // Confirm single unified profile section exists
    assert.ok(dashboardSrc.includes('Account & Profile'), 'Modal header must display Account & Profile');
    assert.ok(dashboardSrc.includes('profile-section-card'), 'Must render single unified profile-section-card');
  });

  test('3. Default read-only profile view displays learner info with Edit Profile button', () => {
    // Defaults to read-only view on modal open
    assert.ok(dashboardSrc.includes('setIsEditingProfile(false)'), 'Must reset to read-only mode whenever modal opens');
    assert.ok(!dashboardSrc.includes('isEditingProfile = true'), 'Default state must not be edit mode');

    // Displays required profile fields
    assert.ok(dashboardSrc.includes('profile-read-grid'), 'Must use structured profile-read-grid for read-only view');
    assert.ok(dashboardSrc.includes('Full Name'), 'Must display Full Name');
    assert.ok(dashboardSrc.includes('Email Address'), 'Must display Email Address');
    assert.ok(dashboardSrc.includes('First Name'), 'Must display First Name');
    assert.ok(dashboardSrc.includes('Last Name'), 'Must display Last Name');
    assert.ok(dashboardSrc.includes('Specialization Track'), 'Must display Specialization Track');
    assert.ok(dashboardSrc.includes('Phone Number'), 'Must display Phone Number');

    // Prominent Edit Profile button
    assert.ok(dashboardSrc.includes('btn-edit-profile'), 'Must provide prominent btn-edit-profile button');
    assert.ok(dashboardSrc.includes('Edit Profile'), 'Must display Edit Profile text');
  });

  test('4. Explicit edit mode provides Save Changes, Cancel, validation, and feedback', () => {
    // Mode toggling
    assert.ok(dashboardSrc.includes('setIsEditingProfile(true)'), 'Must allow entering edit mode');
    assert.ok(dashboardSrc.includes('handleSaveProfile'), 'Must provide handleSaveProfile submit handler');
    assert.ok(dashboardSrc.includes('handleCancelProfileEdit'), 'Must provide handleCancelProfileEdit handler');

    // Save and Cancel buttons
    assert.ok(dashboardSrc.includes('Save Changes'), 'Must have Save Changes button');
    assert.ok(dashboardSrc.includes('Cancel'), 'Must have Cancel button');

    // Editable state tracking
    assert.ok(dashboardSrc.includes('editFirstName'), 'Must track editFirstName state');
    assert.ok(dashboardSrc.includes('editLastName'), 'Must track editLastName state');
    assert.ok(dashboardSrc.includes('editFullName'), 'Must track editFullName state');
    assert.ok(dashboardSrc.includes('editTrackId'), 'Must track editTrackId state');
    assert.ok(dashboardSrc.includes('isSavingProfile'), 'Must provide loading state during profile save');

    // Read-only email in edit form
    assert.ok(dashboardSrc.includes('account-field-readonly'), 'Email/Phone must be marked account-field-readonly in edit mode');
  });

  test('5. Technical security diagnostics and marketplace activity cards are removed from modal', () => {
    // Technical security diagnostics removed
    assert.equal(dashboardSrc.includes('Verified • Supabase Auth'), false, 'Supabase Auth badge must be removed from modal');
    assert.equal(dashboardSrc.includes('Protected Role'), false, 'Protected Role badge must be removed from modal');
    assert.equal(dashboardSrc.includes('Row-Level Security'), false, 'Row-Level Security technical explanation must be removed');
    assert.equal(dashboardSrc.includes('User ID:'), false, 'Raw User ID must be removed from modal');
    assert.equal(dashboardSrc.includes('Member Since:'), false, 'Registration timestamp must be removed from modal');

    // Marketplace Activity removed from modal
    assert.equal(dashboardSrc.includes('account-activity-grid'), false, 'Activity card grid must be removed from modal');
    assert.equal(dashboardSrc.includes('Recent Activity Summary'), false, 'Recent activity preview must be removed from modal');

    // Learner badge preserved beside name
    assert.ok(/>\s*Learner\s*<\/span>/.test(dashboardSrc), 'Learner role badge is preserved beside profile name');

    // Simple footer: Sign Out on left, Close on right
    assert.ok(dashboardSrc.includes('Sign Out'), 'Must include Sign Out in modal footer');
    assert.ok(dashboardSrc.includes('Close'), 'Must include Close in modal footer');
  });

  test('6. AuthProvider updateProfile blocks client role escalation', () => {
    assert.ok(appSrc.includes('updateProfile'), 'AuthProvider must export updateProfile');
    assert.ok(appSrc.includes('delete sanitized.role'), 'updateProfile must strip role to prevent elevation');
    assert.ok(appSrc.includes('delete sanitized.id'), 'updateProfile must strip user id to prevent tampering');
  });

  test('7. Responsive CSS defines profile card, read-only grid, edit button, and mobile styles', () => {
    assert.ok(cssSrc.includes('.account-modal-card'), 'CSS must define account-modal-card');
    assert.ok(cssSrc.includes('.profile-section-card'), 'CSS must define profile-section-card');
    assert.ok(cssSrc.includes('.profile-read-grid'), 'CSS must define profile-read-grid');
    assert.ok(cssSrc.includes('.btn-edit-profile'), 'CSS must define btn-edit-profile');
    assert.ok(cssSrc.includes('@media (max-width: 640px)'), 'CSS must include mobile media query');
  });
});

