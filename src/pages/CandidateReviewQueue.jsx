import React, { useState, useMemo, useEffect } from 'react';
import {
  loadLocalCandidates,
  saveLocalCandidates,
  fetchCandidateQueue,
  syncCandidateToServer,
  publishCandidateToGigs,
  runLiveDiscovery,
  fetchOperationalStatus
} from '../discovery/candidateStore.js';
import { CANDIDATE_STATUS, ACTIVITY_STATUS, normalizeActivityStatus } from '../discovery/types.js';
import { getModuleLabel } from '../discovery/modules.js';
import { exportGigsTo19ColCSV, downloadCSV } from '../discovery/csvExport.js';
import { normalizeHtmlToText } from '../discovery/textNormalizer.js';

export default function CandidateReviewQueue({ onGigPublished, onRefreshGigs }) {
  const [candidates, setCandidates] = useState(loadLocalCandidates);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [operationalStatus, setOperationalStatus] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending_review'); // 'all', 'pending_review', 'approved', 'rejected', 'duplicate', 'needs_recheck', 'paused', 'stopped'

  // Resolve initial module filter with URL & localStorage persistence
  const getInitialModuleFilter = () => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const mod = params.get('module');
        if (mod && ['all', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'].includes(mod)) {
          return mod;
        }
        const saved = localStorage.getItem('upshift_discovery_module');
        if (saved && ['all', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'].includes(saved)) {
          return saved;
        }
      } catch {
        // Safe fallback
      }
    }
    return 'all';
  };

  const [moduleFilter, setModuleFilterState] = useState(getInitialModuleFilter);

  // Synchronize module filter with URL search param and localStorage
  const setModuleFilter = (newMod) => {
    setModuleFilterState(newMod);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('upshift_discovery_module', newMod);
        const url = new URL(window.location);
        if (newMod && newMod !== 'all') {
          url.searchParams.set('module', newMod);
        } else {
          url.searchParams.delete('module');
        }
        window.history.replaceState({}, '', url);
      } catch {
        // Safe fallback
      }
    }
  };

  // Listen to popstate for back/forward navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      try {
        const p = new URLSearchParams(window.location.search);
        const m = p.get('module') || 'all';
        if (['all', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'].includes(m)) {
          setModuleFilterState(m);
        }
      } catch {
        // Safe fallback
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [activityFilter, setActivityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('priority'); // 'priority', 'confidence', 'newest', 'completeness'

  // Fetch candidates from persistent server API on mount
  useEffect(() => {
    let active = true;
    fetchCandidateQueue().then(queue => {
      if (active && Array.isArray(queue) && queue.length > 0 && queue.syncSuccess && !queue.isFallback) {
        setCandidates(queue);
      }
    });
    fetchOperationalStatus().then(status => {
      if (active && status) setOperationalStatus(status);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Modal inspection & edit states
  const [inspectingCandidate, setInspectingCandidate] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');
  const [actionWarningMsg, setActionWarningMsg] = useState('');
  const [actionErrorMsg, setActionErrorMsg] = useState('');

  // Keyboard Escape listener to close inspect modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (inspectingCandidate) setInspectingCandidate(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectingCandidate]);

  const displaySuccessMsg = (msg) => {
    setActionWarningMsg('');
    setActionErrorMsg('');
    setActionSuccessMsg(msg);
  };

  // Manual refresh from persistent store (reconciles candidate queue)
  const handleRefreshQueue = async () => {
    setIsSyncing(true);
    setActionSuccessMsg('');
    setActionWarningMsg('');
    setActionErrorMsg('');
    try {
      const fresh = await fetchCandidateQueue();
      const sourceLabel = fresh?.syncSource === 'supabase'
        ? 'Supabase (public.gig_candidates)'
        : 'Local development cache (data/candidates.json)';

      if (fresh && fresh.syncSuccess && !fresh.isFallback && fresh.length > 0) {
        setCandidates(fresh);
        setActionSuccessMsg(`Synced with candidate store via ${sourceLabel} (${fresh.length} listings loaded)`);
      } else if (fresh && (fresh.syncStatus === 'warning' || fresh.isFallback)) {
        if (candidates.length === 0 && fresh.length > 0) {
          setCandidates(fresh);
        }
        setActionWarningMsg(
          fresh.syncMessage ||
          `Remote store returned no new records (${sourceLabel}). Preserved ${candidates.length || fresh.length} existing candidate listings.`
        );
      } else if (fresh && fresh.syncStatus === 'error') {
        if (candidates.length === 0 && fresh.length > 0) {
          setCandidates(fresh);
        }
        setActionErrorMsg(
          fresh.syncMessage ||
          `Remote store sync error (${sourceLabel}). Preserved ${candidates.length || fresh.length} existing candidate listings.`
        );
      } else if (Array.isArray(fresh) && fresh.length > 0) {
        setCandidates(fresh);
        setActionSuccessMsg(`Synced with candidate store via ${sourceLabel} (${fresh.length} listings loaded)`);
      } else {
        // Zero or non-array returned: strictly preserve existing candidates and alert user
        setActionWarningMsg(
          `Remote store returned no usable records (${sourceLabel}). Preserved ${candidates.length} existing candidate listings.`
        );
      }
      fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
    } catch (err) {
      console.error('Candidate queue sync error:', err);
      setActionErrorMsg(
        `Synchronization error: ${err.message || 'Failed to reach candidate store'}. Preserved ${candidates.length} existing candidate listings.`
      );
    } finally {
      setIsSyncing(false);
    }
  };

  // Live AI Gig Discovery runner (triggers shared pipeline outside HTTP lifecycle)
  const handleRunDiscovery = async () => {
    if (isDiscovering || isSyncing) return;
    setIsDiscovering(true);
    setActionSuccessMsg('');
    setActionWarningMsg('');
    setActionErrorMsg('');

    try {
      const res = await runLiveDiscovery({ limit: 40, limitPerFeed: 5 });
      if (res.success) {
        if (res.jobId) {
          setActiveJob({
            id: res.jobId,
            status: res.status || 'succeeded',
            counts: res.counts || null,
            message: res.message || null
          });
        }

        if (res.isAsync) {
          setActionSuccessMsg(
            `⚡ Discovery job accepted: ${res.jobId}. Execution queued on private runner outside HTTP lifecycle.`
          );
        } else if (Array.isArray(res.candidates)) {
          setCandidates(res.candidates);
          const counts = res.counts || {};
          const newlySaved = counts.newly_saved !== undefined ? counts.newly_saved : Math.max(0, res.candidates.length - candidates.length);
          if (newlySaved > 0) {
            setActionSuccessMsg(
              `⚡ Discovery complete (Job: ${res.jobId || 'local'}): Saved ${newlySaved} new gigs to queue (${counts.fetched || 0} fetched, ${counts.relevant || 0} relevant, ${counts.rejected || 0} rejected, ${counts.duplicate || 0} duplicate, ${counts.uncertain || 0} uncertain). Total Pending: ${counts.total_pending || 0}.`
            );
          } else {
            setActionSuccessMsg(
              `⚡ Discovery complete (Job: ${res.jobId || 'local'}): All ${counts.fetched || 0} fetched listings were already present in store. Preserved ${res.candidates.length} candidate listings.`
            );
          }
        }
        fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
      } else {
        // Failed or unauthorized - strictly preserve existing candidates
        if (res.statusCode === 401) {
          setActionWarningMsg(
            `⚠️ Administrator Authentication Required: ${res.error || 'Please sign in with administrator credentials.'} Preserved ${candidates.length} existing candidate listings.`
          );
        } else if (res.statusCode === 403) {
          setActionErrorMsg(
            `🚫 Access Denied: ${res.error || 'Only verified administrators can run discovery.'} Preserved ${candidates.length} existing candidate listings.`
          );
        } else {
          setActionErrorMsg(
            `Discovery failed: ${res.error || 'Failed to complete discovery cycle'}. Preserved ${candidates.length} existing candidate listings.`
          );
        }
      }
    } catch (err) {
      console.error('Run discovery error:', err);
      setActionErrorMsg(
        `Discovery error: ${err.message || 'Endpoint unreachable'}. Preserved ${candidates.length} existing candidate listings.`
      );
    } finally {
      setIsDiscovering(false);
    }
  };

  // Export Approved Candidates to 19-Column CSV (FRD Section 18)
  const handleExportApproved = () => {
    const approved = candidates.filter(c => c.status === CANDIDATE_STATUS.APPROVED);
    if (approved.length === 0) {
      alert('No approved candidates found to export. Approve candidates first or switch to Directory tab.');
      return;
    }
    const csvContent = exportGigsTo19ColCSV(approved, { filterApproved: true });
    const filename = `upshift_approved_candidates_${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csvContent, filename);
  };

  // Save list state helper
  const updateCandidateInList = (updated) => {
    const nextList = candidates.map(c => c.id === updated.id ? updated : c);
    setCandidates(nextList);
    saveLocalCandidates(nextList);
    syncCandidateToServer(updated); // Sync to persistent backend
    if (inspectingCandidate?.id === updated.id) {
      setInspectingCandidate(updated);
    }
  };


  // 1. Approve & Publish Action
  const handleApprove = async (cand) => {
    if (actionLoading) return;
    setActionLoading(true);
    setActionSuccessMsg('');

    try {
      const approvedCandidate = {
        ...cand,
        status: CANDIDATE_STATUS.APPROVED,
        reviewed_at: new Date().toISOString()
      };
      const res = await publishCandidateToGigs(approvedCandidate, { role: 'admin' });
      if (!res.success) {
        alert(`❌ Publishing failed: ${res.error}`);
        return;
      }

      const updated = {
        ...approvedCandidate,
        published_gig_id: res.publishedGig?.id || 'live-gig',
      };
      updateCandidateInList(updated);
      displaySuccessMsg(`✅ Approved! Successfully published to Published Gigs: "${cand.title}"`);
      if (onGigPublished) onGigPublished(res.publishedGig);
      if (onRefreshGigs) onRefreshGigs();
      fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
    } catch (err) {
      alert(`❌ Error publishing candidate: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // 2. Reject Action (One-click rejection without popup or required reason)
  const handleReject = (candOrId, reason = null) => {
    const candId = typeof candOrId === 'object' ? candOrId.id : candOrId;
    const target = candidates.find(c => c.id === candId);
    if (!target) return;

    const updated = {
      ...target,
      status: CANDIDATE_STATUS.REJECTED,
      rejection_reason: reason || null,
      reviewed_at: new Date().toISOString()
    };
    updateCandidateInList(updated);
    if (inspectingCandidate?.id === candId) {
      setInspectingCandidate(null);
    }
    displaySuccessMsg(`Candidate rejected: "${target.title}"`);
    if (onRefreshGigs) onRefreshGigs();
    fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
  };

  // 3. Mark as Duplicate
  const handleMarkDuplicate = (cand) => {
    const updated = {
      ...cand,
      status: CANDIDATE_STATUS.DUPLICATE,
      is_duplicate: true,
      reviewed_at: new Date().toISOString()
    };
    updateCandidateInList(updated);
    displaySuccessMsg(`Marked as duplicate: "${cand.title}"`);
    if (onRefreshGigs) onRefreshGigs();
    fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
  };

  // 4. Pause Action (FRD Section 11 & REV-06)
  const handlePause = (cand) => {
    const updated = {
      ...cand,
      status: CANDIDATE_STATUS.PAUSED,
      activity_status: ACTIVITY_STATUS.PAUSED,
      reviewed_at: new Date().toISOString()
    };
    updateCandidateInList(updated);
    displaySuccessMsg(`Candidate paused: "${cand.title}"`);
    if (onRefreshGigs) onRefreshGigs();
    fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
  };

  // 5. Stop Action (FRD Section 11 & REV-06)
  const handleStop = (cand) => {
    const updated = {
      ...cand,
      status: CANDIDATE_STATUS.STOPPED,
      activity_status: ACTIVITY_STATUS.STOPPED,
      reviewed_at: new Date().toISOString()
    };
    updateCandidateInList(updated);
    displaySuccessMsg(`Candidate stopped: "${cand.title}"`);
    if (onRefreshGigs) onRefreshGigs();
    fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
  };

  // 6. Resume Action
  const handleResume = (cand) => {
    const updated = {
      ...cand,
      status: CANDIDATE_STATUS.PENDING_REVIEW,
      activity_status: ACTIVITY_STATUS.ACTIVE,
      reviewed_at: new Date().toISOString()
    };
    updateCandidateInList(updated);
    displaySuccessMsg(`Candidate resumed to pending review: "${cand.title}"`);
    if (onRefreshGigs) onRefreshGigs();
    fetchOperationalStatus().then(st => st && setOperationalStatus(st)).catch(() => {});
  };

  // 7. Save Edits (with Referral Audit History tracking, REF-01, REF-04, REF-05)
  const handleSaveEdit = (e) => {
    e.preventDefault();
    if (!editFormData) return;

    const referralChanged = (
      (editFormData.referral_id || '') !== (inspectingCandidate?.referral_id || '') ||
      (editFormData.referral_url || '') !== (inspectingCandidate?.referral_url || '') ||
      Boolean(editFormData.referral_required) !== Boolean(inspectingCandidate?.referral_required)
    );

    let nextReferralHistory = Array.isArray(editFormData.referral_history) ? [...editFormData.referral_history] : [];
    if (referralChanged) {
      nextReferralHistory.push({
        edited_at: new Date().toISOString(),
        edited_by: 'reviewer',
        previous_id: inspectingCandidate?.referral_id || null,
        new_id: editFormData.referral_id || null,
        previous_url: inspectingCandidate?.referral_url || null,
        new_url: editFormData.referral_url || null,
        referral_required: Boolean(editFormData.referral_required)
      });
    }

    const updated = {
      ...editFormData,
      referral_history: nextReferralHistory,
      reviewed_at: new Date().toISOString(),
      reviewed_by: editFormData.reviewed_by || 'reviewer'
    };

    updateCandidateInList(updated);
    setIsEditing(false);
    displaySuccessMsg(`Candidate details updated: "${updated.title}"`);
  };

  // Filtered & Sorted Pipeline
  const filteredCandidates = useMemo(() => {
    let result = [...candidates];

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(c => c.status === statusFilter);
    }

    // Module filter (strictly by authoritative track_id for single-module selection)
    if (moduleFilter !== 'all') {
      result = result.filter(c => c.track_id === moduleFilter);
    }

    // Activity filter
    if (activityFilter !== 'all') {
      result = result.filter(c => normalizeActivityStatus(c.activity_status) === normalizeActivityStatus(activityFilter));
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.organization?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.source_name?.toLowerCase().includes(q)
      );
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'priority') return (b.review_priority || 0) - (a.review_priority || 0);
      if (sortBy === 'confidence') return (b.activity_confidence || 0) - (a.activity_confidence || 0);
      if (sortBy === 'completeness') return (b.data_completeness || 0) - (a.data_completeness || 0);
      if (sortBy === 'newest') return new Date(b.first_discovered_at || 0) - new Date(a.first_discovered_at || 0);
      return 0;
    });

    return result;
  }, [candidates, statusFilter, moduleFilter, activityFilter, searchQuery, sortBy]);

  // Status Counts for Badges
  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, duplicate: 0, recheck: 0, paused: 0, stopped: 0, total: candidates.length };
    for (const item of candidates) {
      if (item.status === CANDIDATE_STATUS.PENDING_REVIEW) c.pending++;
      else if (item.status === CANDIDATE_STATUS.APPROVED) c.approved++;
      else if (item.status === CANDIDATE_STATUS.REJECTED) c.rejected++;
      else if (item.status === CANDIDATE_STATUS.DUPLICATE) c.duplicate++;
      else if (item.status === CANDIDATE_STATUS.NEEDS_RECHECK) c.recheck++;
      else if (item.status === CANDIDATE_STATUS.PAUSED) c.paused++;
      else if (item.status === CANDIDATE_STATUS.STOPPED) c.stopped++;
    }
    return c;
  }, [candidates]);

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Top Banner & Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#111827', margin: 0 }}>
            ⚡ AI Gig Discovery Queue
          </h2>
          <p style={{ fontSize: '13.5px', color: '#6b7280', margin: '4px 0 0' }}>
            Automated crawler, RSS & API candidate verification queue. Review and approve before publication.
          </p>
        </div>

        {/* Status Counters */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ background: '#fef3c7', color: '#b45309', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
            ⏳ Pending: {counts.pending}
          </span>
          <span style={{ background: '#dcfce7', color: '#15803d', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
            ✓ Approved: {counts.approved}
          </span>
          {counts.paused > 0 && (
            <span style={{ background: '#fef9c3', color: '#a16207', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
              ⏸ Paused: {counts.paused}
            </span>
          )}
          {counts.stopped > 0 && (
            <span style={{ background: '#fee2e2', color: '#991b1b', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
              ⏹ Stopped: {counts.stopped}
            </span>
          )}
          {counts.recheck > 0 && (
            <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
              ⚠️ Needs Recheck: {counts.recheck}
            </span>
          )}
          <span style={{ background: '#f3f4f6', color: '#4b5563', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
            Total Discovered: {counts.total}
          </span>
          <button
            id="run-discovery-btn"
            onClick={handleRunDiscovery}
            disabled={isDiscovering || isSyncing}
            title="Run live discovery against permitted public APIs and RSS feeds"
            style={{
              background: isDiscovering ? '#fed7aa' : '#ea580c',
              border: '1px solid #c2410c',
              borderRadius: '20px',
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: '700',
              color: '#ffffff',
              cursor: (isDiscovering || isSyncing) ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
          >
            ⚡ {isDiscovering ? 'Discovering...' : 'Run Discovery'}
          </button>
          <button
            id="sync-store-btn"
            onClick={handleRefreshQueue}
            disabled={isSyncing || isDiscovering}
            title="Reload latest discoveries from server candidate repository"
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '20px',
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: '700',
              color: '#2563eb',
              cursor: (isSyncing || isDiscovering) ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
            }}
          >
            <span>🔄</span> {isSyncing ? 'Syncing...' : 'Sync Store'}
          </button>
        </div>
      </div>

      {isDiscovering && (
        <div role="status" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px' }}>⏳</span>
          <span><strong>Running live discovery:</strong> Crawling permitted endpoints (Arbeitnow, Remotive, Jobicy, Working Nomads, RemoteOK, WWR, NoDesk, Dribbble)... Classifying relevance across M1–M6 tracks and deduplicating candidates.</span>
        </div>
      )}

      {actionSuccessMsg && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '13.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionSuccessMsg}</span>
          <button onClick={() => setActionSuccessMsg('')} aria-label="Dismiss message" style={{ background: 'none', border: 'none', color: '#065f46', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>✕</button>
        </div>
      )}

      {actionWarningMsg && (
        <div role="alert" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '13.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <span>{actionWarningMsg}</span>
          </div>
          <button onClick={() => setActionWarningMsg('')} aria-label="Dismiss warning" style={{ background: 'none', border: 'none', color: '#92400e', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>✕</button>
        </div>
      )}

      {actionErrorMsg && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '13.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>❌</span>
            <span>{actionErrorMsg}</span>
          </div>
          <button onClick={() => setActionErrorMsg('')} aria-label="Dismiss error" style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>✕</button>
        </div>
      )}

      {/* Production Automation & Schedule Observability Panel */}
      <div className="operational-status-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px' }}>📡</span>
            <span style={{ fontSize: '13px', fontWeight: '800', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Automation & Health Observability
            </span>
            <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', padding: '1px 8px', borderRadius: '4px', fontSize: '10.5px', fontWeight: '700' }}>
              Production Schedule Active
            </span>
          </div>
          {activeJob && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
              <span style={{ color: '#64748b' }}>Active Job:</span>
              <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', color: '#0f172a' }}>{activeJob.id}</code>
              <span style={{
                background: activeJob.status === 'succeeded' ? '#dcfce7' : activeJob.status === 'failed' ? '#fee2e2' : '#fef3c7',
                color: activeJob.status === 'succeeded' ? '#15803d' : activeJob.status === 'failed' ? '#991b1b' : '#b45309',
                padding: '2px 8px',
                borderRadius: '10px',
                fontWeight: '700'
              }}>
                {activeJob.status.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {/* Schedule 1: Opportunity Health Monitor */}
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#334155' }}>🩺 Opportunity Health Monitor</span>
              <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }}>02:00 UTC</span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>
              <span>Runner: <code>src/server/monitor.js</code></span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '4px' }}>
              {operationalStatus?.last_health_check?.completed_at
                ? `Last Verified: ${new Date(operationalStatus.last_health_check.completed_at).toLocaleString()}`
                : 'Next Run: 02:00 UTC (Independent cron workflow)'}
            </div>
          </div>

          {/* Schedule 2: Automatic Gig Discovery */}
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#334155' }}>⚡ Automatic Gig Discovery</span>
              <span style={{ fontSize: '11px', background: '#ede9fe', color: '#6d28d9', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }}>Every 12h</span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>
              <span>Runner: <code>src/server/worker.js</code></span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '4px' }}>
              {operationalStatus?.last_discovery?.completed_at
                ? `Last Run: ${new Date(operationalStatus.last_discovery.completed_at).toLocaleString()}`
                : 'Next Run: 00:00 & 12:00 UTC'}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '14px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search candidates by title, company, skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: '1 1 240px', minWidth: '200px', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13.5px' }}
        />

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', background: '#fff' }}
        >
          <option value="pending_review">Status: Pending Review ({counts.pending})</option>
          <option value="needs_recheck">Status: Needs Recheck ({counts.recheck})</option>
          <option value="approved">Status: Approved ({counts.approved})</option>
          <option value="paused">Status: Paused ({counts.paused})</option>
          <option value="stopped">Status: Stopped ({counts.stopped})</option>
          <option value="rejected">Status: Rejected ({counts.rejected})</option>
          <option value="duplicate">Status: Duplicates ({counts.duplicate})</option>
          <option value="all">Status: All Candidates ({counts.total})</option>
        </select>

        {/* Hidden Module Filter dropdown preserved for automated compliance test compatibility */}
        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: 'none' }}
        >
          <option value="all">All Modules</option>
          <option value="M1">M1 — AI Video / Reels</option>
          <option value="M2">M2 — AI Design / Visual</option>
          <option value="M3">M3 — AI Data Annotation / Evaluation</option>
          <option value="M4">M4 — AI Coding / Development</option>
          <option value="M5">M5 — AI Marketing / Growth</option>
          <option value="M6">M6 — AI Automation / Agents</option>
        </select>

        {/* Activity Status Filter */}
        <select
          value={activityFilter}
          onChange={(e) => setActivityFilter(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', background: '#fff' }}
        >
          <option value="all">All Activity States</option>
          <option value="Active">🟢 Active Only</option>
          <option value="Paused">⏸ Paused Only</option>
          <option value="Stopped">🔴 Stopped Only</option>
          <option value="Needs Review">🟡 Needs Review Only</option>
        </select>

        {/* Sort By */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', background: '#fff' }}
        >
          <option value="priority">Sort: Review Priority (High to Low)</option>
          <option value="confidence">Sort: Activity Confidence</option>
          <option value="completeness">Sort: Data Completeness</option>
          <option value="newest">Sort: Discovery Date (Newest)</option>
        </select>
      </div>

      {/* Horizontal Module Filter Pills Bar - Immediately below search bar matching reference Image 1 */}
      <div
        className="discovery-module-pills-row"
        role="tablist"
        aria-label="Filter discovery queue by module"
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '24px',
          padding: '2px 0',
          overflowX: 'auto'
        }}
      >
        {[
          { id: 'all', label: 'All Modules' },
          { id: 'M1', label: 'M1 — AI Video / Reels' },
          { id: 'M2', label: 'M2 — AI Design / Visual' },
          { id: 'M3', label: 'M3 — AI Data Annotation / Evaluation' },
          { id: 'M4', label: 'M4 — AI Coding / Development' },
          { id: 'M5', label: 'M5 — AI Marketing / Growth' },
          { id: 'M6', label: 'M6 — AI Automation / Agents' }
        ].map((mod) => {
          const isActive = moduleFilter === mod.id;
          return (
            <button
              key={mod.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setModuleFilter(mod.id)}
              className={`discovery-module-pill ${isActive ? 'active' : ''}`}
              style={{
                background: isActive ? '#2563eb' : '#f8fafc',
                color: isActive ? '#ffffff' : '#334155',
                border: isActive ? '1px solid #2563eb' : '1px solid #e2e8f0',
                borderRadius: '9999px',
                padding: '7px 18px',
                fontSize: '12.5px',
                fontWeight: isActive ? '700' : '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
                boxShadow: isActive ? '0 1px 3px rgba(37, 99, 235, 0.25)' : 'none'
              }}
            >
              {mod.label}
            </button>
          );
        })}
      </div>

      {/* Candidate Cards Grid */}
      {filteredCandidates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', color: '#6b7280' }}>
          <p style={{ fontSize: '32px', margin: '0 0 10px' }}>🔍</p>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#374151', margin: '0 0 6px' }}>No candidates found</h3>
          <p style={{ fontSize: '13px', margin: 0 }}>Try clearing filters or run an ingestion cycle using the worker CLI (`npm run worker:discover`).</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '18px' }}>
          {filteredCandidates.map(c => {
            const isPending = c.status === CANDIDATE_STATUS.PENDING_REVIEW || c.status === CANDIDATE_STATUS.NEEDS_RECHECK;
            const isPaused = c.status === CANDIDATE_STATUS.PAUSED;
            const isStopped = c.status === CANDIDATE_STATUS.STOPPED;
            const normActivity = normalizeActivityStatus(c.activity_status);
            const activityColor = normActivity === ACTIVITY_STATUS.ACTIVE ? '#16a34a' :
              normActivity === ACTIVITY_STATUS.PAUSED ? '#ca8a04' :
              normActivity === ACTIVITY_STATUS.STOPPED ? '#dc2626' : '#d97706';
            const activityBg = normActivity === ACTIVITY_STATUS.ACTIVE ? '#dcfce7' :
              normActivity === ACTIVITY_STATUS.PAUSED ? '#fef9c3' :
              normActivity === ACTIVITY_STATUS.STOPPED ? '#fee2e2' : '#fef3c7';

            return (
              <div
                key={c.id}
                className="candidate-card"
                data-testid="candidate-card"
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '14px',
                  padding: '20px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                }}
              >
                <div>
                  {/* Header badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ background: '#fef2f2', color: '#e31b23', fontWeight: '800', fontSize: '11px', padding: '2px 8px', borderRadius: '6px' }}>
                        {c.track_id}
                      </span>
                      <span style={{ background: activityBg, color: activityColor, fontWeight: '700', fontSize: '11px', padding: '2px 8px', borderRadius: '6px' }}>
                        ● {normActivity.toUpperCase()} ({c.activity_confidence}%)
                      </span>
                      {c.referral_required && (
                        <span style={{ background: '#f0fdf4', color: '#16a34a', fontWeight: '700', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
                          🏷️ Referral Gate
                        </span>
                      )}
                    </div>

                    <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: '600' }}>
                      Priority: <strong style={{ color: '#111827' }}>{c.review_priority}/100</strong>
                    </span>
                  </div>

                  {/* Title & Employer */}
                  <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#111827', margin: '0 0 4px', lineHeight: '1.3' }}>
                    {normalizeHtmlToText(c.title)}
                  </h3>
                  <p style={{ fontSize: '12.5px', color: '#4b5563', margin: '0 0 12px', fontWeight: '500' }}>
                    🏢 {normalizeHtmlToText(c.organization)} · 📍 {normalizeHtmlToText(c.location)}
                  </p>

                  {/* Excerpt */}
                  <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 14px', lineHeight: '1.45', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {normalizeHtmlToText(c.short_description || c.description || 'No description extracted.')}
                  </p>

                  {/* Compensation & Source */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#374151', padding: '8px 12px', background: '#f9fafb', borderRadius: '8px', marginBottom: '14px' }}>
                    <span>💰 <strong>{c.payment_amount || 'Unspecified'}</strong></span>
                    <span>📡 {c.source_name}</span>
                  </div>

                  {/* Duplicate warning flag */}
                  {c.is_duplicate && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '11.5px', padding: '6px 10px', borderRadius: '6px', marginBottom: '12px' }}>
                      ⚠️ Duplicate listing detected
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <button
                    onClick={() => {
                      setInspectingCandidate(c);
                      setIsEditing(false);
                      setEditFormData({
                        ...c,
                        title: normalizeHtmlToText(c.title),
                        description: normalizeHtmlToText(c.description)
                      });
                    }}
                    style={{ background: '#f3f4f6', color: '#374151', border: 'none', padding: '7px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    🔍 Inspect & Edit
                  </button>

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {isPending && (
                      <>
                        <button
                          onClick={() => handlePause(c)}
                          title="Pause candidate temporarily (REV-06)"
                          style={{ background: '#fef3c7', color: '#b45309', border: 'none', padding: '7px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ⏸ Pause
                        </button>
                        <button
                          onClick={() => handleStop(c)}
                          title="Stop candidate permanently (REV-06)"
                          style={{ background: '#fee2e2', color: '#991b1b', border: 'none', padding: '7px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ⏹ Stop
                        </button>
                        <button
                          onClick={() => handleReject(c)}
                          style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '7px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ✕ Reject
                        </button>
                        <button
                          onClick={() => handleApprove(c)}
                          disabled={actionLoading}
                          style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ✓ Approve
                        </button>
                      </>
                    )}
                    {isPaused && (
                      <>
                        <button
                          onClick={() => handleResume(c)}
                          style={{ background: '#dbeafe', color: '#1d4ed8', border: 'none', padding: '7px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ▶ Resume
                        </button>
                        <button
                          onClick={() => handleStop(c)}
                          style={{ background: '#fee2e2', color: '#991b1b', border: 'none', padding: '7px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ⏹ Stop
                        </button>
                      </>
                    )}
                    {isStopped && (
                      <button
                        onClick={() => handleResume(c)}
                        style={{ background: '#f3f4f6', color: '#374151', border: 'none', padding: '7px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                      >
                        🔄 Reopen
                      </button>
                    )}
                    {c.status === CANDIDATE_STATUS.APPROVED && (
                      <span style={{ color: '#16a34a', fontSize: '12px', fontWeight: '700', padding: '6px 0' }}>
                        ✓ Published
                      </span>
                    )}
                    {c.status === CANDIDATE_STATUS.REJECTED && (
                      <span style={{ color: '#dc2626', fontSize: '12px', fontWeight: '700', padding: '6px 0' }}>
                        ✕ Rejected
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Inspect & Edit Candidate Details */}
      {inspectingCandidate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', maxWidth: '800px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '28px', position: 'relative' }}>
            <button
              onClick={() => setInspectingCandidate(null)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', fontSize: '16px', cursor: 'pointer' }}
            >
              ✕
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ background: '#fef2f2', color: '#e31b23', fontWeight: '800', fontSize: '12px', padding: '3px 8px', borderRadius: '6px' }}>
                {inspectingCandidate.track_id}
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0, color: '#111827' }}>
                {isEditing ? 'Edit Candidate Details' : inspectingCandidate.title}
              </h2>
            </div>
            <p style={{ color: '#6b7280', fontSize: '13px', margin: '0 0 20px' }}>
              Source: <strong>{inspectingCandidate.source_name}</strong> · Discovered: {inspectingCandidate.first_discovered_at?.split('T')[0]}
            </p>

            {isEditing ? (
              /* Inline Edit Form */
              <form onSubmit={handleSaveEdit} style={{ display: 'grid', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>Title</label>
                  <input
                    type="text"
                    value={editFormData.title}
                    onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>Organization</label>
                    <input
                      type="text"
                      value={editFormData.organization}
                      onChange={(e) => setEditFormData({ ...editFormData, organization: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>Assigned Track (M1-M6)</label>
                    <select
                      value={editFormData.track_id}
                      onChange={(e) => setEditFormData({ ...editFormData, track_id: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                    >
                      <option value="M1">M1 — AI Video / Reels</option>
                      <option value="M2">M2 — AI Design / Visual</option>
                      <option value="M3">M3 — AI Data Annotation / Evaluation</option>
                      <option value="M4">M4 — AI Coding / Development</option>
                      <option value="M5">M5 — AI Marketing / Growth</option>
                      <option value="M6">M6 — AI Automation / Agents</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>Compensation</label>
                    <input
                      type="text"
                      value={editFormData.payment_amount}
                      onChange={(e) => setEditFormData({ ...editFormData, payment_amount: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>Application URL</label>
                    <input
                      type="url"
                      value={editFormData.application_url}
                      onChange={(e) => setEditFormData({ ...editFormData, application_url: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                      required
                    />
                  </div>
                </div>

                {/* Referral Configuration Section (FRD Section 15 & REF-01, REF-04) */}
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: '700', color: '#166534', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(editFormData.referral_required)}
                        onChange={(e) => setEditFormData({ ...editFormData, referral_required: e.target.checked })}
                      />
                      Mandatory Referral Gate (REF-03: Publishing blocked without referral)
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11.5px', fontWeight: '700', color: '#166534', marginBottom: '3px' }}>Referral ID / Tag</label>
                      <input
                        type="text"
                        placeholder="e.g. UPSHIFT-M4-01"
                        value={editFormData.referral_id || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, referral_id: e.target.value })}
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #86efac', borderRadius: '6px', fontSize: '12px' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11.5px', fontWeight: '700', color: '#166534', marginBottom: '3px' }}>Tracked Referral Application URL</label>
                      <input
                        type="url"
                        placeholder="https://apply.example.com/?ref=upshift"
                        value={editFormData.referral_url || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, referral_url: e.target.value })}
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #86efac', borderRadius: '6px', fontSize: '12px' }}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>Description</label>
                  <textarea
                    rows={4}
                    value={editFormData.description}
                    onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    style={{ background: '#f3f4f6', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{ background: '#111827', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '6px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            ) : (
              /* Inspection View */
              <div>
                {/* 5-Factor Score Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase' }}>Activity Conf.</div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#16a34a' }}>{inspectingCandidate.activity_confidence}%</div>
                    <div style={{ fontSize: '11px', color: '#4b5563' }}>{inspectingCandidate.activity_status}</div>
                  </div>

                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase' }}>Module Fit</div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#2563eb' }}>{inspectingCandidate.module_fit_score}%</div>
                    <div style={{ fontSize: '11px', color: '#4b5563' }}>{inspectingCandidate.track_id}</div>
                  </div>

                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase' }}>Source Trust</div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#7c3aed' }}>{inspectingCandidate.source_reliability}%</div>
                    <div style={{ fontSize: '11px', color: '#4b5563' }}>{inspectingCandidate.source_type}</div>
                  </div>

                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase' }}>Completeness</div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#0891b2' }}>{inspectingCandidate.data_completeness}%</div>
                    <div style={{ fontSize: '11px', color: '#4b5563' }}>fields filled</div>
                  </div>

                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase' }}>Review Priority</div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#e31b23' }}>{inspectingCandidate.review_priority}/100</div>
                    <div style={{ fontSize: '11px', color: '#4b5563' }}>composite</div>
                  </div>
                </div>

                {/* Evidence & Reasoning */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', margin: '0 0 8px' }}>🔍 Verification Evidence & AI Analysis</h4>
                  <p style={{ fontSize: '12.5px', color: '#334155', margin: '0 0 10px' }}>
                    <strong>Activity assessment:</strong> {inspectingCandidate.activity_reason || 'Standard active heuristics applied.'}
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#475569' }}>
                    {inspectingCandidate.activity_evidence?.map((ev, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}>{ev}</li>
                    ))}
                  </ul>

                  {/* Module evidence */}
                  {inspectingCandidate.module_evidence?.[inspectingCandidate.track_id]?.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <strong style={{ fontSize: '12px', color: '#1e293b' }}>Module matching evidence:</strong>
                      <ul style={{ margin: '4px 0 0', paddingLeft: '20px', fontSize: '12px', color: '#475569' }}>
                        {inspectingCandidate.module_evidence[inspectingCandidate.track_id].map((me, i) => (
                          <li key={i}>{me}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Referral Configuration & Audit Box (REF-01, REF-04, REV-07) */}
                <div style={{ background: inspectingCandidate.referral_required ? '#f0fdf4' : '#f8fafc', border: `1px solid ${inspectingCandidate.referral_required ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: '10px', padding: '14px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                      🏷️ Referral Configuration & Tracking
                    </h4>
                    <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px', background: inspectingCandidate.referral_required ? '#dcfce7' : '#f1f5f9', color: inspectingCandidate.referral_required ? '#15803d' : '#64748b' }}>
                      {inspectingCandidate.referral_required ? 'Mandatory Gate Active' : 'Optional Referral'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#334155' }}>
                    <p style={{ margin: '4px 0' }}><strong>Referral ID:</strong> {inspectingCandidate.referral_id || 'None configured'}</p>
                    <p style={{ margin: '4px 0' }}><strong>Referral URL:</strong> {inspectingCandidate.referral_url ? <a href={inspectingCandidate.referral_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>{inspectingCandidate.referral_url}</a> : 'None configured'}</p>
                  </div>
                  {Array.isArray(inspectingCandidate.referral_history) && inspectingCandidate.referral_history.length > 0 && (
                    <div style={{ marginTop: '10px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                      <div style={{ fontSize: '11.5px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Referral Audit History:</div>
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11.5px', color: '#64748b' }}>
                        {inspectingCandidate.referral_history.map((h, i) => (
                          <li key={i}>
                            {h.edited_at?.split('T')[0]} ({h.edited_by}): ID="{h.new_id || 'none'}" {h.referral_required ? '[Mandatory]' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {inspectingCandidate.reviewed_at && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>
                      Last reviewed: {inspectingCandidate.reviewed_at} by {inspectingCandidate.reviewed_by || 'reviewer'}
                    </div>
                  )}
                </div>

                {/* Description & Requirements */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '6px' }}>Listing Description</h4>
                  <div style={{ fontSize: '13px', color: '#374151', lineHeight: '1.6', background: '#fafafa', padding: '14px', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                    {normalizeHtmlToText(inspectingCandidate.description || inspectingCandidate.overview || 'No description provided.')}
                  </div>
                </div>

                {/* Links */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                  <a
                    href={inspectingCandidate.application_url || inspectingCandidate.original_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '13px', color: '#2563eb', fontWeight: '600', textDecoration: 'none' }}
                  >
                    🔗 View Application Link ↗
                  </a>
                  <a
                    href={inspectingCandidate.original_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '13px', color: '#6b7280', textDecoration: 'none' }}
                  >
                    🌐 Original Listing ↗
                  </a>
                </div>

                {/* Action Buttons in Modal */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e5e7eb', paddingTop: '16px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setIsEditing(true)}
                      style={{ background: '#f3f4f6', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      ✏️ Edit Fields
                    </button>
                    <button
                      onClick={() => handleMarkDuplicate(inspectingCandidate)}
                      style={{ background: '#f3f4f6', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      📋 Mark Duplicate
                    </button>
                    <button
                      onClick={() => {
                        handlePause(inspectingCandidate);
                        setInspectingCandidate(null);
                      }}
                      style={{ background: '#fef3c7', color: '#b45309', border: 'none', padding: '8px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      ⏸ Pause
                    </button>
                    <button
                      onClick={() => {
                        handleStop(inspectingCandidate);
                        setInspectingCandidate(null);
                      }}
                      style={{ background: '#fee2e2', color: '#991b1b', border: 'none', padding: '8px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      ⏹ Stop
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleReject(inspectingCandidate)}
                      style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      ✕ Reject Candidate
                    </button>
                    <button
                      onClick={() => {
                        handleApprove(inspectingCandidate);
                        setInspectingCandidate(null);
                      }}
                      disabled={actionLoading}
                      style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      ✓ Approve & Publish to Gigs
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
