import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../App';
import { supabase } from '../lib/supabase';
import CandidateReviewQueue from './CandidateReviewQueue';
import { exportGigsTo19ColCSV, downloadCSV } from '../discovery/csvExport';
import { deduplicateGigList, normalizeCanonicalUrl } from '../server/deduplication';
import { normalizeHtmlToText } from '../discovery/textNormalizer';

export { exportGigsTo19ColCSV, downloadCSV };

// Module display map
const MODULE_NAMES = {
  M1: 'M1 — AI Video / Reels',
  M2: 'M2 — AI Design / Visual',
  M3: 'M3 — AI Data Annotation / Evaluation',
  M4: 'M4 — AI Coding / Development',
  M5: 'M5 — AI Marketing / Growth',
  M6: 'M6 — AI Automation / Agents',
};

// Sample seed opportunities
export const DEFAULT_SEED_GIGS = [
  {
    id: '1',
    external_gig_id: 'GIG-001',
    title: 'PDF Annotation & Transcription Experts - Telugu',
    track_id: 'M3',
    payment_amount: '$10 - $15 / hour',
    compensation_type: 'hourly',
    min_amount: 10,
    max_amount: 15,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://upwork.com',
    short_description: 'PDF Annotation & Transcription Experts - Telugu: a beginner-friendly project focused on data and language quality.',
    overview: 'Full document review and transcription for regional NLP models. Ideal for Telugu-speaking data contributors.',
    posted_at: '2026-09-30'
  },
  {
    id: '2',
    external_gig_id: 'GIG-002',
    title: 'Bilingual Audio Contributor (Indian/English)',
    track_id: 'M3',
    payment_amount: '$20 - $30 / hour',
    compensation_type: 'hourly',
    min_amount: 20,
    max_amount: 30,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://mindrift.ai',
    short_description: 'Bilingual Audio Contributor (Indian/English): recording and evaluating conversational audio datasets.',
    overview: 'Voice sample validation and acoustic annotation for multi-lingual conversational AI agents.',
    posted_at: '2026-09-30'
  },
  {
    id: '3',
    external_gig_id: 'GIG-003',
    title: 'General Data Annotation Expert',
    track_id: 'M3',
    payment_amount: '$10 - $15 / hour',
    compensation_type: 'hourly',
    min_amount: 10,
    max_amount: 15,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://mercor.com',
    short_description: 'General Data Annotation Expert: a beginner-friendly project focused on data and language quality.',
    overview: 'High-volume text taxonomy labeling and prompt-response rating for LLM instruction tuning.',
    posted_at: '2026-09-30'
  },
  {
    id: '4',
    external_gig_id: 'GIG-004',
    title: 'Telugu Language Expert',
    track_id: 'M3',
    payment_amount: '$20 - $30 / hour',
    compensation_type: 'hourly',
    min_amount: 20,
    max_amount: 30,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://upwork.com',
    short_description: 'Telugu Language Expert: evaluate AI conversational tone and dialect precision across varied scenarios.',
    overview: 'Evaluate syntactic nuance and naturalness in localized model answers.',
    posted_at: '2026-09-30'
  },
  {
    id: '5',
    external_gig_id: 'GIG-005',
    title: 'Finnish Transcription Expert',
    track_id: 'M3',
    payment_amount: '$10 - $15 / hour',
    compensation_type: 'hourly',
    min_amount: 10,
    max_amount: 15,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://upwork.com',
    short_description: 'Finnish Transcription Expert: audio data verification and formatting for European speech models.',
    overview: 'Review automated speech-to-text outputs against reference audio recordings.',
    posted_at: '2026-09-30'
  },
  {
    id: '6',
    external_gig_id: 'GIG-006',
    title: 'Video Data Annotation Specialist',
    track_id: 'M3',
    payment_amount: '$20 - $30 / hour',
    compensation_type: 'hourly',
    min_amount: 20,
    max_amount: 30,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://mercor.com',
    short_description: 'Video Data Annotation Specialist: boundary boxing and video segment labeling for computer vision.',
    overview: 'Temporal bounding box placement and semantic segmentation across continuous video streams.',
    posted_at: '2026-09-30'
  }
];

