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
    const r = localStorage.getItem('upshift_role');
    const u = getInitialUser();
    if (r && u) return { role: r, full_name: u?.user_metadata?.full_name || '' };
    return null;
  };

  const [user, setUser] = useState(getInitialUser);
  const [profile, setProfile] = useState(getInitialProfile);
  const [loading, setLoading] = useState(false); // Immediate readiness, verified in background

  // Initialize session from Supabase in background
  useEffect(() => {
    async function initSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(session.user);
          localStorage.setItem('upshift_user', JSON.stringify(session.user));
          await loadProfile(session.user);
        }
      } catch (err) {
        console.warn('Supabase session init fallback:', err.message);
      }
    }

    initSession();

    // Listen to auth state changes (avoid async deadlocks with Supabase internal lock)
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        localStorage.setItem('upshift_user', JSON.stringify(session.user));
        // Defer DB call out of the auth lock loop
        setTimeout(() => {
          loadProfile(session.user);
        }, 0);
      } else {
        setUser(null);
        setProfile(null);
        localStorage.removeItem('upshift_user');
        localStorage.removeItem('upshift_role');
        localStorage.removeItem('upshift_email');
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Fetch role from profiles table (authenticated database source of truth)
  async function loadProfile(currentUser) {
    let p = {
      role: 'learner',
      full_name: currentUser.user_metadata?.full_name || '',
    };
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

      if (!error && data) {
        p = data;
      }
    } catch (err) {
      console.warn('Error fetching profile:', err);
    }
    setProfile(p);
    localStorage.setItem('upshift_role', p.role);
    return p;
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

      try {
        const { data: prof, error: profError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();
        if (!profError && prof?.role) {
          userProfile = prof;
        }
      } catch (e) {
        console.warn('Background profile note:', e);
      }

      setProfile(userProfile);
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

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, resetPassword }}>
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
  const { user, profile, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#e31b23', fontWeight: '700' }}>Verifying permissions...</p>
      </div>
    );
  }

  const storedUser = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('upshift_user') || 'null') : null;
  const activeUser = user || storedUser;

  // 1. Not logged in -> redirect to login
  if (!activeUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authoritative role evaluation from verified profile (default to 'learner')
  const verifiedRole = profile?.role || 'learner';

  // 2. CRITICAL SECURITY GUARD: Block non-admins from accessing admin workspace
  if (requiredRole === 'admin' && verifiedRole !== 'admin') {
    // Clean up any stale or manipulated role in localStorage
    if (typeof window !== 'undefined' && localStorage.getItem('upshift_role') === 'admin') {
      localStorage.setItem('upshift_role', verifiedRole);
    }
    return (
      <div className="dashboard-screen learner-bg" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div className="dashboard-card learner-card" style={{ maxWidth: '520px', margin: 'auto' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🚫</div>
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
