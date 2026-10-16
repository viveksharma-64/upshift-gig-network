import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { LearnerDashboard, AdminDashboard } from './pages/Dashboard';

// ==========================================
// 1. AUTH CONTEXT (SUPABASE + ROLE MANAGEMENT)
// ==========================================
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Synchronously initialize state from browser storage so page refresh NEVER loses auth state
  const getInitialUser = () => {
    if (typeof window === 'undefined') return null;
    try {
      const u = localStorage.getItem('upshift_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  };

  const getInitialProfile = () => {
    if (typeof window === 'undefined') return null;
    const u = getInitialUser();
    if (!u) return null;
    // CRITICAL SECURITY FIX: Never hydrate 'admin' role from untrusted browser localStorage or user_metadata.
    // Untrusted client storage can be manipulated by users. Always initialize unverified state as 'learner' (least privilege)
    // until verified by the server-side database profiles table.
    return {
      role: 'learner',
      full_name: u?.user_metadata?.full_name || '',
    };
  };

  const [user, setUser] = useState(getInitialUser);
  const [profile, setProfile] = useState(getInitialProfile);
  const [roleVerified, setRoleVerified] = useState(false);
  const [loading, setLoading] = useState(true); // Gated loading state until session & role are verified

  // Initialize session from Supabase in background
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.user) {
          if (isMounted) {
            setUser(null);
            setProfile(null);
            setRoleVerified(false);
            setLoading(false);
            localStorage.removeItem('upshift_user');
            localStorage.removeItem('upshift_role');
            localStorage.removeItem('upshift_email');
          }
          return;
        }

        if (isMounted) {
          setUser(session.user);
          localStorage.setItem('upshift_user', JSON.stringify(session.user));
          await loadProfile(session.user);
        }
      } catch (err) {
        console.warn('Supabase session init fallback:', err.message);
        if (isMounted) {
          setRoleVerified(false);
          setLoading(false);
        }
      }
    }

    initSession();

    // Listen to auth state changes (avoid async deadlocks with Supabase internal lock)
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        localStorage.setItem('upshift_user', JSON.stringify(session.user));
        // Reset role verification until new profile is loaded
        setRoleVerified(false);
        setLoading(true);
        // Defer DB call out of the auth lock loop
        setTimeout(() => {
          loadProfile(session.user);
        }, 0);
      } else if (_event === 'SIGNED_OUT' || !session) {
        setUser(null);
        setProfile(null);
        setRoleVerified(false);
        setLoading(false);
        localStorage.removeItem('upshift_user');
        localStorage.removeItem('upshift_role');
        localStorage.removeItem('upshift_email');
      }
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Fetch role from profiles table (authenticated database source of truth)
  async function loadProfile(currentUser) {
    let p = {
      role: 'learner',
      full_name: currentUser.user_metadata?.full_name || '',
    };
    let verified = false;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

      if (!error && data?.role) {
        p = data;
        verified = true;
      } else {
        // Fail closed: if profile cannot be verified or has no role, force least-privilege learner
        p.role = 'learner';
        verified = false;
      }
    } catch (err) {
      console.warn('Error fetching profile:', err);
      p.role = 'learner';
      verified = false;
    }

    setProfile(p);
    setRoleVerified(verified);
    setLoading(false);
    localStorage.setItem('upshift_role', p.role);
    return { profile: p, verified };
  }

  // Sign in with verified database role resolution
  async function signIn(email, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;

      setUser(data.user);
      localStorage.setItem('upshift_user', JSON.stringify(data.user));
      localStorage.setItem('upshift_email', data.user.email);

      // Fetch verified database profile
      let userProfile = {
        role: 'learner',
        full_name: data.user.user_metadata?.full_name || '',
      };
      let verified = false;

      try {
        const { data: prof, error: profError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();
        if (!profError && prof?.role) {
          userProfile = prof;
          verified = true;
        }
      } catch (e) {
        console.warn('Background profile note:', e);
      }

      setProfile(userProfile);
      setRoleVerified(verified);
      setLoading(false);
      localStorage.setItem('upshift_role', userProfile.role);
      return { user: data.user, profile: userProfile, error: null };
    } catch (err) {
      // Fail closed: do not grant mock administrative access on network or fetch errors
      return { user: null, profile: null, error: err };
    }
  }

  // Sign up
  async function signUp(email, password, metadata) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: metadata }
      });
      if (error) throw error;
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  // Sign out
  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('SignOut note:', err.message);
    }
    localStorage.removeItem('upshift_user');
    localStorage.removeItem('upshift_role');
    localStorage.removeItem('upshift_email');
    setUser(null);
    setProfile(null);
    setRoleVerified(false);
    setLoading(false);
  }

  // Reset password
  async function resetPassword(email) {
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email);
      return { data, error };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  // Update profile (strictly permits learner profile fields; blocks role escalation)
  async function updateProfile(updates) {
    if (!user?.id) throw new Error('Not authenticated');

    const sanitized = { ...updates };
    delete sanitized.role;
    delete sanitized.id;
    delete sanitized.created_at;

    let updatedProfile = { ...(profile || {}), ...sanitized };

    // 1. Update public.profiles if connected
    try {
      const payload = {
        updated_at: new Date().toISOString()
      };
      if (sanitized.full_name !== undefined) payload.full_name = sanitized.full_name;
      if (sanitized.track_id !== undefined) payload.track_id = sanitized.track_id;
      if (sanitized.avatar_url !== undefined) payload.avatar_url = sanitized.avatar_url;

      const { data, error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', user.id)
        .select()
        .single();

      if (!error && data) {
        updatedProfile = { ...updatedProfile, ...data };
      }
    } catch (e) {
      console.warn('Profile DB update note:', e);
    }

    // 2. Update user_metadata in Supabase Auth
    try {
      const meta = {};
      if (sanitized.first_name !== undefined) meta.first_name = sanitized.first_name;
      if (sanitized.last_name !== undefined) meta.last_name = sanitized.last_name;
      if (sanitized.full_name !== undefined) meta.full_name = sanitized.full_name;
      if (sanitized.track_id !== undefined) meta.track_id = sanitized.track_id;

      const { data: authData, error: authError } = await supabase.auth.updateUser({
        data: meta
      });
      if (!authError && authData?.user) {
        setUser(authData.user);
        localStorage.setItem('upshift_user', JSON.stringify(authData.user));
      }
    } catch (e) {
      console.warn('Auth user_metadata update note:', e);
    }

    setProfile(updatedProfile);
    return { profile: updatedProfile };
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, roleVerified, signIn, signUp, signOut, resetPassword, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// ==========================================
// 2. PROTECTED ROUTE (BLOCKS NON-ADMINS FROM ADMIN WORKSPACE)
// ==========================================
export function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, loading, roleVerified, signOut } = useAuth();
  const location = useLocation();

  // 1. Loading gate: Never render admin content before authoritative database role verification completes
  if (loading || (requiredRole === 'admin' && !roleVerified)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#e31b23', fontWeight: '700' }}>Verifying permissions...</p>
      </div>
    );
  }

  const storedUser = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('upshift_user') || 'null') : null;
  const activeUser = user || storedUser;

  // 2. Not logged in -> redirect to login
  if (!activeUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authoritative role evaluation: require both verified flag AND role === 'admin' from trusted database profile
  const isAuthorizedAdmin = Boolean(roleVerified && profile?.role === 'admin');
  const verifiedRole = isAuthorizedAdmin ? 'admin' : 'learner';

  // 3. CRITICAL SECURITY GUARD: Block non-admins from accessing admin workspace
  if (requiredRole === 'admin' && !isAuthorizedAdmin) {
    // Clean up any stale or manipulated role in localStorage
    if (typeof window !== 'undefined' && localStorage.getItem('upshift_role') === 'admin') {
      localStorage.setItem('upshift_role', verifiedRole);
    }
    return (
      <div className="dashboard-screen learner-bg" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div className="dashboard-card learner-card" style={{ maxWidth: '520px', margin: 'auto' }}>
          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e31b23" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#e31b23', marginBottom: '8px' }}>
            Access Denied
          </h2>
          <p style={{ color: '#4b5563', fontSize: '14.5px', marginBottom: '24px', lineHeight: '1.5' }}>
            You are signed in as a <strong>Learner</strong>. You do not have permissions to access the UpShift Admin Portal.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/dashboard" className="btn-primary-red" style={{ padding: '10px 24px', display: 'inline-block' }}>
              ← Return to Learner Dashboard
            </a>
            <button
              onClick={async () => {
                await signOut();
                window.location.href = '/login';
              }}
              className="btn-pill-save"
              style={{ padding: '10px 20px' }}
            >
              Sign In as Admin
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}

// ==========================================
// 3. MAIN ROUTER
// ==========================================
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Landing, Login, and Signup */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Protected Learner Dashboard */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <LearnerDashboard />
              </ProtectedRoute>
            }
          />

          {/* Protected Admin Workspace (Strictly blocks learners) */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