// ==========================================
// 1. LEARNER DASHBOARD COMPONENT (OPPORTUNITIES)
// ==========================================
export function LearnerDashboard() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState('all');
  const [discoveryFilter, setDiscoveryFilter] = useState('all'); // 'all', 'featured', 'newest', 'high_pay'
  const [viewingGig, setViewingGig] = useState(null);

  // Load live gigs from Supabase (or fallback seed)
  useEffect(() => {
    async function loadGigs() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('gigs')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          setGigs(deduplicateGigList(data));
        } else {
          setGigs(deduplicateGigList(DEFAULT_SEED_GIGS));
        }
      } catch (err) {
        console.warn('Error loading gigs for learner:', err);
        setGigs(deduplicateGigList(DEFAULT_SEED_GIGS));
      } finally {
        setLoading(false);
      }
    }
    loadGigs();
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // Filtered gigs pipeline
  const filteredGigs = useMemo(() => {
    let result = [...gigs];

    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g =>
        g.title?.toLowerCase().includes(q) ||
        g.short_description?.toLowerCase().includes(q) ||
        g.overview?.toLowerCase().includes(q) ||
        g.track_id?.toLowerCase().includes(q)
      );
    }

    // 2. Module Filter
    if (selectedModule !== 'all') {
      result = result.filter(g => g.track_id === selectedModule);
    }

    // Exclude stopped/closed opportunities from active learner view (PUB-05)
    result = result.filter(g => g.status !== 'Stopped' && g.activity_status !== 'Stopped');

    // 3. Quick Discovery Pills
    if (discoveryFilter === 'featured') {
      result = result.filter(g => g.is_featured || g.priority === 'Featured');
    } else if (discoveryFilter === 'newest') {
      result.sort((a, b) => new Date(b.posted_at || b.created_at || 0) - new Date(a.posted_at || a.created_at || 0));
    } else if (discoveryFilter === 'high_pay') {
      result.sort((a, b) => {
        const valA = parseFloat(a.max_amount) || parseFloat(a.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        const valB = parseFloat(b.max_amount) || parseFloat(b.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        return valB - valA;
      });
    }

    return result;
  }, [gigs, searchQuery, selectedModule, discoveryFilter]);

  const learnerName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Learner';

  return (
    <div className="learner-page">
      {/* 1. TOP NAV BAR */}
      <header className="learner-nav">
        <div className="learner-nav-brand">
          <img src="/fox.svg" alt="UpShift Fox" style={{ width: '30px', height: '30px' }} />
          <span>Up<span style={{ color: 'var(--brand-red)' }}>Shift</span> OPPORTUNITIES</span>
        </div>

        {/* Center: Gigs Workspace badge only (NO business or startups) */}
        <div className="learner-nav-badge">
          <span>💼 Gigs Workspace</span>
        </div>

        {/* Right: User profile + Sign Out */}
        <div className="learner-nav-user">
          <span className="learner-user-pill">
            👤 {learnerName}
          </span>
          <button
            onClick={handleSignOut}
            className="btn-pill-save"
            style={{ padding: '7px 16px', fontSize: '13px' }}
            title="Sign Out"
          >
            🚪 Sign Out
          </button>
        </div>
      </header>

      {/* 2. MAIN CONTENT AREA */}
      <main className="learner-content">
        {/* Banner Card */}
        <div className="learner-hero-banner">
          <div>
            <div className="learner-hero-tag">
              <span>✨ UpShift Applied Opportunities</span>
            </div>
            <h1 className="learner-hero-title">Commercial Opportunity Board</h1>
            <p className="learner-hero-desc">
              Explore and apply for vetted freelance, contract, and commercial briefs across UpShift specialization modules.
            </p>
          </div>
          <div className="learner-briefs-counter">
            <span style={{ fontSize: '20px' }}>💼</span>
            <div>
              <span style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>{gigs.length}</span> Active Briefs
            </div>
          </div>
        </div>

        {/* Controls Panel (Search & Module Filter) */}
        <div className="learner-controls-panel">
          <div className="learner-controls-row">
            {/* Search Input */}
            <div className="learner-search-wrapper">
              <span className="search-icon-prefix">🔍</span>
              <input
                type="text"
                placeholder="Search opportunities by title, keywords or requirements..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-field"
              />
            </div>

            {/* Module Filter Dropdown */}
            <select
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="learner-module-select"
            >
              <option value="all">All Modules</option>
              <option value="M1">M1 — AI Video / Reels</option>
              <option value="M2">M2 — AI Design / Visual</option>
              <option value="M3">M3 — AI Data Annotation / Evaluation</option>
              <option value="M4">M4 — AI Coding / Development</option>
              <option value="M5">M5 — AI Marketing / Growth</option>
              <option value="M6">M6 — AI Automation / Agents</option>
            </select>
          </div>

          {/* Quick Discovery Pills */}
          <div className="learner-discovery-row">
            <div className="learner-discovery-pills">
              <span className="learner-discovery-label">Quick Discovery</span>
              <button
                type="button"
                className={`learner-discovery-btn ${discoveryFilter === 'all' ? 'active' : ''}`}
                onClick={() => setDiscoveryFilter('all')}
              >
                All Opportunities ({gigs.length})
              </button>
              <button
                type="button"
                className={`learner-discovery-btn ${discoveryFilter === 'featured' ? 'active' : ''}`}
                onClick={() => setDiscoveryFilter('featured')}
              >
                ⭐ Featured ({gigs.filter(g => g.is_featured || g.priority === 'Featured').length})
              </button>
              <button
                type="button"
                className={`learner-discovery-btn ${discoveryFilter === 'newest' ? 'active' : ''}`}
                onClick={() => setDiscoveryFilter('newest')}
              >
                ⚡ New Posted
              </button>
              <button
                type="button"
                className={`learner-discovery-btn ${discoveryFilter === 'high_pay' ? 'active' : ''}`}
                onClick={() => setDiscoveryFilter('high_pay')}
              >
                💵 Highest Pay
              </button>
            </div>

            <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
              Showing <strong>{filteredGigs.length}</strong> of <strong>{gigs.length}</strong> opportunities
            </div>
          </div>
        </div>

        {/* 3. OPPORTUNITIES GRID */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
            <p style={{ fontSize: '16px', fontWeight: '700' }}>Loading opportunities...</p>
          </div>
        ) : filteredGigs.length === 0 ? (
          <div style={{ textAlign: 'center', background: '#ffffff', borderRadius: '18px', padding: '60px 20px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>No opportunities found</h3>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '18px' }}>
              Try adjusting your search keywords or resetting the module filter.
            </p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedModule('all'); setDiscoveryFilter('all'); }}
              className="btn-primary-red"
              style={{ padding: '8px 20px', fontSize: '13px' }}
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="learner-opps-grid">
            {filteredGigs.map((g) => (
              <div
                key={g.id || g.external_gig_id}
                className="learner-opp-card"
                onClick={() => setViewingGig(g)}
              >
                <div>
                  {/* Top Tags */}
                  <div className="opp-badge-row">
                    <span className="opp-module-chip">
                      {g.track_id} · {g.track_id === 'M3' ? 'DEEPANNOTATOR' : g.track_id === 'M1' ? 'REELRUSH' : g.track_id === 'M2' ? 'VISUALFORGE' : g.track_id === 'M4' ? 'VIBECODER' : g.track_id === 'M5' ? 'BRANDBUZZ' : 'AGENTHANDLERS'}
                    </span>
                    {(g.is_featured || g.priority === 'Featured') && (
                      <span className="opp-featured-chip">
                        ⭐ Featured
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="opp-card-title">{normalizeHtmlToText(g.title)}</h3>

                  {/* Description */}
                  <p className="opp-card-excerpt">
                    {normalizeHtmlToText(g.short_description || g.overview || 'Hands-on freelance opportunity open for learners.')}
                  </p>
                </div>

                {/* Bottom Row */}
                <div className="opp-card-bottom">
                  <div>
                    <div className="opp-card-rate">{g.payment_amount || 'Unspecified'}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'capitalize' }}>
                      {g.compensation_type || 'hourly'}
                    </div>
                  </div>

                  <span className="opp-read-more">
                    Read More →
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 4. MODAL: DETAILED GIG VIEW FOR LEARNERS */}
      {viewingGig && (
        <div className="modal-overlay" onClick={() => setViewingGig(null)}>
          <div className="modal-card" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="opp-module-chip">
                  {viewingGig.track_id} · {viewingGig.track_id === 'M3' ? 'DeepAnnotator' : viewingGig.track_id === 'M1' ? 'ReelRush' : viewingGig.track_id === 'M2' ? 'VisualForge' : viewingGig.track_id === 'M4' ? 'VibeCoder' : viewingGig.track_id === 'M5' ? 'BrandBuzz' : 'AgentHandlers'}
                </span>
                {(viewingGig.is_featured || viewingGig.priority === 'Featured') && (
                  <span className="opp-featured-chip">⭐ Featured</span>
                )}
              </div>
              <button onClick={() => setViewingGig(null)} className="modal-close-btn">✕</button>
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', marginBottom: '8px', lineHeight: '1.3' }}>
              {viewingGig.title}
            </h2>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '20px' }}>
              <span style={{ fontSize: '20px', fontWeight: '900', color: '#059669' }}>
                {viewingGig.payment_amount || 'Unspecified'}
              </span>
              <span style={{ fontSize: '13px', color: '#64748b', textTransform: 'capitalize' }}>
                ({viewingGig.compensation_type || 'hourly'})
              </span>
            </div>

            <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '14px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
              <strong style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '8px', letterSpacing: '0.04em' }}>
                Project Overview & Requirements
              </strong>
              <p style={{ fontSize: '14px', color: '#334155', lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap' }}>
                {normalizeHtmlToText(viewingGig.overview || viewingGig.short_description || 'No additional overview provided for this opportunity.')}
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                ID: {viewingGig.external_gig_id || viewingGig.id}
              </span>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setViewingGig(null)}
                  className="btn-pill-save"
                  style={{ padding: '9px 18px' }}
                >
                  Close
                </button>
                <a
                  href={viewingGig.origin_url || 'https://upwork.com'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-add-gig"
                  style={{ textDecoration: 'none', padding: '9px 20px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  Apply via Gateway ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 2. ADMIN OPPORTUNITIES DIRECTORY
// ==========================================

/**
 * RFC 4180 Compliant CSV Parser
 * Handles commas inside quotes, escaped quotes (""), multiline fields, and CRLF/LF.
 */
export function parseRFC4180CSV(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentField.trim());
        if (currentRow.some(col => col.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some(col => col.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(col => col.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function AdminDashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  // Synchronous initialization from URL query parameter (?tab=discovery | ?tab=published) with localStorage fallback
  const getInitialAdminTab = () => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const tab = (params.get('tab') || params.get('view') || '').toLowerCase();
        if (tab === 'discovery' || tab === 'queue') return 'discovery';
        if (tab === 'published' || tab === 'directory') return 'directory';
        const saved = localStorage.getItem('upshift_admin_tab');
        if (saved === 'discovery') return 'discovery';
      } catch {
        // Fall back to default
      }
    }
    return 'directory';
  };

  const [adminActiveTab, setAdminActiveTab] = useState(getInitialAdminTab);

  // Tab change handler that updates URL and persistence without reloading page
  const handleTabChange = (newTab) => {
    setAdminActiveTab(newTab);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('upshift_admin_tab', newTab);
        const url = new URL(window.location);
        url.searchParams.set('tab', newTab === 'discovery' ? 'discovery' : 'published');
        window.history.replaceState({}, '', url);
      } catch {
        // Safe fallback
      }
    }
  };

  // Synchronize URL and handle browser back/forward buttons
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const url = new URL(window.location);
      const tabParam = (url.searchParams.get('tab') || url.searchParams.get('view') || '').toLowerCase();
      const targetParam = adminActiveTab === 'discovery' ? 'discovery' : 'published';
      if (tabParam !== targetParam) {
        url.searchParams.set('tab', targetParam);
        window.history.replaceState({}, '', url);
      }

      const handlePopState = () => {
        const p = new URLSearchParams(window.location.search);
        const t = (p.get('tab') || p.get('view') || '').toLowerCase();
        if (t === 'discovery' || t === 'queue') {
          setAdminActiveTab('discovery');
        } else {
          setAdminActiveTab('directory');
        }
      };

      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    } catch {
      // Safe fallback
    }
  }, [adminActiveTab]);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [viewingGig, setViewingGig] = useState(null);
  const [editingGig, setEditingGig] = useState(null);

  // New Gig Form state
  const [newGig, setNewGig] = useState({
    title: '',
    track_id: 'M3',
    payment_amount: '$25 - $40 / hour',
    compensation_type: 'hourly',
    min_amount: '25',
    max_amount: '40',
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://upwork.com',
    short_description: '',
    overview: '',
  });

  // CSV Import state with validation and duplicate tracking
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvWarnings, setCsvWarnings] = useState([]);
  const [csvError, setCsvError] = useState('');

  // Load gigs from Supabase
  const fetchGigs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('gigs')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        setGigs(deduplicateGigList(data));
      } else {
        setGigs(deduplicateGigList(DEFAULT_SEED_GIGS));
      }
    } catch (err) {
      console.warn('Error fetching gigs:', err);
      setGigs(deduplicateGigList(DEFAULT_SEED_GIGS));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGigs();
  }, []);

  // Filter & Sort Pipeline
  const filteredAndSortedGigs = useMemo(() => {
    let result = [...gigs];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g =>
        g.title?.toLowerCase().includes(q) ||
        g.short_description?.toLowerCase().includes(q) ||
        g.overview?.toLowerCase().includes(q)
      );
    }

    // Module filter
    if (selectedModule !== 'all') {
      result = result.filter(g => g.track_id === selectedModule);
    }

    // Compensation & Sorting
    if (sortBy === 'comp_low_high') {
      result.sort((a, b) => {
        const valA = parseFloat(a.min_amount) || parseFloat(a.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        const valB = parseFloat(b.min_amount) || parseFloat(b.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        return valA - valB;
      });
    } else if (sortBy === 'comp_high_low') {
      result.sort((a, b) => {
        const valA = parseFloat(a.max_amount) || parseFloat(a.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        const valB = parseFloat(b.max_amount) || parseFloat(b.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        return valB - valA;
      });
    } else if (sortBy === 'hourly') {
      result = result.filter(g =>
        (g.compensation_type || '').toLowerCase().includes('hourly') ||
        (g.payment_amount || '').toLowerCase().includes('hr') ||
        (g.payment_amount || '').toLowerCase().includes('hour')
      );
    } else if (sortBy === 'fixed') {
      result = result.filter(g =>
        (g.compensation_type || '').toLowerCase().includes('fixed') ||
        !(g.payment_amount || '').toLowerCase().includes('hour')
      );
    }

    return result;
  }, [gigs, searchQuery, selectedModule, sortBy]);

  // Handle Add Gig with Verified Database Insertion
  const handleAddGigSubmit = async (e) => {
    e.preventDefault();
    const gigToInsert = {
      external_gig_id: `GIG-${Date.now().toString().slice(-4)}`,
      title: newGig.title,
      track_id: newGig.track_id,
      payment_amount: newGig.payment_amount,
      compensation_type: newGig.compensation_type,
      min_amount: parseFloat(newGig.min_amount) || 0,
      max_amount: parseFloat(newGig.max_amount) || 0,
      currency: 'USD',
      priority: newGig.priority,
      is_featured: newGig.priority === 'Featured',
      origin_url: newGig.origin_url,
      short_description: newGig.short_description || `${newGig.title}: active opportunity...`,
      overview: newGig.overview || newGig.short_description,
      posted_at: new Date().toISOString().split('T')[0],
      status: 'Active'
    };

    try {
      const { data, error } = await supabase.from('gigs').insert([gigToInsert]).select();
      if (error) {
        alert(`❌ Failed to create opportunity: ${error.message}`);
        return;
      }
      if (data && data.length > 0) {
        setGigs([data[0], ...gigs]);
        setIsAddModalOpen(false);
        setNewGig({
          title: '',
          track_id: 'M3',
          payment_amount: '$25 - $40 / hour',
          compensation_type: 'hourly',
          min_amount: '25',
          max_amount: '40',
          priority: 'Featured',
          is_featured: true,
          origin_url: 'https://upwork.com',
          short_description: '',
          overview: '',
        });
      }
    } catch (err) {
      alert(`❌ Failed to create opportunity: ${err.message}`);
    }
  };

  // Handle Delete Gig with Verified Database Deletion
  const handleDeleteGig = async (gigId) => {
    if (!window.confirm('Are you sure you want to delete this opportunity?')) return;
    try {
      const { error } = await supabase.from('gigs').delete().eq('id', gigId);
      if (error) {
        alert(`❌ Failed to delete opportunity: ${error.message}`);
        return;
      }
      setGigs(gigs.filter(g => g.id !== gigId));
    } catch (err) {
      alert(`❌ Failed to delete opportunity: ${err.message}`);
    }
  };

  // Handle CSV File Selection with RFC 4180 Parser and Full 19-Column Mapping
  const handleCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError('');
    setCsvWarnings([]);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== 'string') return;

      const rawRows = parseRFC4180CSV(text);
      if (rawRows.length < 2) {
        setCsvError('CSV file must have a header row and at least one valid data row.');
        return;
      }

      const headers = rawRows[0].map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
      const parsedRows = [];
      const warnings = [];
      const seenIds = new Set();
      const existingIds = new Set(gigs.map(g => (g.external_gig_id || '').toLowerCase()).filter(Boolean));
      const existingUrls = new Set(gigs.map(g => (g.origin_url || '').toLowerCase()).filter(Boolean));

      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (row.length === 0 || row.every(val => !val)) continue;

        const rowObj = {};
        headers.forEach((header, idx) => {
          rowObj[header] = row[idx] !== undefined ? row[idx] : '';
        });

        const title = rowObj.title?.trim();
        if (!title) {
          warnings.push(`Row ${i}: Skipped because "title" is missing.`);
          continue;
        }

        const externalId = (rowObj.external_gig_id || `CSV-${i}-${Date.now().toString().slice(-4)}`).trim();
        const originUrl = (rowObj.origin_url || 'https://upwork.com').trim();

        // Duplicate detection within CSV and existing database list
        if (seenIds.has(externalId.toLowerCase())) {
          warnings.push(`Row ${i}: Duplicate external_gig_id "${externalId}" in CSV.`);
        } else {
          seenIds.add(externalId.toLowerCase());
        }

        if (existingIds.has(externalId.toLowerCase()) || existingUrls.has(originUrl.toLowerCase())) {
          warnings.push(`Row ${i}: Notice: Gig "${title}" may already exist in directory.`);
        }

        // Validate track_id (M1 to M6)
        let trackId = (rowObj.track_id || 'M3').toUpperCase().trim();
        if (!['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].includes(trackId)) {
          trackId = 'M3';
        }

        // Numeric min/max extraction
        const minAmt = parseFloat(rowObj.min_amount) || parseFloat(rowObj.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        const maxAmt = parseFloat(rowObj.max_amount) || minAmt || 0;
        const compType = (rowObj.compensation_type?.toLowerCase().includes('fixed') || rowObj.payment_amount?.toLowerCase().includes('fixed')) ? 'fixed' : 'hourly';
        const isFeatured = rowObj.is_featured === 'true' || rowObj.priority?.toLowerCase() === 'featured';
        const isLocal = rowObj.is_local_business === 'true';

        parsedRows.push({
          external_gig_id: externalId,
          title,
          track_id: trackId,
          payment_amount: rowObj.payment_amount || `$${minAmt || 20} / hr`,
          compensation_type: compType,
          min_amount: minAmt,
          max_amount: maxAmt,
          currency: rowObj.currency?.trim() || 'USD',
          priority: isFeatured ? 'Featured' : (rowObj.priority?.trim() || 'Standard'),
          is_featured: isFeatured,
          is_local_business: isLocal,
          posted_at: rowObj.posted_at?.trim() || new Date().toISOString().split('T')[0],
          origin_url: originUrl,
          short_description: normalizeHtmlToText(rowObj.short_description?.trim() || title),
          overview: normalizeHtmlToText(rowObj.overview?.trim() || rowObj.short_description?.trim() || title),
          responsibilities: normalizeHtmlToText(rowObj.responsibilities?.trim() || ''),
          deliverables: normalizeHtmlToText(rowObj.deliverables?.trim() || ''),
          requirements: normalizeHtmlToText(rowObj.requirements?.trim() || ''),
          proof_spec: normalizeHtmlToText(rowObj.proof_spec?.trim() || ''),
          status: 'Active',
        });
      }

      if (parsedRows.length === 0) {
        setCsvError('No valid rows could be parsed. Check headers and required fields.');
        setCsvPreview([]);
      } else {
        setCsvPreview(parsedRows);
        setCsvWarnings(warnings);
      }
    };
    reader.readAsText(file);
  };

  // Bulk Import Confirm with Verified Database Insertion
  const handleBulkImportConfirm = async () => {
    if (csvPreview.length === 0) return;
    setCsvImporting(true);
    setCsvError('');

    try {
      // Deduplicate CSV rows against existing gigs by external ID and canonical URL
      const existingExtIds = new Set(gigs.map(g => g.external_gig_id).filter(Boolean));
      const existingUrls = new Set(gigs.map(g => normalizeCanonicalUrl(g.origin_url)).filter(Boolean));

      const uniqueRows = deduplicateGigList(csvPreview);
      const newRowsToInsert = uniqueRows.filter(row => {
        const canonical = normalizeCanonicalUrl(row.origin_url);
        if (row.external_gig_id && existingExtIds.has(row.external_gig_id)) return false;
        if (canonical && existingUrls.has(canonical)) return false;
        return true;
      });

      if (newRowsToInsert.length === 0) {
        alert('All opportunities in this CSV file are already present in the active directory. Zero duplicates created.');
        setCsvPreview([]);
        setCsvWarnings([]);
        setIsImportModalOpen(false);
        return;
      }

      const { data, error } = await supabase.from('gigs').insert(newRowsToInsert).select();
      if (error) {
        setCsvError(`Database insertion error: ${error.message}`);
        alert(`❌ Import Failed: ${error.message}\n\nPlease check that you are logged in as admin.`);
        return;
      }

      if (data && data.length > 0) {
        setGigs(deduplicateGigList([...data, ...gigs]));
        alert(`✓ Successfully imported ${data.length} new opportunities into the database!`);
        setCsvPreview([]);
        setCsvWarnings([]);
        setCsvError('');
        setIsImportModalOpen(false);
      } else {
        setCsvError('Database did not return inserted records.');
      }
    } catch (err) {
      setCsvError(`Unexpected error during import: ${err.message}`);
      alert(`❌ Import Exception: ${err.message}`);
    } finally {
      setCsvImporting(false);
    }
  };

  // Handle 19-Column CSV Export for Approved / Published Opportunities (FRD Section 18)
  const handleExportCSV = () => {
    if (!gigs || gigs.length === 0) {
      alert('No opportunities available to export.');
      return;
    }
    const csvContent = exportGigsTo19ColCSV(gigs, { filterApproved: true });
    const filename = `upshift_approved_gigs_${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csvContent, filename);
  };

  // Sign out
  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="admin-directory-page">
      {/* 1. UNIFIED COHESIVE DASHBOARD HEADER */}
      <header className="admin-top-nav" style={{ padding: '16px 24px', background: '#ffffff', borderBottom: '1px solid #e2e8f0', marginBottom: '20px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
              UpShift Gigs Dashboard
            </h1>

            {/* Navigation Tabs directly alongside the unified heading */}
            <nav className="dashboard-unified-nav" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                id="tab-published-gigs"
                data-testid="tab-published-gigs"
                onClick={() => handleTabChange('directory')}
                style={{
                  background: adminActiveTab === 'directory' ? '#111827' : '#f8fafc',
                  color: adminActiveTab === 'directory' ? '#ffffff' : '#475569',
                  border: adminActiveTab === 'directory' ? '1px solid #111827' : '1px solid #d1d5db',
                  borderRadius: '8px',
                  padding: '7px 16px',
                  fontSize: '13.5px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
              >
                📋 Published Gigs ({gigs.length})
              </button>
              <button
                id="tab-ai-discovery-queue"
                data-testid="tab-ai-discovery-queue"
                onClick={() => handleTabChange('discovery')}
                style={{
                  background: adminActiveTab === 'discovery' ? '#e31b23' : '#f8fafc',
                  color: adminActiveTab === 'discovery' ? '#ffffff' : '#475569',
                  border: adminActiveTab === 'discovery' ? '1px solid #e31b23' : '1px solid #d1d5db',
                  borderRadius: '8px',
                  padding: '7px 16px',
                  fontSize: '13.5px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
              >
                ⚡ AI Discovery Queue
              </button>
            </nav>
          </div>

          <div className="admin-top-actions">
            <button onClick={handleSignOut} className="btn-admin-nav" title="Sign out of admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              🚪 Sign Out
            </button>
          </div>
        </div>
      </header>

      {adminActiveTab === 'discovery' ? (
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px' }}>
          <CandidateReviewQueue
            onGigPublished={(publishedGig) => {
              if (publishedGig) setGigs(prev => [publishedGig, ...prev]);
            }}
          />
        </div>
      ) : (
      /* 2. PUBLISHED GIGS DIRECTORY CARD */
      <div className="directory-card">
        {/* Header Row */}
        <div className="directory-header-row">
          <div className="directory-header-left">
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: 0 }}>Published Gigs</h2>
          </div>

          <div className="directory-header-actions">
            <button
              onClick={handleExportCSV}
              className="btn-bulk-import"
              title="Export approved opportunities to 19-column CSV (FRD v1.0 Section 18)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              📥 Export CSV
            </button>
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="btn-bulk-import"
            >
              📤 Bulk CSV Import
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-add-gig"
            >
              + Add Gig
            </button>
          </div>
        </div>

        {/* Search Control (Filters moved into table headers) */}
        <div className="directory-controls-row">
          <div className="search-input-box" style={{ width: '100%' }}>
            <span className="search-icon-prefix">🔍</span>
            <input
              type="text"
              placeholder="Search by title, overview, short description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-field"
            />
          </div>
        </div>

        {/* Directory Table with In-Header Filters */}
        <div className="directory-table-wrapper">
          <table className="directory-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Module</span>
                    <select
                      value={selectedModule}
                      onChange={(e) => setSelectedModule(e.target.value)}
                      className="table-header-select"
                    >
                      <option value="all">All Modules</option>
                      <option value="M1">M1 — AI Video / Reels</option>
                      <option value="M2">M2 — AI Design / Visual</option>
                      <option value="M3">M3 — AI Data Annotation / Evaluation</option>
                      <option value="M4">M4 — AI Coding / Development</option>
                      <option value="M5">M5 — AI Marketing / Growth</option>
                      <option value="M6">M6 — AI Automation / Agents</option>
                    </select>
                  </div>
                </th>
                <th>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Compensation</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="table-header-select"
                    >
                      <option value="default">All / Default</option>
                      <option value="comp_low_high">Price: Low to High ↑</option>
                      <option value="comp_high_low">Price: High to Low ↓</option>
                      <option value="hourly">Hourly Only</option>
                      <option value="fixed">Fixed Price Only</option>
                    </select>
                  </div>
                </th>
                <th>Posted / Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedGigs.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                    No published gigs match your search or filter criteria.
                  </td>
                </tr>
              ) : (
                filteredAndSortedGigs.map((g) => (
                  <tr key={g.id || g.external_gig_id}>
                    {/* Opportunity */}
                    <td className="gig-title-cell">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div
                          role="button"
                          tabIndex={0}
                          className="gig-main-title"
                          onClick={() => setViewingGig(g)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setViewingGig(g);
                            }
                          }}
                          title={`Click to view details & application link for ${g.title}`}
                          style={{ margin: 0 }}
                        >
                          {g.title}
                        </div>
                        {g.origin_url && (
                          <a
                            href={g.origin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Direct application link"
                            style={{ fontSize: '12px', color: '#64748b', textDecoration: 'none', padding: '2px 4px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            ↗
                          </a>
                        )}
                      </div>
                      <div className="gig-sub-desc">{normalizeHtmlToText(g.short_description || g.title)}</div>
                    </td>

                    {/* Module */}
                    <td>
                      <span className="module-pill-badge">
                        {g.track_id} · {g.track_id === 'M3' ? 'DeepAnnotator' : g.track_id === 'M1' ? 'ReelRush' : g.track_id === 'M2' ? 'VisualForge' : g.track_id === 'M4' ? 'VibeCoder' : g.track_id === 'M5' ? 'BrandBuzz' : 'AgentHandlers'}
                      </span>
                    </td>

                    {/* Compensation */}
                    <td>
                      <div className="compensation-amount">{g.payment_amount || 'Unspecified'}</div>
                      <div className="compensation-type-label">{g.compensation_type || 'hourly'}</div>
                    </td>

                    {/* Date */}
                    <td style={{ color: '#64748b', fontSize: '12px' }}>
                      {g.posted_at ? new Date(g.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Sep 30, 2026'}
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'right' }}>
                      <div className="actions-btn-group" style={{ justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setEditingGig(g)}
                          className="action-icon-btn"
                          title="Edit Gig"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDeleteGig(g.id)}
                          className="action-icon-btn danger-hover"
                          title="Delete Gig"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ===================================================
          MODAL 1: ADD GIG MODAL
          =================================================== */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h2 className="modal-title">+ Add New Opportunity</h2>
              <button onClick={() => setIsAddModalOpen(false)} className="modal-close-btn">✕</button>
            </div>

            <form onSubmit={handleAddGigSubmit}>
              <div className="form-group">
                <label className="form-label">Opportunity Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AI Reels Producer / Prompt Engineer"
                  value={newGig.title}
                  onChange={(e) => setNewGig({ ...newGig, title: e.target.value })}
                  className="input-box"
                />
              </div>

              <div className="field-grid-2">
                <div className="form-group">
                  <label className="form-label">UpShift Module *</label>
                  <select
                    value={newGig.track_id}
                    onChange={(e) => setNewGig({ ...newGig, track_id: e.target.value })}
                    className="input-box"
                  >
                    <option value="M1">M1 — AI Video / Reels</option>
                    <option value="M2">M2 — AI Design / Visual</option>
                    <option value="M3">M3 — AI Data Annotation / Evaluation</option>
                    <option value="M4">M4 — AI Coding / Development</option>
                    <option value="M5">M5 — AI Marketing / Growth</option>
                    <option value="M6">M6 — AI Automation / Agents</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Ranking Priority</label>
                  <select
                    value={newGig.priority}
                    onChange={(e) => setNewGig({ ...newGig, priority: e.target.value })}
                    className="input-box"
                  >
                    <option value="Featured">Featured</option>
                    <option value="Standard">Standard</option>
                  </select>
                </div>
              </div>

              <div className="field-grid-2">
                <div className="form-group">
                  <label className="form-label">Compensation Text *</label>
                  <input
                    type="text"
                    required
                    placeholder="$25 - $40 / hour or $500 fixed"
                    value={newGig.payment_amount}
                    onChange={(e) => setNewGig({ ...newGig, payment_amount: e.target.value })}
                    className="input-box"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Compensation Model</label>
                  <select
                    value={newGig.compensation_type}
                    onChange={(e) => setNewGig({ ...newGig, compensation_type: e.target.value })}
                    className="input-box"
                  >
                    <option value="hourly">Hourly</option>
                    <option value="fixed">Fixed Budget</option>
                  </select>
                </div>
              </div>

              <div className="field-grid-2">
                <div className="form-group">
                  <label className="form-label">Min Amount (for Price Sort)</label>
                  <input
                    type="number"
                    placeholder="25"
                    value={newGig.min_amount}
                    onChange={(e) => setNewGig({ ...newGig, min_amount: e.target.value })}
                    className="input-box"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Max Amount (for Price Sort)</label>
                  <input
                    type="number"
                    placeholder="40"
                    value={newGig.max_amount}
                    onChange={(e) => setNewGig({ ...newGig, max_amount: e.target.value })}
                    className="input-box"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">External Gateway URL *</label>
                <input
                  type="url"
                  required
                  placeholder="https://upwork.com/jobs/..."
                  value={newGig.origin_url}
                  onChange={(e) => setNewGig({ ...newGig, origin_url: e.target.value })}
                  className="input-box"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Short Description</label>
                <textarea
                  rows="3"
                  placeholder="Brief summary of requirements..."
                  value={newGig.short_description}
                  onChange={(e) => setNewGig({ ...newGig, short_description: e.target.value })}
                  className="input-box"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="btn-pill-save"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-add-gig"
                >
                  Create Opportunity ✓
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL 2: BULK CSV IMPORT MODAL
          =================================================== */}
      {isImportModalOpen && (
        <div className="modal-overlay" onClick={() => setIsImportModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '640px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <h2 className="modal-title" style={{ textAlign: 'center', width: '100%', margin: 0 }}>📤 Bulk CSV Import</h2>
              <button onClick={() => setIsImportModalOpen(false)} className="modal-close-btn" style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>✕</button>
            </div>

            <p style={{ fontSize: '14px', color: '#64748b', margin: '0 auto 24px', textAlign: 'center', maxWidth: '480px' }}>
              Upload your CSV template to import opportunities directly into the dashboard.
            </p>

            <label className="csv-drop-zone" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', margin: '0 auto 20px', width: '100%', boxSizing: 'border-box' }}>
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvFile}
                style={{ display: 'none' }}
              />
              <div style={{ fontSize: '38px', marginBottom: '8px', textAlign: 'center' }}>📄</div>
              <strong style={{ color: '#0f172a', fontSize: '15px', fontWeight: '700', textAlign: 'center', display: 'block', width: '100%' }}>
                Click to select or drop CSV file
              </strong>
              <p style={{ color: '#94a3b8', fontSize: '12.5px', marginTop: '4px', textAlign: 'center', width: '100%', margin: '4px 0 0' }}>
                Supports standard comma-separated values (.csv)
              </p>
            </label>

            {csvError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>
                ⚠️ {csvError}
              </div>
            )}

            {csvWarnings.length > 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', marginBottom: '16px', textAlign: 'left', maxHeight: '110px', overflowY: 'auto' }}>
                <strong>Validation Notices ({csvWarnings.length}):</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {csvWarnings.slice(0, 5).map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                  {csvWarnings.length > 5 && <li>...and {csvWarnings.length - 5} more notices.</li>}
                </ul>
              </div>
            )}

            {csvPreview.length > 0 && (
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <p style={{ fontWeight: '700', fontSize: '13.5px', color: '#059669', marginBottom: '10px', textAlign: 'center' }}>
                  ✓ Parsed {csvPreview.length} valid opportunities from CSV:
                </p>
                <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'left', background: '#f8fafc' }}>
                  {csvPreview.slice(0, 5).map((row, i) => (
                    <div key={i} style={{ fontSize: '12px', padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <strong>{row.title}</strong> · {row.track_id} · <span style={{ color: '#059669', fontWeight: '700' }}>{row.payment_amount}</span>
                    </div>
                  ))}
                  {csvPreview.length > 5 && (
                    <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px', textAlign: 'center' }}>
                      + {csvPreview.length - 5} more records ready to import...
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => { setIsImportModalOpen(false); setCsvPreview([]); }}
                className="btn-pill-save"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={csvPreview.length === 0 || csvImporting}
                onClick={handleBulkImportConfirm}
                className="btn-add-gig"
              >
                {csvImporting ? 'Importing Gigs...' : `Import ${csvPreview.length} Gigs ✓`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL 3: VIEW GIG DETAILS MODAL
          =================================================== */}
      {viewingGig && (
        <div className="modal-overlay" onClick={() => setViewingGig(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <span className="priority-featured-tag">{viewingGig.track_id} · {viewingGig.priority || 'Standard'}</span>
              <button onClick={() => setViewingGig(null)} className="modal-close-btn">✕</button>
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
              {viewingGig.title}
            </h2>
            <p style={{ color: '#059669', fontSize: '18px', fontWeight: '800', marginBottom: '18px' }}>
              {viewingGig.payment_amount || 'Unspecified'} <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'normal' }}>({viewingGig.compensation_type || 'hourly'})</span>
            </p>

            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
              <strong style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b' }}>Description</strong>
              <p style={{ fontSize: '13.5px', color: '#334155', marginTop: '6px', lineHeight: '1.5' }}>
                {normalizeHtmlToText(viewingGig.short_description || viewingGig.overview || 'No additional overview provided.')}
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                ID: {viewingGig.external_gig_id || viewingGig.id}
              </span>
              <a
                href={viewingGig.origin_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="btn-add-gig"
                style={{ textDecoration: 'none' }}
              >
                Visit Apply Gateway ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL 4: EDIT GIG MODAL
          =================================================== */}
      {editingGig && (
        <div className="modal-overlay" onClick={() => setEditingGig(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h2 className="modal-title">✏️ Edit Opportunity</h2>
              <button onClick={() => setEditingGig(null)} className="modal-close-btn">✕</button>
            </div>

            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                const descValue = editingGig.short_description || editingGig.overview || '';
                const { error } = await supabase.from('gigs').update({
                  title: editingGig.title,
                  payment_amount: editingGig.payment_amount,
                  track_id: editingGig.track_id,
                  priority: editingGig.priority,
                  is_featured: editingGig.priority === 'Featured',
                  origin_url: editingGig.origin_url,
                  short_description: descValue,
                  overview: editingGig.overview || descValue,
                  updated_at: new Date().toISOString(),
                }).eq('id', editingGig.id);

                if (error) {
                  alert(`❌ Failed to update opportunity: ${error.message}`);
                  return;
                }

                const updatedGig = {
                  ...editingGig,
                  short_description: descValue,
                  overview: editingGig.overview || descValue,
                };
                setGigs(gigs.map(g => g.id === editingGig.id ? updatedGig : g));
                setEditingGig(null);
              } catch (err) {
                alert(`❌ Failed to update opportunity: ${err.message}`);
              }
            }}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  required
                  value={editingGig.title}
                  onChange={(e) => setEditingGig({ ...editingGig, title: e.target.value })}
                  className="input-box"
                />
              </div>

              <div className="field-grid-2">
                <div className="form-group">
                  <label className="form-label">Module</label>
                  <select
                    value={editingGig.track_id}
                    onChange={(e) => setEditingGig({ ...editingGig, track_id: e.target.value })}
                    className="input-box"
                  >
                    <option value="M1">M1 — AI Video / Reels</option>
                    <option value="M2">M2 — AI Design / Visual</option>
                    <option value="M3">M3 — AI Data Annotation / Evaluation</option>
                    <option value="M4">M4 — AI Coding / Development</option>
                    <option value="M5">M5 — AI Marketing / Growth</option>
                    <option value="M6">M6 — AI Automation / Agents</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    value={editingGig.priority || (editingGig.is_featured ? 'Featured' : 'Standard')}
                    onChange={(e) => setEditingGig({ ...editingGig, priority: e.target.value, is_featured: e.target.value === 'Featured' })}
                    className="input-box"
                  >
                    <option value="Featured">Featured</option>
                    <option value="Standard">Standard</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Compensation Text</label>
                <input
                  type="text"
                  required
                  value={editingGig.payment_amount}
                  onChange={(e) => setEditingGig({ ...editingGig, payment_amount: e.target.value })}
                  className="input-box"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Gateway URL</label>
                <input
                  type="url"
                  required
                  value={editingGig.origin_url}
                  onChange={(e) => setEditingGig({ ...editingGig, origin_url: e.target.value })}
                  className="input-box"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  rows="4"
                  placeholder="Overview or description of the opportunity..."
                  value={editingGig.short_description ?? editingGig.overview ?? ''}
                  onChange={(e) => setEditingGig({
                    ...editingGig,
                    short_description: e.target.value,
                    overview: e.target.value,
                  })}
                  className="input-box"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setEditingGig(null)}
                  className="btn-pill-save"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-add-gig"
                >
                  Save Changes ✓
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
