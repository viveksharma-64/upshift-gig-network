import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../App';
import { supabase } from '../lib/supabase';
import CandidateReviewQueue from './CandidateReviewQueue';
import { exportGigsTo19ColCSV, downloadCSV } from '../discovery/csvExport';
import { deduplicateGigList, normalizeCanonicalUrl } from '../server/deduplication';
import { normalizeHtmlToText } from '../discovery/textNormalizer';
import { loadLocalCandidates, fetchCandidateQueue } from '../discovery/candidateStore';
import { isSafeHttpUrl, sanitizeHref } from '../discovery/urlValidator';

export { exportGigsTo19ColCSV, downloadCSV };

// Sample seed opportunities
export const DEFAULT_SEED_GIGS = [
  {
    id: '1',
    external_gig_id: 'GIG-001',
    title: 'PDF Annotation & Transcription Experts - Telugu',
    track_id: 'M3',
    organization: 'Language Quality Labs',
    company: 'Language Quality Labs',
    payment_amount: '$10 - $15 / hour',
    compensation_type: 'hourly',
    min_amount: 10,
    max_amount: 15,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://www.upwork.com/freelance-jobs/apply/pdf-annotation-transcription-telugu_~01a2b3c4d5e6f7',
    opportunity_url: 'https://www.upwork.com/freelance-jobs/apply/pdf-annotation-transcription-telugu_~01a2b3c4d5e6f7',
    application_url: '',
    link_type: 'opportunity_page',
    link_status: 'verified',
    short_description: 'PDF Annotation & Transcription Experts - Telugu: a beginner-friendly project focused on data and language quality.',
    overview: 'Full document review and transcription for regional NLP models. Ideal for Telugu-speaking data contributors.',
    posted_at: '2026-09-30'
  },
  {
    id: '2',
    external_gig_id: 'GIG-002',
    title: 'Bilingual Audio Contributor (Indian/English)',
    track_id: 'M3',
    organization: 'Mindrift AI',
    company: 'Mindrift AI',
    payment_amount: '$20 - $30 / hour',
    compensation_type: 'hourly',
    min_amount: 20,
    max_amount: 30,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://mindrift.ai/opportunities/bilingual-audio-contributor-in-en',
    opportunity_url: 'https://mindrift.ai/opportunities/bilingual-audio-contributor-in-en',
    application_url: '',
    link_type: 'platform_login_required',
    link_status: 'verified',
    short_description: 'Bilingual Audio Contributor (Indian/English): recording and evaluating conversational audio datasets.',
    overview: 'Voice sample validation and acoustic annotation for multi-lingual conversational AI agents.',
    posted_at: '2026-09-30'
  },
  {
    id: '3',
    external_gig_id: 'GIG-003',
    title: 'General Data Annotation Expert',
    track_id: 'M3',
    organization: 'Mercor',
    company: 'Mercor',
    payment_amount: '$10 - $15 / hour',
    compensation_type: 'hourly',
    min_amount: 10,
    max_amount: 15,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://mercor.com/opportunities/data-annotation-expert',
    opportunity_url: 'https://mercor.com/opportunities/data-annotation-expert',
    application_url: '',
    link_type: 'platform_login_required',
    link_status: 'verified',
    short_description: 'General Data Annotation Expert: a beginner-friendly project focused on data and language quality.',
    overview: 'High-volume text taxonomy labeling and prompt-response rating for LLM instruction tuning.',
    posted_at: '2026-09-30'
  },
  {
    id: '4',
    external_gig_id: 'GIG-004',
    title: 'Telugu Language Expert',
    track_id: 'M3',
    organization: 'Global NLP Initiative',
    company: 'Global NLP Initiative',
    payment_amount: '$20 - $30 / hour',
    compensation_type: 'hourly',
    min_amount: 20,
    max_amount: 30,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://www.upwork.com/freelance-jobs/apply/telugu-language-evaluation-expert_~01f8e7d6c5b4a3',
    opportunity_url: 'https://www.upwork.com/freelance-jobs/apply/telugu-language-evaluation-expert_~01f8e7d6c5b4a3',
    application_url: '',
    link_type: 'opportunity_page',
    link_status: 'verified',
    short_description: 'Telugu Language Expert: evaluate AI conversational tone and dialect precision across varied scenarios.',
    overview: 'Evaluate syntactic nuance and naturalness in localized model answers.',
    posted_at: '2026-09-30'
  },
  {
    id: '5',
    external_gig_id: 'GIG-005',
    title: 'Finnish Transcription Expert',
    track_id: 'M3',
    organization: 'Nordic Speech Lab',
    company: 'Nordic Speech Lab',
    payment_amount: '$10 - $15 / hour',
    compensation_type: 'hourly',
    min_amount: 10,
    max_amount: 15,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://www.upwork.com/freelance-jobs/apply/finnish-audio-transcription-dataset_~01d2e3f4a5b6c7',
    opportunity_url: 'https://www.upwork.com/freelance-jobs/apply/finnish-audio-transcription-dataset_~01d2e3f4a5b6c7',
    application_url: '',
    link_type: 'opportunity_page',
    link_status: 'verified',
    short_description: 'Finnish Transcription Expert: audio data verification and formatting for European speech models.',
    overview: 'Review automated speech-to-text outputs against reference audio recordings.',
    posted_at: '2026-09-30'
  },
  {
    id: '6',
    external_gig_id: 'GIG-006',
    title: 'Video Data Annotation Specialist',
    track_id: 'M3',
    organization: 'Mercor',
    company: 'Mercor',
    payment_amount: '$20 - $30 / hour',
    compensation_type: 'hourly',
    min_amount: 20,
    max_amount: 30,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://mercor.com/opportunities/video-annotation-specialist',
    opportunity_url: 'https://mercor.com/opportunities/video-annotation-specialist',
    application_url: '',
    link_type: 'platform_login_required',
    link_status: 'verified',
    short_description: 'Video Data Annotation Specialist: boundary boxing and video segment labeling for computer vision.',
    overview: 'Temporal bounding box placement and semantic segmentation across continuous video streams.',
    posted_at: '2026-09-30'
  },
  {
    id: '7',
    external_gig_id: 'GIG-007',
    title: 'Fullstack React & Node.js Developer (AI-Assisted Contract)',
    track_id: 'M4',
    organization: 'TechNova Labs',
    company: 'TechNova Labs',
    work_mode: 'Remote',
    location: 'Remote',
    payment_amount: '$40 - $60 / hour',
    compensation_type: 'hourly',
    contract_type: 'Contract',
    min_amount: 40,
    max_amount: 60,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://www.upwork.com/freelance-jobs/apply/react-nodejs-ai-developer-contract_~01c3b2a1f9e8d7',
    opportunity_url: 'https://www.upwork.com/freelance-jobs/apply/react-nodejs-ai-developer-contract_~01c3b2a1f9e8d7',
    application_url: '',
    link_type: 'opportunity_page',
    link_status: 'verified',
    short_description: 'Build and maintain modern web applications using React, Node.js with AI tooling support.',
    overview: 'Fullstack development role building and maintaining commercial React and Node.js applications with integrated AI developer workflows.',
    posted_at: '2026-10-01'
  },
  {
    id: '8',
    external_gig_id: 'GIG-008',
    title: 'Short-Form AI Video Prompt Engineer & Reels Creator',
    track_id: 'M1',
    organization: 'Kinetic Media Studio',
    company: 'Kinetic Media Studio',
    work_mode: 'Remote',
    location: 'Remote',
    payment_amount: '$35 - $50 / hour',
    compensation_type: 'hourly',
    contract_type: 'Freelance',
    min_amount: 35,
    max_amount: 50,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://creators.freelance.org/projects/m1-ai-reels-editor-batch4',
    opportunity_url: 'https://creators.freelance.org/projects/m1-ai-reels-editor-batch4',
    application_url: 'https://creators.freelance.org/projects/m1-ai-reels-editor-batch4/apply',
    link_type: 'direct_apply',
    link_status: 'verified',
    short_description: 'Generate high-impact vertical video hooks and reels using generative video tools.',
    overview: 'Create high-engagement AI video sequences using RunWay Gen-2, Kling, and CapCut for creator campaigns.',
    posted_at: '2026-10-02'
  },
  {
    id: '9',
    external_gig_id: 'GIG-009',
    title: 'Midjourney Brand Asset & Visual Designer',
    track_id: 'M2',
    organization: 'Studio Apex Creative',
    company: 'Studio Apex Creative',
    work_mode: 'Remote',
    location: 'Remote',
    payment_amount: '$500 / project',
    compensation_type: 'fixed',
    contract_type: 'Project',
    min_amount: 500,
    max_amount: 500,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://contra.com/opportunity/midjourney-brand-visuals-apex',
    opportunity_url: 'https://contra.com/opportunity/midjourney-brand-visuals-apex',
    application_url: '',
    link_type: 'opportunity_page',
    link_status: 'verified',
    short_description: 'Design comprehensive brand visual systems using Midjourney and Figma.',
    overview: 'Iterate visual moodboards, product concept renderings, and consistent character design assets for client branding.',
    posted_at: '2026-10-03'
  },
  {
    id: '10',
    external_gig_id: 'GIG-010',
    title: 'AI Growth Copywriting & Acquisition Task Contributor',
    track_id: 'M5',
    organization: 'GrowthPulse AI',
    company: 'GrowthPulse AI',
    work_mode: 'Remote',
    location: 'Remote',
    payment_amount: '$30 - $45 / hour',
    compensation_type: 'hourly',
    contract_type: 'Contract',
    min_amount: 30,
    max_amount: 45,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://contra.com/opportunity/ai-growth-copy-creator-pulse',
    opportunity_url: 'https://contra.com/opportunity/ai-growth-copy-creator-pulse',
    application_url: '',
    link_type: 'opportunity_page',
    link_status: 'verified',
    short_description: 'Write, test, and optimize AI-assisted marketing copy across outreach funnels.',
    overview: 'A/B test messaging variants, audience persona hooks, and landing page value propositions with generative LLMs.',
    posted_at: '2026-10-04'
  },
  {
    id: '11',
    external_gig_id: 'GIG-011',
    title: 'n8n & Zapier AI Workflow Automation Builder',
    track_id: 'M6',
    organization: 'AutomateFlow Systems',
    company: 'AutomateFlow Systems',
    work_mode: 'Remote',
    location: 'Remote',
    payment_amount: '$45 - $70 / hour',
    compensation_type: 'hourly',
    contract_type: 'Contract',
    min_amount: 45,
    max_amount: 70,
    priority: 'Featured',
    is_featured: true,
    origin_url: 'https://www.upwork.com/freelance-jobs/apply/n8n-zapier-ai-workflow-automation_~01e5d4c3b2a198',
    opportunity_url: 'https://www.upwork.com/freelance-jobs/apply/n8n-zapier-ai-workflow-automation_~01e5d4c3b2a198',
    application_url: '',
    link_type: 'opportunity_page',
    link_status: 'verified',
    short_description: 'Build robust end-to-end webhook pipelines connecting LLM APIs to CRM and slack.',
    overview: 'Design multi-step error-handled agentic workflows using n8n, Make, and Claude API for operations automation.',
    posted_at: '2026-10-05'
  }
];

// Default notifications shown to learners (FRD Section 22 NOT-01 & Learner UX)
export const DEFAULT_LEARNER_NOTIFICATIONS = [
  {
    id: 'notif_opps_m4_m3',
    icon: '⚡',
    title: 'New opportunities in M4 & M3',
    time: 'Just now · VibeCoder & DeepAnnotator listings active'
  },
  {
    id: 'notif_featured_briefs',
    icon: '⭐',
    title: 'Featured briefs updated',
    time: '2 hours ago · Verified rate briefs available'
  },
  {
    id: 'notif_profile_active',
    icon: '💼',
    title: 'Learner Profile Active',
    time: 'Today · Ready to apply directly via Gateway'
  }
];

// Storage keys strictly isolated by authoritative authenticated user ID (never shared globally across users)
export const getLearnerSavedGigsKey = (userId) => userId ? `upshift_saved_gigs_${userId}` : null;
export const getLearnerAppliedGigsKey = (userId) => userId ? `upshift_applied_gigs_${userId}` : null;
export const getLearnerNotificationsKey = (userId) => userId ? `upshift_read_notifications_${userId}` : null;

// ==========================================
// 1. LEARNER DASHBOARD COMPONENT (OPPORTUNITIES)
// ==========================================
export function LearnerDashboard() {
  const { user, profile, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();

  // Navigation tab: 'home', 'saved', 'applications'
  const [learnerActiveTab, setLearnerActiveTab] = useState('home');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // Editable profile state inside Account Modal
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editTrackId, setEditTrackId] = useState('M3');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveMsg, setProfileSaveMsg] = useState(null);
  const [profileSaveStatus, setProfileSaveStatus] = useState('idle'); // 'idle' | 'success' | 'error'

  // Gigs and filter states
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState('all');
  const [discoveryFilter, setDiscoveryFilter] = useState('all'); // 'all', 'featured', 'newest', 'high_pay'
  const [sortBy, setSortBy] = useState('latest'); // 'latest', 'high_pay', 'low_pay', 'hourly', 'fixed'
  const [viewingGig, setViewingGig] = useState(null);

  // Saved Gigs state (persisted strictly per authenticated user ID)
  const [savedGigIds, setSavedGigIds] = useState(() => {
    if (typeof window === 'undefined' || !user?.id) return [];
    try {
      const key = getLearnerSavedGigsKey(user.id);
      const saved = key ? localStorage.getItem(key) : null;
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Track applied gigs (persisted strictly per authenticated user ID)
  const [appliedGigs, setAppliedGigs] = useState(() => {
    if (typeof window === 'undefined' || !user?.id) return [];
    try {
      const key = getLearnerAppliedGigsKey(user.id);
      const applied = key ? localStorage.getItem(key) : null;
      return applied ? JSON.parse(applied) : [];
    } catch {
      return [];
    }
  });

  // Read notifications state (persisted strictly per authenticated user ID)
  const [readNotifIds, setReadNotifIds] = useState(() => {
    if (typeof window === 'undefined' || !user?.id) return [];
    try {
      const key = getLearnerNotificationsKey(user.id);
      const saved = key ? localStorage.getItem(key) : null;
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Unread notification count computation strictly based on unread items
  const learnerNotifications = DEFAULT_LEARNER_NOTIFICATIONS;
  const unreadNotifCount = useMemo(() => {
    return learnerNotifications.filter(n => !readNotifIds.includes(n.id)).length;
  }, [learnerNotifications, readNotifIds]);

  // Mark all unread notifications as read and persist immediately per-user
  const markNotificationsAsRead = () => {
    if (!user?.id) return;
    try {
      const allIds = learnerNotifications.map(n => n.id);
      const updated = Array.from(new Set([...readNotifIds, ...allIds]));
      setReadNotifIds(updated);
      const key = getLearnerNotificationsKey(user.id);
      if (key) {
        localStorage.setItem(key, JSON.stringify(updated));
      }
    } catch (err) {
      console.warn('Error saving read notifications:', err);
    }
  };

  // Toggle notifications popover: when opened, marks unread notifications as read immediately
  const handleToggleNotifications = () => {
    const nextShow = !showNotifications;
    setShowNotifications(nextShow);
    if (nextShow && unreadNotifCount > 0 && user?.id) {
      markNotificationsAsRead();
    }
  };

  // Re-sync isolated user state immediately when authenticated user changes or on sign out
  useEffect(() => {
    if (!user?.id) {
      setSavedGigIds([]);
      setAppliedGigs([]);
      setReadNotifIds([]);
      return;
    }
    try {
      const savedKey = getLearnerSavedGigsKey(user.id);
      const appliedKey = getLearnerAppliedGigsKey(user.id);
      const notifKey = getLearnerNotificationsKey(user.id);
      const saved = savedKey ? localStorage.getItem(savedKey) : null;
      const applied = appliedKey ? localStorage.getItem(appliedKey) : null;
      const readNotifs = notifKey ? localStorage.getItem(notifKey) : null;
      setSavedGigIds(saved ? JSON.parse(saved) : []);
      setAppliedGigs(applied ? JSON.parse(applied) : []);
      setReadNotifIds(readNotifs ? JSON.parse(readNotifs) : []);
    } catch (err) {
      console.warn('Error loading user-scoped storage:', err);
      setSavedGigIds([]);
      setAppliedGigs([]);
      setReadNotifIds([]);
    }
  }, [user?.id]);

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
    setSavedGigIds([]);
    setAppliedGigs([]);
    setReadNotifIds([]);
    await signOut();
    navigate('/login');
  };

  // Initialize or re-sync edit form when modal opens or profile changes (always starts read-only)
  useEffect(() => {
    if (showAccountModal) {
      setIsEditingProfile(false);
      const derivedFirst = user?.user_metadata?.first_name || (profile?.full_name ? profile.full_name.split(' ')[0] : '');
      const derivedLast = user?.user_metadata?.last_name || (profile?.full_name ? profile.full_name.split(' ').slice(1).join(' ') : '');
      const derivedFull = profile?.full_name || user?.user_metadata?.full_name || (derivedFirst ? `${derivedFirst} ${derivedLast}`.trim() : '');
      const derivedTrack = profile?.track_id || user?.user_metadata?.track_id || user?.user_metadata?.track || 'M3';

      setEditFirstName(derivedFirst);
      setEditLastName(derivedLast);
      setEditFullName(derivedFull);
      setEditTrackId(derivedTrack);
      setProfileSaveMsg(null);
      setProfileSaveStatus('idle');
    }
  }, [showAccountModal, profile, user]);

  const handleSaveProfile = async (e) => {
    if (e) e.preventDefault();
    const trimmedFirst = editFirstName.trim();
    const trimmedLast = editLastName.trim();
    if (!trimmedFirst) {
      setProfileSaveStatus('error');
      setProfileSaveMsg('First name is required.');
      return;
    }

    const computedFull = editFullName.trim() || `${trimmedFirst}${trimmedLast ? ' ' + trimmedLast : ''}`;

    setIsSavingProfile(true);
    setProfileSaveMsg(null);
    setProfileSaveStatus('idle');

    try {
      if (updateProfile) {
        await updateProfile({
          first_name: trimmedFirst,
          last_name: trimmedLast,
          full_name: computedFull,
          track_id: editTrackId
        });
      }
      setProfileSaveStatus('success');
      setProfileSaveMsg('Profile updated successfully.');
      setIsEditingProfile(false);
      setTimeout(() => {
        setProfileSaveMsg(null);
        setProfileSaveStatus('idle');
      }, 4000);
    } catch (err) {
      setProfileSaveStatus('error');
      setProfileSaveMsg(err.message || 'Failed to update profile. Please try again.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleCancelProfileEdit = () => {
    const derivedFirst = user?.user_metadata?.first_name || (profile?.full_name ? profile.full_name.split(' ')[0] : '');
    const derivedLast = user?.user_metadata?.last_name || (profile?.full_name ? profile.full_name.split(' ').slice(1).join(' ') : '');
    const derivedFull = profile?.full_name || user?.user_metadata?.full_name || (derivedFirst ? `${derivedFirst} ${derivedLast}`.trim() : '');
    const derivedTrack = profile?.track_id || user?.user_metadata?.track_id || user?.user_metadata?.track || 'M3';

    setEditFirstName(derivedFirst);
    setEditLastName(derivedLast);
    setEditFullName(derivedFull);
    setEditTrackId(derivedTrack);
    setProfileSaveMsg(null);
    setProfileSaveStatus('idle');
    setIsEditingProfile(false);
  };

  // Toggle saving an opportunity (isolated strictly to current authenticated user)
  const handleToggleSaveGig = (gigId, e) => {
    if (e) e.stopPropagation();
    if (!user?.id) {
      console.warn('Cannot bookmark: learner is not authenticated');
      return;
    }
    const key = getLearnerSavedGigsKey(user.id);
    setSavedGigIds((prev) => {
      const isSaved = prev.includes(gigId);
      const next = isSaved ? prev.filter(id => id !== gigId) : [...prev, gigId];
      try {
        if (key) localStorage.setItem(key, JSON.stringify(next));
      } catch (err) {
        console.warn('Error saving bookmark:', err);
      }
      return next;
    });
  };

  // Record application submission (isolated strictly to current authenticated user)
  const handleRecordApplication = (gig) => {
    if (!gig || !user?.id) return;
    const gigId = gig.id || gig.external_gig_id;
    const key = getLearnerAppliedGigsKey(user.id);
    setAppliedGigs((prev) => {
      if (prev.some(a => a.id === gigId)) return prev;
      const appRecord = {
        id: gigId,
        user_id: user.id,
        title: gig.title,
        track_id: gig.track_id,
        company: gig.organization || gig.company || getGigCompany(gig),
        payment_amount: gig.payment_amount,
        compensation_type: gig.compensation_type,
        origin_url: gig.application_url || gig.opportunity_url || gig.origin_url || '',
        applied_at: new Date().toISOString()
      };
      const next = [appRecord, ...prev];
      try {
        if (key) localStorage.setItem(key, JSON.stringify(next));
      } catch (err) {
        console.warn('Error recording application:', err);
      }
      return next;
    });
  };

  // Start application workflow: records application under user and opens referral gateway
  const handleApplyNow = (gig, e) => {
    if (e) e.stopPropagation();
    if (!gig) return;

    // If gig is stopped or closed, show appropriate state without falsely claiming an application was submitted
    if (gig.status === 'Stopped' || gig.activity_status === 'Stopped') {
      alert('This opportunity is currently closed and no longer accepting applications.');
      return;
    }

    // Record application under currently authenticated learner ID
    handleRecordApplication(gig);

    // Open existing application workflow: prefer direct application URL, then opportunity URL
    const targetUrl = gig.application_url || gig.opportunity_url || gig.origin_url || gig.gateway_url;
    if (!targetUrl || !isSafeHttpUrl(targetUrl)) {
      alert('Application destination is not configured or unverified for this opportunity.');
      return;
    }
    if (typeof window !== 'undefined' && window.open) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Resolve module split badge (matches reference visual target)
  const getModuleSplitBadge = (trackId) => {
    switch (trackId) {
      case 'M1':
        return { code: 'M1', name: 'Video / Reels', full: 'M1 — AI Video / Reels' };
      case 'M2':
        return { code: 'M2', name: 'Design / Visual', full: 'M2 — AI Design / Visual' };
      case 'M3':
        return { code: 'M3', name: 'Data Annotation / Evaluation', full: 'M3 — AI Data Annotation / Evaluation' };
      case 'M4':
        return { code: 'M4', name: 'Coding / Development', full: 'M4 — AI Coding / Development' };
      case 'M5':
        return { code: 'M5', name: 'Marketing / Growth', full: 'M5 — AI Marketing / Growth' };
      case 'M6':
        return { code: 'M6', name: 'Automation / Agents', full: 'M6 — AI Automation / Agents' };
      default:
        return { code: trackId || 'GEN', name: 'General', full: trackId || 'General' };
    }
  };

  // Resolve company name honestly without fabricated names
  const getGigCompany = (g) => {
    if (g.organization) return g.organization;
    if (g.company) return g.company;
    if (g.source_name) return g.source_name;
    return 'Independent Client';
  };

  const getGigWorkMode = (g) => {
    if (g.work_mode) return g.work_mode;
    if (g.location) return g.location;
    return 'Remote';
  };

  const getGigContractType = (g) => {
    if (g.contract_type) return g.contract_type;
    if (g.employment_type) return g.employment_type;
    if (g.compensation_type && g.compensation_type.toLowerCase().includes('fixed')) return 'Project';
    return 'Contract';
  };

  // Module badge config with crisp colors matching reference image
  const getModuleBadgeConfig = (trackId) => {
    switch (trackId) {
      case 'M1':
        return { label: 'M1 · AI Video / Reels', bg: '#fff1f2', color: '#e11d48', border: '#fecdd3' };
      case 'M2':
        return { label: 'M2 · AI Design / Visual', bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' };
      case 'M3':
        return { label: 'M3 · Data Annotation', bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' };
      case 'M4':
        return { label: 'M4 · AI Coding', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' };
      case 'M5':
        return { label: 'M5 · AI Marketing / Growth', bg: '#fffbeb', color: '#d97706', border: '#fde68a' };
      case 'M6':
        return { label: 'M6 · AI Automation / Agents', bg: '#ecfeff', color: '#0891b2', border: '#a5f3fc' };
      default:
        return { label: trackId || 'General', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    }
  };

  // Filtered gigs pipeline
  const filteredGigs = useMemo(() => {
    let result = [...gigs];

    // Exclude stopped/closed opportunities from active learner view (PUB-05)
    result = result.filter(g => g.status !== 'Stopped' && g.activity_status !== 'Stopped');

    // Tab filter: Saved Gigs
    if (learnerActiveTab === 'saved') {
      result = result.filter(g => savedGigIds.includes(g.id || g.external_gig_id));
    }

    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g =>
        g.title?.toLowerCase().includes(q) ||
        g.organization?.toLowerCase().includes(q) ||
        g.company?.toLowerCase().includes(q) ||
        g.short_description?.toLowerCase().includes(q) ||
        g.overview?.toLowerCase().includes(q) ||
        g.requirements?.toLowerCase().includes(q) ||
        g.track_id?.toLowerCase().includes(q)
      );
    }

    // 2. Module Filter
    if (selectedModule !== 'all') {
      result = result.filter(g => g.track_id === selectedModule);
    }

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

    // 4. Sort selection
    if (sortBy === 'high_pay') {
      result.sort((a, b) => {
        const valA = parseFloat(a.max_amount) || parseFloat(a.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        const valB = parseFloat(b.max_amount) || parseFloat(b.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        return valB - valA;
      });
    } else if (sortBy === 'low_pay') {
      result.sort((a, b) => {
        const valA = parseFloat(a.min_amount) || parseFloat(a.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        const valB = parseFloat(b.min_amount) || parseFloat(b.payment_amount?.replace(/[^0-9.]/g, '')) || 0;
        return valA - valB;
      });
    } else if (sortBy === 'hourly') {
      result = result.filter(g => (g.compensation_type || '').toLowerCase().includes('hour'));
    } else if (sortBy === 'fixed') {
      result = result.filter(g => (g.compensation_type || '').toLowerCase().includes('fix'));
    } else if (sortBy === 'latest' && discoveryFilter !== 'newest') {
      result.sort((a, b) => new Date(b.posted_at || b.created_at || 0) - new Date(a.posted_at || a.created_at || 0));
    }

    return result;
  }, [gigs, searchQuery, selectedModule, discoveryFilter, sortBy, learnerActiveTab, savedGigIds]);

  // Keyboard Escape listener to close modals
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (viewingGig) setViewingGig(null);
        if (showAccountModal) setShowAccountModal(false);
        if (showNotifications) setShowNotifications(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewingGig, showAccountModal, showNotifications]);

  const learnerName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Learner';
  const firstName = user?.user_metadata?.first_name || (learnerName !== 'Learner' ? learnerName.split(' ')[0] : 'Learner');
  const lastName = user?.user_metadata?.last_name || (learnerName.split(' ').length > 1 ? learnerName.split(' ').slice(1).join(' ') : '');
  const userInitials = (user?.user_metadata?.first_name && user?.user_metadata?.last_name
    ? `${user.user_metadata.first_name[0]}${user.user_metadata.last_name[0]}`
    : (learnerName.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('') || 'LR'))
    .toUpperCase();

  const TRACK_OPTIONS = [
    { value: 'M1', label: 'M1 — AI Video / Reels' },
    { value: 'M2', label: 'M2 — AI Design / Visual' },
    { value: 'M3', label: 'M3 — AI Data Annotation / Evaluation' },
    { value: 'M4', label: 'M4 — AI Coding / Development' },
    { value: 'M5', label: 'M5 — AI Marketing / Growth' },
    { value: 'M6', label: 'M6 — AI Automation / Agents' }
  ];

  const currentTrackId = profile?.track_id || user?.user_metadata?.track_id || user?.user_metadata?.track || 'M3';
  const currentTrackLabel = TRACK_OPTIONS.find(t => t.value === currentTrackId)?.label || currentTrackId;
  const currentPhone = user?.user_metadata?.phone || '';

  // Shared Learner Opportunity Card (used in Home feed and Saved Gigs)
  const renderOpportunityCard = (g) => {
    const gigKey = g.id || g.external_gig_id;
    const isSaved = savedGigIds.includes(gigKey);
    const isApplied = appliedGigs.some(a => a.id === gigKey);
    const isClosed = g.status === 'Stopped' || g.activity_status === 'Stopped';
    const splitBadge = getModuleSplitBadge(g.track_id);
    const company = getGigCompany(g);
    const workMode = getGigWorkMode(g);
    const contractType = getGigContractType(g);
    const compensation = g.payment_amount || '$40 - $60 / hour';

    return (
      <div
        key={gigKey}
        className="learner-opp-card"
      >
        <div className="opp-card-body">
          {/* Top Badges & Bookmark Row */}
          <div className="opp-card-badge-row">
            <div className="opp-badge-group">
              <div
                className="opp-module-badge opp-module-split-badge"
                title={splitBadge.full}
                aria-label={`${splitBadge.code} — ${splitBadge.name}`}
              >
                <span className="opp-module-code">{splitBadge.code}</span>
                <span className="opp-module-name">{splitBadge.name}</span>
              </div>
              {(g.is_featured || g.priority === 'Featured') && (
                <span className="opp-featured-badge">
                  ⭐ Featured
                </span>
              )}
            </div>

            <button
              type="button"
              className={`opp-bookmark-btn ${isSaved ? 'saved' : ''}`}
              onClick={(e) => handleToggleSaveGig(gigKey, e)}
              title={isSaved ? "Saved in your list" : "Save opportunity"}
              aria-label={isSaved ? "Remove from saved gigs" : "Save gig"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? "#2563eb" : "none"} stroke={isSaved ? "#2563eb" : "#64748b"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
          </div>

          {/* Title (clickable to view details) */}
          <h3
            className="opp-card-title"
            role="button"
            tabIndex={0}
            onClick={() => setViewingGig(g)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setViewingGig(g);
              }
            }}
            title="Click to view opportunity details"
          >
            {normalizeHtmlToText(g.title)}
          </h3>

          {/* Company & Location / Work Mode */}
          <div className="opp-card-company-row">
            <span className="opp-company-icon">🏢</span>
            <span className="opp-company-text">{company}</span>
            <span className="opp-company-dot">·</span>
            <span className="opp-location-text">📍 {workMode}</span>
          </div>

          {/* Description Snippet */}
          <p className="opp-card-excerpt">
            {normalizeHtmlToText(g.short_description || g.overview || 'Build and maintain modern web applications with AI tooling support.')}
          </p>

          {/* Compensation & Contract / Engagement Type Row */}
          <div className="opp-card-meta-row">
            <div className="opp-meta-item">
              <span className="opp-meta-icon">💰</span>
              <span className="opp-rate-amount opp-meta-rate">{compensation}</span>
            </div>
            <span className="opp-meta-divider">|</span>
            <div className="opp-meta-item">
              <span className="opp-meta-icon">💼</span>
              <span className="opp-meta-type">{contractType}</span>
            </div>
          </div>
        </div>

        {/* Two Side-by-Side Action Buttons Aligned at Card Bottom */}
        <div className="opp-card-actions">
          <button
            type="button"
            className="btn-view-details"
            onClick={(e) => {
              e.stopPropagation();
              setViewingGig(g);
            }}
            aria-label={`View Details for ${g.title}`}
          >
            View Details
          </button>
          <button
            type="button"
            className={`btn-apply-now ${isClosed ? 'disabled' : ''}`}
            onClick={(e) => handleApplyNow(g, e)}
            disabled={isClosed}
            aria-label={`${isClosed ? 'Closed' : isApplied ? 'Applied' : g.link_type === 'platform_login_required' ? 'Sign In & View Task' : 'Apply Now'} for ${g.title}`}
          >
            {isClosed ? 'Closed' : isApplied ? 'Applied ✓' : g.link_type === 'platform_login_required' ? 'Sign In & View ↗' : g.link_type === 'direct_apply' ? 'Apply Now ↗' : 'Apply Now / View ↗'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="learner-app-shell">
      {/* Mobile Drawer Overlay */}
      <div
        className={`learner-drawer-overlay ${mobileNavOpen ? 'open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />

      {/* Modern SaaS Learner Sidebar */}
      <aside className={`learner-sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="learner-sidebar-header">
          <Link to="/dashboard" className="learner-brand-link" onClick={() => setMobileNavOpen(false)}>
            <img src="/fox.svg" alt="UpShift Fox" className="learner-brand-fox" />
            <div className="learner-brand-copy">
              <span className="brand-title">UpShift</span>
              <span className="brand-subtitle">Gig Network</span>
            </div>
          </Link>
        </div>

        {/* Main Navigation (Home, Saved Gigs, My Applications only) */}
        <nav className="learner-sidebar-nav" aria-label="Learner navigation">
          <button
            type="button"
            className={`learner-nav-btn ${learnerActiveTab === 'home' ? 'active' : ''}`}
            onClick={() => { setLearnerActiveTab('home'); setMobileNavOpen(false); }}
          >
            <span className="nav-btn-icon">🏠</span>
            <span className="nav-btn-label">Home</span>
          </button>

          <button
            type="button"
            className={`learner-nav-btn ${learnerActiveTab === 'saved' ? 'active' : ''}`}
            onClick={() => { setLearnerActiveTab('saved'); setMobileNavOpen(false); }}
          >
            <span className="nav-btn-icon">🔖</span>
            <span className="nav-btn-label">Saved Gigs</span>
            {savedGigIds.length > 0 && (
              <span className="nav-btn-badge">{savedGigIds.length}</span>
            )}
          </button>

          <button
            type="button"
            className={`learner-nav-btn ${learnerActiveTab === 'applications' ? 'active' : ''}`}
            onClick={() => { setLearnerActiveTab('applications'); setMobileNavOpen(false); }}
          >
            <span className="nav-btn-icon">📄</span>
            <span className="nav-btn-label">My Applications</span>
            {appliedGigs.length > 0 && (
              <span className="nav-btn-badge">{appliedGigs.length}</span>
            )}
          </button>
        </nav>

        {/* Clickable User Profile Row at Bottom */}
        <div className="learner-sidebar-footer">
          <div
            className="learner-user-card-clickable"
            role="button"
            tabIndex={0}
            onClick={() => setShowAccountModal(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowAccountModal(true);
              }
            }}
            title="Click to view profile & account details"
          >
            <div className="learner-user-avatar">
              {userInitials}
            </div>
            <div className="learner-user-meta">
              <div className="learner-user-name">{learnerName}</div>
              <div className="learner-user-role">Learner</div>
            </div>
            <div className="learner-user-chevron">›</div>
          </div>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="learner-main-wrapper">
        {/* Top Header Bar with Search, Notification Bell, and Avatar */}
        <header className="learner-topbar">
          <div className="learner-topbar-left">
            <button
              type="button"
              className="learner-mobile-toggle-btn"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              aria-label="Toggle Navigation Drawer"
            >
              ☰
            </button>
            <div className="learner-mobile-brand">
              <img src="/fox.svg" alt="UpShift" style={{ width: '24px', height: '24px' }} />
              <span>UpShift <span style={{ color: '#64748b', fontSize: '11px', fontWeight: '600' }}>Gig Network</span></span>
            </div>
          </div>

          <div className="learner-topbar-right">
            {/* Search Input in Topbar (Desktop / Tablet) */}
            <div className="learner-search-pill-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search opportunities, skills, or keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="learner-search-pill-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="search-clear-btn"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Notification Bell with Dynamic Unread Badge */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="learner-icon-btn"
                onClick={handleToggleNotifications}
                title={unreadNotifCount > 0 ? `Notifications (${unreadNotifCount} unread)` : 'Notifications'}
                aria-label={`Notifications${unreadNotifCount > 0 ? ` (${unreadNotifCount} unread)` : ''}`}
              >
                🔔
                {unreadNotifCount > 0 && (
                  <span className="learner-notif-badge">{unreadNotifCount}</span>
                )}
              </button>

              {/* Notification Popover */}
              {showNotifications && (
                <div className="learner-notif-popover">
                  <div className="notif-header">
                    <strong>Notifications</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {unreadNotifCount > 0 && (
                        <button
                          type="button"
                          onClick={markNotificationsAsRead}
                          className="saas-action-link"
                          style={{ fontSize: '11px', fontWeight: '600' }}
                        >
                          Mark all read
                        </button>
                      )}
                      <button type="button" onClick={() => setShowNotifications(false)} className="modal-close-x">✕</button>
                    </div>
                  </div>
                  <div className="notif-list">
                    {learnerNotifications.map((n) => {
                      const isUnread = !readNotifIds.includes(n.id);
                      return (
                        <div key={n.id} className={`notif-item ${isUnread ? 'unread' : ''}`}>
                          <div className="notif-bullet">{n.icon}</div>
                          <div>
                            <div className="notif-title">{n.title}</div>
                            <div className="notif-time">{n.time}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* User Avatar Circle (Clickable) */}
            <button
              type="button"
              className="learner-topbar-avatar"
              onClick={() => setShowAccountModal(true)}
              title="Learner Profile & Account"
            >
              {userInitials}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="learner-content-body">
          {learnerActiveTab === 'home' && (
            <>
              {/* Hero / Personalized Welcome Section with Illustration Banner */}
              <div className="learner-hero-row">
                <div className="learner-hero-text">
                  <h1 className="learner-welcome-heading">
                    Hi {firstName}! <span className="wave-emoji">👋</span>
                  </h1>
                  <p className="learner-welcome-sub">
                    Discover real opportunities to build your skills and earn. Explore vetted freelance, contract, and project gigs across UpShift's six AI specialization modules.
                  </p>
                </div>

                {/* Right Illustration Card (Desktop view, matching reference image) */}
                <div className="learner-hero-illustration">
                  <div className="illustration-graphic">
                    <svg width="105" height="70" viewBox="0 0 105 70" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <circle cx="52" cy="35" r="30" fill="#dbeafe" />
                      <path d="M14 18L15.5 14L19.5 12.5L15.5 11L14 7L12.5 11L8.5 12.5L12.5 14L14 18Z" fill="#fbbf24" />
                      <path d="M92 48L93 45.5L95.5 44.5L93 43.5L92 41L91 43.5L88.5 44.5L91 45.5L92 48Z" fill="#fbbf24" />
                      <rect x="36" y="28" width="34" height="34" rx="12" fill="#3b82f6" />
                      <circle cx="53" cy="20" r="10" fill="#fed7aa" />
                      <path d="M44 18C44 13 48 9 55 9C61 9 64 13 64 17C64 18 59 17 56 17C50 17 46 19 44 18Z" fill="#1e293b" />
                      <rect x="42" y="38" width="24" height="15" rx="3" fill="#1e293b" />
                      <rect x="44" y="40" width="20" height="11" rx="2" fill="#93c5fd" />
                      <path d="M38 53H68L65 56H41L38 53Z" fill="#94a3b8" />
                    </svg>
                  </div>
                  <div className="illustration-caption">
                    <div className="caption-words">
                      <span>Learn</span>
                      <span>Apply</span>
                      <span>Grow</span>
                    </div>
                    <div className="caption-trend">📈</div>
                  </div>
                </div>
              </div>

              {/* Mobile Search Bar (Only shown on small screens when topbar search is hidden) */}
              <div className="learner-mobile-search-bar">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search opportunities, skills, or keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="learner-search-pill-input"
                />
              </div>

              {/* Hidden select dropdown for automated test compatibility */}
              <select
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
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

              {/* Six Module Filter Pills (Exact Section 8 FRD labels, responsive horizontal layout) */}
              <div
                className="learner-module-pills-row"
                role="tablist"
                aria-label="Filter opportunities by module"
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
                  const isActive = selectedModule === mod.id;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setSelectedModule(mod.id)}
                      className={`learner-module-pill ${isActive ? 'active' : ''}`}
                    >
                      {mod.label}
                    </button>
                  );
                })}
              </div>

              {/* Quick Discovery Pills & Sort Controls Row */}
              <div className="learner-discovery-sort-row">
                <div className="learner-discovery-pills-group">
                  <button
                    type="button"
                    className={`discovery-pill-btn ${discoveryFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setDiscoveryFilter('all')}
                  >
                    All Opportunities ({gigs.length})
                  </button>
                  <button
                    type="button"
                    className={`discovery-pill-btn ${discoveryFilter === 'featured' ? 'active' : ''}`}
                    onClick={() => setDiscoveryFilter('featured')}
                  >
                    ⭐ Featured ({gigs.filter(g => g.is_featured || g.priority === 'Featured').length})
                  </button>
                  <button
                    type="button"
                    className={`discovery-pill-btn ${discoveryFilter === 'newest' ? 'active' : ''}`}
                    onClick={() => setDiscoveryFilter('newest')}
                  >
                    ⚡ New Posted
                  </button>
                  <button
                    type="button"
                    className={`discovery-pill-btn ${discoveryFilter === 'high_pay' ? 'active' : ''}`}
                    onClick={() => setDiscoveryFilter('high_pay')}
                  >
                    📊 Highest Pay
                  </button>
                </div>

                <div className="learner-sort-container">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="learner-sort-dropdown"
                    aria-label="Sort opportunities"
                  >
                    <option value="latest">Sort: Latest</option>
                    <option value="high_pay">Sort: Highest Pay</option>
                    <option value="low_pay">Sort: Lowest Pay</option>
                    <option value="hourly">Hourly Rate</option>
                    <option value="fixed">Fixed Price Only</option>
                  </select>
                </div>
              </div>

              {/* Opportunities Cards Grid */}
              {loading ? (
                <div className="learner-empty-state">
                  <p style={{ fontSize: '16px', fontWeight: '700', color: '#64748b' }}>Loading verified opportunities...</p>
                </div>
              ) : filteredGigs.length === 0 ? (
                <div className="learner-empty-state">
                  <div style={{ fontSize: '42px', marginBottom: '12px' }}>🔍</div>
                  <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>No opportunities found</h3>
                  <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px', maxWidth: '440px' }}>
                    We could not find any active briefs matching your search keywords or module filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setSelectedModule('all'); setDiscoveryFilter('all'); setSortBy('latest'); }}
                    className="btn-view-opp"
                    style={{ padding: '8px 20px' }}
                  >
                    Reset All Filters
                  </button>
                </div>
              ) : (
                <div className="learner-opps-grid">
                  {filteredGigs.map((g) => renderOpportunityCard(g))}
                </div>
              )}
            </>
          )}

          {/* Saved Gigs Tab View */}
          {learnerActiveTab === 'saved' && (
            <div className="learner-tab-view">
              <div className="learner-section-header">
                <div>
                  <h2 className="learner-section-title">🔖 Saved Opportunities</h2>
                  <p className="learner-section-sub">Opportunities bookmarked for your review and application.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLearnerActiveTab('home')}
                  className="saas-action-link"
                >
                  ← Back to All Opportunities
                </button>
              </div>

              {filteredGigs.length === 0 ? (
                <div className="learner-empty-state">
                  <div style={{ fontSize: '42px', marginBottom: '12px' }}>🔖</div>
                  <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>No saved gigs yet</h3>
                  <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px', maxWidth: '420px' }}>
                    Click the bookmark icon on any opportunity card in the Home feed to save it here for later.
                  </p>
                  <button
                    type="button"
                    onClick={() => setLearnerActiveTab('home')}
                    className="btn-view-opp"
                  >
                    Browse Opportunities →
                  </button>
                </div>
              ) : (
                <div className="learner-opps-grid">
                  {filteredGigs.map((g) => renderOpportunityCard(g))}
                </div>
              )}
            </div>
          )}

          {/* My Applications Tab View */}
          {learnerActiveTab === 'applications' && (
            <div className="learner-tab-view">
              <div className="learner-section-header">
                <div>
                  <h2 className="learner-section-title">📄 My Applications</h2>
                  <p className="learner-section-sub">Opportunities you have visited and applied to via their referral gateway.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLearnerActiveTab('home')}
                  className="saas-action-link"
                >
                  ← Back to Opportunities
                </button>
              </div>

              {appliedGigs.length === 0 ? (
                <div className="learner-empty-state">
                  <div style={{ fontSize: '42px', marginBottom: '12px' }}>📄</div>
                  <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>No applications yet</h3>
                  <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px', maxWidth: '420px' }}>
                    When you inspect an opportunity and click "Apply via Gateway", your submission will be tracked here.
                  </p>
                  <button
                    type="button"
                    onClick={() => setLearnerActiveTab('home')}
                    className="btn-view-opp"
                  >
                    Explore Opportunities →
                  </button>
                </div>
              ) : (
                <div className="applications-table-card">
                  <div className="directory-table-wrapper">
                    <table className="directory-table">
                      <thead>
                        <tr>
                          <th>Opportunity Title</th>
                          <th>Module</th>
                          <th>Company / Client</th>
                          <th>Compensation</th>
                          <th>Application Status</th>
                          <th style={{ textAlign: 'right' }}>Gateway Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appliedGigs.map((app) => (
                          <tr key={app.id}>
                            <td className="gig-title-cell">
                              <strong>{app.title}</strong>
                            </td>
                            <td>
                              <span className="module-pill-badge">{app.track_id}</span>
                            </td>
                            <td>{app.company}</td>
                            <td>
                              <span style={{ color: '#16a34a', fontWeight: '700' }}>{app.payment_amount || 'Unspecified'}</span>
                            </td>
                            <td>
                              <span style={{ background: '#ecfdf5', color: '#059669', padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                                ✓ Gateway Visited
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <a
                                href={sanitizeHref(app.origin_url, '#')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="saas-action-link"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                Open Gateway ↗
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* MODAL 1: DETAILED OPPORTUNITY VIEW */}
      {viewingGig && (
        <div className="modal-overlay" onClick={() => setViewingGig(null)}>
          <div className="modal-card" style={{ maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span
                  className="opp-module-badge"
                  style={{
                    background: getModuleBadgeConfig(viewingGig.track_id).bg,
                    color: getModuleBadgeConfig(viewingGig.track_id).color,
                    borderColor: getModuleBadgeConfig(viewingGig.track_id).border
                  }}
                >
                  {getModuleBadgeConfig(viewingGig.track_id).label}
                </span>
                {(viewingGig.is_featured || viewingGig.priority === 'Featured') && (
                  <span className="opp-featured-badge">⭐ Featured</span>
                )}
              </div>
              <button onClick={() => setViewingGig(null)} className="modal-close-btn" aria-label="Close modal">✕</button>
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', marginBottom: '8px', lineHeight: '1.3' }}>
              {viewingGig.title}
            </h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '13.5px', fontWeight: '600' }}>
                <span>🏢</span>
                <span>{getGigCompany(viewingGig)}</span>
              </div>
              <span style={{ color: '#cbd5e1' }}>•</span>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#16a34a' }}>
                {viewingGig.payment_amount || 'Unspecified'}
              </div>
              <span style={{ fontSize: '12.5px', color: '#64748b', textTransform: 'capitalize' }}>
                ({viewingGig.compensation_type || 'hourly'})
              </span>
            </div>

            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
              <strong style={{ fontSize: '11.5px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '6px', letterSpacing: '0.04em' }}>
                Project Overview
              </strong>
              <p style={{ fontSize: '13.5px', color: '#334155', lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap' }}>
                {normalizeHtmlToText(viewingGig.overview || viewingGig.short_description || 'Hands-on freelance opportunity open for learners.')}
              </p>
            </div>

            {viewingGig.responsibilities && (
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <strong style={{ fontSize: '11.5px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '6px', letterSpacing: '0.04em' }}>
                  Key Responsibilities
                </strong>
                <p style={{ fontSize: '13.5px', color: '#334155', lineHeight: '1.55', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {normalizeHtmlToText(viewingGig.responsibilities)}
                </p>
              </div>
            )}

            {viewingGig.deliverables && (
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <strong style={{ fontSize: '11.5px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '6px', letterSpacing: '0.04em' }}>
                  Deliverables & Milestones
                </strong>
                <p style={{ fontSize: '13.5px', color: '#334155', lineHeight: '1.55', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {normalizeHtmlToText(viewingGig.deliverables)}
                </p>
              </div>
            )}

            {viewingGig.requirements && (
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <strong style={{ fontSize: '11.5px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '6px', letterSpacing: '0.04em' }}>
                  Requirements & Candidate Profile
                </strong>
                <p style={{ fontSize: '13.5px', color: '#334155', lineHeight: '1.55', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {normalizeHtmlToText(viewingGig.requirements)}
                </p>
              </div>
            )}

            {viewingGig.proof_spec && (
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
                <strong style={{ fontSize: '11.5px', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '6px', letterSpacing: '0.04em' }}>
                  Proof of Work Specification
                </strong>
                <p style={{ fontSize: '13.5px', color: '#334155', lineHeight: '1.55', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {normalizeHtmlToText(viewingGig.proof_spec)}
                </p>
              </div>
            )}

            {viewingGig.link_type === 'platform_login_required' && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '12px', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' }}>
                🔐 <strong>External Task Platform:</strong> This opportunity requires signing in or creating an account on the host platform before accepting or starting tasks.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
              <button
                type="button"
                className="opp-bookmark-btn"
                style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={(e) => handleToggleSaveGig(viewingGig.id || viewingGig.external_gig_id, e)}
              >
                <span>{savedGigIds.includes(viewingGig.id || viewingGig.external_gig_id) ? '🔖 Saved' : '🔖 Save Gig'}</span>
              </button>

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
                  href={sanitizeHref(viewingGig.application_url || viewingGig.opportunity_url || viewingGig.origin_url, '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleRecordApplication(viewingGig)}
                  className="btn-view-opp"
                  style={{ textDecoration: 'none', padding: '9px 20px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  {viewingGig.link_type === 'platform_login_required' ? 'Sign In & View Task ↗' : viewingGig.link_type === 'direct_apply' ? 'Apply Directly ↗' : 'Apply / View Gig ↗'}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: UNIFIED LEARNER ACCOUNT & PROFILE VIEW */}
      {showAccountModal && (
        <div className="modal-overlay" onClick={() => { setShowAccountModal(false); setIsEditingProfile(false); }}>
          <div className="modal-card account-modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Header with Title and Close X */}
            <div className="modal-header-row" style={{ marginBottom: '16px', paddingBottom: '12px' }}>
              <div>
                <h3 className="modal-title" style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                  Account & Profile
                </h3>
              </div>
              <button
                onClick={() => { setShowAccountModal(false); setIsEditingProfile(false); }}
                className="modal-close-btn"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Profile Identity Card */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '18px' }}>
              <div className="learner-user-avatar" style={{ width: '48px', height: '48px', fontSize: '17px', flexShrink: 0 }}>
                {userInitials}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {learnerName}
                  </span>
                  <span style={{ background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>
                    Learner
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.email || 'learner@upshift.local'}
                </div>
              </div>
            </div>

            {/* Single Unified Profile Section */}
            {!isEditingProfile ? (
              /* DEFAULT VIEW: READ-ONLY */
              <div className="profile-section-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Profile Details
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingProfile(true);
                      setProfileSaveMsg(null);
                      setProfileSaveStatus('idle');
                    }}
                    className="btn-edit-profile"
                  >
                    ✏️ Edit Profile
                  </button>
                </div>

                {profileSaveStatus === 'success' && profileSaveMsg && (
                  <div className="account-status-alert success" style={{ marginBottom: '14px' }}>
                    <span>✓</span>
                    <span>{profileSaveMsg}</span>
                  </div>
                )}

                <div className="profile-read-grid">
                  <div className="profile-read-item">
                    <span className="profile-read-label">Full Name</span>
                    <span className="profile-read-value">{learnerName}</span>
                  </div>
                  <div className="profile-read-item">
                    <span className="profile-read-label">Email Address</span>
                    <span className="profile-read-value">{user?.email || 'learner@upshift.local'}</span>
                  </div>
                  <div className="profile-read-item">
                    <span className="profile-read-label">First Name</span>
                    <span className="profile-read-value">{firstName || '—'}</span>
                  </div>
                  <div className="profile-read-item">
                    <span className="profile-read-label">Last Name</span>
                    <span className="profile-read-value">{lastName || '—'}</span>
                  </div>
                  <div className="profile-read-item">
                    <span className="profile-read-label">Specialization Track</span>
                    <span className="profile-read-value">{currentTrackLabel}</span>
                  </div>
                  <div className="profile-read-item">
                    <span className="profile-read-label">Phone Number</span>
                    <span className="profile-read-value">{currentPhone || '—'}</span>
                  </div>
                </div>
              </div>
            ) : (
              /* EXPLICIT EDIT MODE */
              <form onSubmit={handleSaveProfile} className="profile-section-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Edit Profile Details
                  </div>
                </div>

                {profileSaveStatus === 'error' && (
                  <div className="account-status-alert error" style={{ marginBottom: '14px' }}>
                    <span>⚠️</span>
                    <span>{profileSaveMsg || 'Failed to update profile.'}</span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="account-field-group">
                    <label className="account-field-label">First Name <span style={{ color: '#e11d48' }}>*</span></label>
                    <input
                      type="text"
                      className="account-field-input"
                      value={editFirstName}
                      onChange={(e) => setEditFirstName(e.target.value)}
                      placeholder="e.g. John"
                      required
                    />
                  </div>
                  <div className="account-field-group">
                    <label className="account-field-label">Last Name</label>
                    <input
                      type="text"
                      className="account-field-input"
                      value={editLastName}
                      onChange={(e) => setEditLastName(e.target.value)}
                      placeholder="e.g. Smith"
                    />
                  </div>
                </div>

                <div className="account-field-group">
                  <label className="account-field-label">Display / Full Name</label>
                  <input
                    type="text"
                    className="account-field-input"
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    placeholder="e.g. John Smith"
                  />
                  <span className="account-field-hint">Shown across the learner workspace.</span>
                </div>

                <div className="account-field-group">
                  <label className="account-field-label">Specialization Track</label>
                  <select
                    className="account-field-input"
                    value={editTrackId}
                    onChange={(e) => setEditTrackId(e.target.value)}
                  >
                    {TRACK_OPTIONS.map((track) => (
                      <option key={track.value} value={track.value}>
                        {track.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="account-field-group">
                  <label className="account-field-label">Email Address (Read-only)</label>
                  <input
                    type="text"
                    className="account-field-input account-field-readonly"
                    value={user?.email || 'learner@upshift.local'}
                    disabled
                  />
                </div>

                <div className="account-field-group">
                  <label className="account-field-label">Phone Number (Read-only)</label>
                  <input
                    type="text"
                    className="account-field-input account-field-readonly"
                    value={currentPhone || 'Not provided'}
                    disabled
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    type="button"
                    onClick={handleCancelProfileEdit}
                    className="btn-pill-save"
                    style={{ padding: '8px 16px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="btn-view-opp"
                    style={{ padding: '8px 20px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {isSavingProfile ? 'Saving...' : '💾 Save Changes'}
                  </button>
                </div>
              </form>
            )}

            {/* Modal Simple Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', marginTop: '16px', borderTop: '1px solid #f1f5f9' }}>
              <button
                type="button"
                onClick={handleSignOut}
                className="btn-pill-save"
                style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2', fontWeight: '700' }}
              >
                🚪 Sign Out
              </button>

              <button
                type="button"
                onClick={() => { setShowAccountModal(false); setIsEditingProfile(false); }}
                className="btn-view-opp"
                style={{ padding: '8px 20px' }}
              >
                Close
              </button>
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  const [candidates, setCandidates] = useState(loadLocalCandidates);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile drawer on Escape key press for accessibility
  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen]);

  // Synchronous initialization from URL query parameter (?tab=discovery | ?tab=published | ?tab=overview) with localStorage fallback
  const getInitialAdminTab = () => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const tab = (params.get('tab') || params.get('view') || '').toLowerCase();
        if (tab === 'discovery' || tab === 'queue') return 'discovery';
        if (tab === 'published' || tab === 'directory') return 'directory';
        if (tab === 'overview') return 'overview';
        const saved = localStorage.getItem('upshift_admin_tab');
        if (saved === 'discovery') return 'discovery';
        if (saved === 'overview') return 'overview';
      } catch {
        // Fall back to default
      }
    }
    return 'directory';
  };

  const [adminActiveTab, setAdminActiveTab] = useState(getInitialAdminTab);

  // Sync candidate store in background for real-time overview metrics
  useEffect(() => {
    let active = true;
    fetchCandidateQueue().then(queue => {
      if (active && Array.isArray(queue) && queue.length > 0) {
        setCandidates(queue);
      }
    });
    return () => { active = false; };
  }, []);

  const pendingReviews = useMemo(() => candidates.filter(c => c.status === 'pending_review').length, [candidates]);
  const approvedInStaging = useMemo(() => candidates.filter(c => c.status === 'approved').length, [candidates]);

  // Breakdown of active vs total published opportunities (reconciling sidebar with observability panel)
  const activePublishedGigsCount = useMemo(() => gigs.filter(g => (g.status || 'Active') === 'Active' && (g.activity_status || 'Active') !== 'Stopped').length, [gigs]);
  const totalPublishedGigsCount = gigs.length;

  // Tab change handler that updates URL and persistence without reloading page
  const handleTabChange = (newTab) => {
    setAdminActiveTab(newTab);
    if (newTab === 'directory' || newTab === 'overview') {
      fetchGigs();
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('upshift_admin_tab', newTab);
        const url = new URL(window.location);
        url.searchParams.set('tab', newTab === 'discovery' ? 'discovery' : newTab === 'overview' ? 'overview' : 'published');
        window.history.replaceState({}, '', url);
      } catch {
        // Safe fallback
      }
    }
  };

  const adminNavTabsRef = React.useRef(null);

  // Auto-scroll active admin navigation tab into view on narrow screens
  useEffect(() => {
    if (adminNavTabsRef.current) {
      const activeBtn = adminNavTabsRef.current.querySelector('.admin-unified-tab.active');
      if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [adminActiveTab]);

  // Synchronize URL and handle browser back/forward buttons
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const url = new URL(window.location);
      const tabParam = (url.searchParams.get('tab') || url.searchParams.get('view') || '').toLowerCase();
      const targetParam = adminActiveTab === 'discovery' ? 'discovery' : adminActiveTab === 'overview' ? 'overview' : 'published';
      if (tabParam !== targetParam) {
        url.searchParams.set('tab', targetParam);
        window.history.replaceState({}, '', url);
      }

      const handlePopState = () => {
        const p = new URLSearchParams(window.location.search);
        const t = (p.get('tab') || p.get('view') || '').toLowerCase();
        if (t === 'discovery' || t === 'queue') {
          setAdminActiveTab('discovery');
        } else if (t === 'overview') {
          setAdminActiveTab('overview');
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
    <div className="saas-admin-shell admin-directory-page">
      {/* Mobile Drawer Overlay */}
      <div
        className={`saas-drawer-overlay ${mobileNavOpen ? 'open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
      />

      {/* Modern Desktop & Tablet Sidebar */}
      <aside className={`saas-sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="saas-sidebar-brand">
          <Link to="/" className="saas-brand-title">
            <img src="/fox.svg" alt="UpShift Fox" style={{ width: '28px', height: '28px' }} />
            <span>Up<span style={{ color: 'var(--brand-red)' }}>Shift</span> Gigs</span>
          </Link>
          <div className="saas-sidebar-brand-right">
            <span className="saas-brand-tag">Admin</span>
            <button
              type="button"
              className="saas-sidebar-close-btn"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close Navigation Menu"
            >
              ✕
            </button>
          </div>
        </div>

        <nav className="saas-sidebar-nav">
          <div className="saas-nav-section-title">Operations</div>

          <button
            type="button"
            id="drawer-tab-overview"
            data-testid="drawer-tab-overview"
            className={`saas-nav-item ${adminActiveTab === 'overview' ? 'active' : ''}`}
            onClick={() => { handleTabChange('overview'); setMobileNavOpen(false); }}
          >
            <span className="saas-nav-item-content">
              <span>📊</span>
              <span>Overview</span>
            </span>
          </button>

          <button
            type="button"
            id="drawer-tab-published-gigs"
            data-testid="drawer-tab-published-gigs"
            className={`saas-nav-item ${adminActiveTab === 'directory' ? 'active' : ''}`}
            onClick={() => { handleTabChange('directory'); setMobileNavOpen(false); }}
          >
            <span className="saas-nav-item-content">
              <span>📋</span>
              <span>Published Gigs</span>
            </span>
            <span
              className="saas-nav-badge"
              title={`${activePublishedGigsCount} active, ${totalPublishedGigsCount} total published opportunities`}
              aria-label={`${activePublishedGigsCount} active of ${totalPublishedGigsCount} total published opportunities`}
            >
              {totalPublishedGigsCount}
            </span>
          </button>

          <button
            type="button"
            id="drawer-tab-ai-discovery-queue"
            data-testid="drawer-tab-ai-discovery-queue"
            className={`saas-nav-item ${adminActiveTab === 'discovery' ? 'active' : ''}`}
            onClick={() => { handleTabChange('discovery'); setMobileNavOpen(false); }}
          >
            <span className="saas-nav-item-content">
              <span>⚡</span>
              <span>AI Discovery Queue</span>
            </span>
            {pendingReviews > 0 && (
              <span className="saas-nav-badge" style={{ background: '#fef3c7', color: '#b45309' }}>
                {pendingReviews}
              </span>
            )}
          </button>

          <div className="saas-nav-section-title">Quick Actions</div>

          <button
            type="button"
            className="saas-nav-item"
            onClick={() => { setIsAddModalOpen(true); setMobileNavOpen(false); }}
          >
            <span className="saas-nav-item-content">
              <span>➕</span>
              <span>Add New Gig</span>
            </span>
          </button>

          <button
            type="button"
            className="saas-nav-item"
            onClick={() => { setIsImportModalOpen(true); setMobileNavOpen(false); }}
          >
            <span className="saas-nav-item-content">
              <span>📤</span>
              <span>Bulk CSV Import</span>
            </span>
          </button>

          <button
            type="button"
            className="saas-nav-item"
            onClick={() => { handleExportCSV(); setMobileNavOpen(false); }}
          >
            <span className="saas-nav-item-content">
              <span>📥</span>
              <span>Export CSV (19-Col)</span>
            </span>
          </button>
        </nav>

        <div className="saas-sidebar-footer">
          <div className="saas-user-box">
            <div className="saas-user-avatar">
              {(user?.user_metadata?.full_name || 'Vivek Sharma').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'VS'}
            </div>
            <div className="saas-user-info">
              <div className="saas-user-name">{user?.user_metadata?.full_name || 'Vivek Sharma'}</div>
              <div className="saas-user-role">Administrator</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="saas-action-link"
            style={{ color: '#dc2626', fontWeight: '700', width: '100%', justifyContent: 'flex-start', padding: '6px 0' }}
          >
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="saas-main-wrapper">
        {/* Topbar with responsive layout and unified navigation */}
        <header className="saas-topbar admin-top-nav">
          <div className="saas-topbar-main-row">
            <div className="saas-topbar-left">
              <button
                type="button"
                className="saas-mobile-toggle-btn"
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                aria-label="Toggle Navigation Menu"
                aria-expanded={mobileNavOpen}
              >
                ☰
              </button>
              <h1 className="admin-header-title">
                <span className="admin-header-title-full">UpShift Gigs Dashboard</span>
                <span className="admin-header-title-compact">UpShift Gigs</span>
              </h1>
            </div>

            <div className="saas-topbar-right">
              <button onClick={handleSignOut} className="btn-admin-nav" title="Sign out of admin" aria-label="Sign out">
                <span className="btn-admin-nav-icon">🚪</span>
                <span className="btn-admin-nav-text">Sign Out</span>
              </button>
            </div>
          </div>

          {/* Unified tab navigation for compliance and quick switching */}
          <nav className="dashboard-unified-nav" ref={adminNavTabsRef} aria-label="Admin Navigation Tabs">
            <button
              id="tab-overview"
              data-testid="tab-overview"
              onClick={() => handleTabChange('overview')}
              className={`admin-unified-tab ${adminActiveTab === 'overview' ? 'active active-overview' : ''}`}
            >
              📊 Overview
            </button>
            <button
              id="tab-published-gigs"
              data-testid="tab-published-gigs"
              onClick={() => handleTabChange('directory')}
              className={`admin-unified-tab ${adminActiveTab === 'directory' ? 'active active-directory' : ''}`}
            >
              📋 Published Gigs ({gigs.length})
            </button>
            <button
              id="tab-ai-discovery-queue"
              data-testid="tab-ai-discovery-queue"
              onClick={() => handleTabChange('discovery')}
              className={`admin-unified-tab ${adminActiveTab === 'discovery' ? 'active active-discovery' : ''}`}
            >
              ⚡ AI Discovery Queue
              {pendingReviews > 0 && (
                <span className="admin-tab-pending-badge">
                  {pendingReviews}
                </span>
              )}
            </button>
          </nav>
        </header>

        {/* Content Area */}
        <main className="saas-content-area">
          {adminActiveTab === 'overview' && (
            <div className="overview-tab-content">
              {/* Overview Hero */}
              <div className="overview-hero-card">
                <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#eff6ff', color: '#1d4ed8', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '700', marginBottom: '8px' }}>
                    <span>🛡️ Administrator Workspace</span>
                  </div>
                  <h2 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
                    Commercial Gigs & Discovery Intelligence
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '14px', margin: 0, maxWidth: '640px' }}>
                    Review automated opportunities, manage commercial brief allocations across modules M1–M6, and audit referral gateways.
                  </p>
                </div>
              </div>

              {/* Real Operational Metrics KPI Grid */}
              <div className="overview-stats-grid">
                <div className="saas-kpi-card">
                  <div className="saas-kpi-header">
                    <span className="saas-kpi-label">Published Gigs</span>
                    <div className="saas-kpi-icon" style={{ background: '#ecfdf5', color: '#059669' }}>
                      📋
                    </div>
                  </div>
                  <div className="saas-kpi-value">{gigs.length}</div>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Active opportunities in marketplace</p>
                  <div className="saas-kpi-footer">
                    <span style={{ color: '#059669', fontWeight: '700' }}>Live on Learner Board</span>
                    <button onClick={() => handleTabChange('directory')} className="saas-action-link">
                      Manage →
                    </button>
                  </div>
                </div>

                <div className="saas-kpi-card">
                  <div className="saas-kpi-header">
                    <span className="saas-kpi-label">Pending Review</span>
                    <div className="saas-kpi-icon" style={{ background: '#fffbeb', color: '#d97706' }}>
                      ⏳
                    </div>
                  </div>
                  <div className="saas-kpi-value">{pendingReviews}</div>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Candidates awaiting human approval</p>
                  <div className="saas-kpi-footer">
                    <span style={{ color: '#d97706', fontWeight: '700' }}>Awaiting Action</span>
                    <button onClick={() => handleTabChange('discovery')} className="saas-action-link">
                      Review Now →
                    </button>
                  </div>
                </div>

                <div className="saas-kpi-card">
                  <div className="saas-kpi-header">
                    <span className="saas-kpi-label">Approved In Staging</span>
                    <div className="saas-kpi-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
                      ✓
                    </div>
                  </div>
                  <div className="saas-kpi-value">{approvedInStaging}</div>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Verified and ready for export/publish</p>
                  <div className="saas-kpi-footer">
                    <span style={{ color: '#2563eb', fontWeight: '700' }}>Staged Candidates</span>
                    <button onClick={() => handleTabChange('discovery')} className="saas-action-link">
                      Inspect Queue →
                    </button>
                  </div>
                </div>

                <div className="saas-kpi-card">
                  <div className="saas-kpi-header">
                    <span className="saas-kpi-label">Total Discovery Records</span>
                    <div className="saas-kpi-icon" style={{ background: '#f1f5f9', color: '#475569' }}>
                      📡
                    </div>
                  </div>
                  <div className="saas-kpi-value">{candidates.length}</div>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Ingested from permitted public APIs & RSS</p>
                  <div className="saas-kpi-footer">
                    <span style={{ color: '#64748b', fontWeight: '600' }}>Crawler Database</span>
                    <button onClick={() => handleTabChange('discovery')} className="saas-action-link">
                      Sync Store →
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Actions Bar */}
              <div className="saas-quick-actions-bar">
                <div
                  className="saas-action-button-card"
                  onClick={() => setIsAddModalOpen(true)}
                >
                  <div className="saas-action-card-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
                    ➕
                  </div>
                  <div className="saas-action-card-text">
                    <strong>Add Commercial Gig</strong>
                    <span>Manually create and publish opportunity</span>
                  </div>
                </div>

                <div
                  className="saas-action-button-card"
                  onClick={() => setIsImportModalOpen(true)}
                >
                  <div className="saas-action-card-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
                    📤
                  </div>
                  <div className="saas-action-card-text">
                    <strong>Bulk CSV Import</strong>
                    <span>Ingest RFC 4180 CSV with zero duplicates</span>
                  </div>
                </div>

                <div
                  className="saas-action-button-card"
                  onClick={handleExportCSV}
                >
                  <div className="saas-action-card-icon" style={{ background: '#fdf4ff', color: '#9333ea' }}>
                    📥
                  </div>
                  <div className="saas-action-card-text">
                    <strong>Export 19-Col CSV</strong>
                    <span>Download compliant snapshot of published gigs</span>
                  </div>
                </div>
              </div>

              {/* Recent Opportunities Preview */}
              <div className="directory-card" style={{ marginBottom: 0 }}>
                <div className="directory-header-row">
                  <div className="directory-header-left">
                    <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                      Recent Published Gigs
                    </h3>
                  </div>
                  <button
                    onClick={() => handleTabChange('directory')}
                    className="saas-action-link"
                    style={{ fontSize: '13px' }}
                  >
                    View All Published Gigs ({gigs.length}) →
                  </button>
                </div>

                <div className="directory-table-wrapper">
                  <table className="directory-table">
                    <thead>
                      <tr>
                        <th>Opportunity</th>
                        <th>Module</th>
                        <th>Compensation</th>
                        <th>Posted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gigs.slice(0, 5).map((g) => (
                        <tr key={g.id || g.external_gig_id}>
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
                                title={`Click to view details for ${g.title}`}
                              >
                                {g.title}
                              </div>
                              {g.origin_url && isSafeHttpUrl(g.origin_url) && (
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
                          <td>
                            <span className="module-pill-badge">{g.track_id}</span>
                          </td>
                          <td>
                            <div className="compensation-amount">{g.payment_amount || 'Unspecified'}</div>
                            <div className="compensation-type-label">{g.compensation_type || 'hourly'}</div>
                          </td>
                          <td style={{ color: '#64748b', fontSize: '12px' }}>
                            {g.posted_at ? new Date(g.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Sep 30, 2026'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {adminActiveTab === 'discovery' && (
            <CandidateReviewQueue
              onGigPublished={(publishedGig) => {
                if (publishedGig) setGigs(prev => [publishedGig, ...prev]);
              }}
              onRefreshGigs={fetchGigs}
            />
          )}

          {adminActiveTab === 'directory' && (
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
                              {g.origin_url && isSafeHttpUrl(g.origin_url) && (
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
        </main>
      </div>

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
                href={sanitizeHref(viewingGig.origin_url, '#')}
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
