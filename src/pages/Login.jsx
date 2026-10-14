import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { supabase } from '../lib/supabase';

export default function Login() {
  const navigate = useNavigate();
  const { signIn, signOut, resetPassword } = useAuth();

  const [roleTab, setRoleTab] = useState('learner'); // 'learner' or 'admin'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isForgot, setIsForgot] = useState(false);

  // Instant role check helper with timeout protection
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Authenticate with Supabase credentials
      const { user, profile, error: authError } = await signIn(email, password);

      if (authError || !user) {
        setError(authError?.message || 'Invalid email or password. Please check your credentials.');
        setLoading(false);
        return;
      }

      // 2. Verified post-authentication role check from database
      const userRole = profile?.role || 'learner';

      if (roleTab === 'admin' && userRole !== 'admin') {
        localStorage.removeItem('upshift_role');
        await signOut();
        setError('⛔ Access Denied: This account has Learner permissions. You cannot log in through the Admin portal. Please switch to the Learner Login tab.');
        setLoading(false);
        return;
      }

      if (roleTab === 'learner' && userRole === 'admin') {
        localStorage.removeItem('upshift_role');
        await signOut();
        setError('⛔ Access Denied: This account has Administrator privileges. Please switch to the Admin Login tab to access the Admin workspace.');
        setLoading(false);
        return;
      }

      // 3. Store verified role in storage and route accordingly
      localStorage.setItem('upshift_role', userRole);

      if (userRole === 'admin') {
        navigate('/admin', { replace: true });
        window.location.assign('/admin');
      } else {
        navigate('/dashboard', { replace: true });
        window.location.assign('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Failed to sign in.');
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email) {
      setError('Please provide your email address first.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { error: resetErr } = await resetPassword(email);
      if (resetErr) {
        setError(resetErr.message);
      } else {
        setSuccessMsg('Password reset instructions sent to your email.');
      }
    } catch (err) {
      setError(err.message || 'Failed to send recovery email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        {/* Brand Logo */}
        <h2 className="auth-logo-title">
          Up<span className="brand-red">Shift</span>
        </h2>
        <p className="auth-sub-brand">THE AI SCHOOL / WORKSPACE</p>

        {/* ADMIN vs LEARNER ROLE SWITCHER */}
        <div className="role-tabs">
          <button
            type="button"
            className={`role-tab-btn ${roleTab === 'learner' ? 'active' : ''}`}
            onClick={() => { setRoleTab('learner'); setError(''); }}
          >
            🎓 Learner Login
          </button>
          <button
            type="button"
            className={`role-tab-btn ${roleTab === 'admin' ? 'active admin-active' : ''}`}
            onClick={() => { setRoleTab('admin'); setError(''); }}
          >
            🛡️ Admin Login
          </button>
        </div>

        {!isForgot ? (
          <>
            <h1 className="auth-page-title">Sign In</h1>
            <p className="auth-desc">
              {roleTab === 'admin'
                ? 'Access the UpShift administrative workspace.'
                : 'Access your UpShift learner workspace.'}
            </p>

            {error && (
              <div className="alert-message alert-error" style={{ lineHeight: '1.5', fontWeight: '500' }}>
                {error}
              </div>
            )}
            {successMsg && <div className="alert-message alert-success">{successMsg}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder={roleTab === 'admin' ? 'admin@theaischool.co' : 'name@college.edu or name@company.com'}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  className="input-box"
                />
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label className="form-label">Password</label>
                  <span onClick={() => { setIsForgot(true); setError(''); }} className="link-forgot">
                    Forgot password?
                  </span>
                </div>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError('');
                    }}
                    className="input-box"
                  />
                  <button
                    type="button"
                    className="btn-toggle-eye"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-submit-red">
                {loading ? 'Signing In...' : 'Sign In →'}
              </button>
            </form>

            <div className="auth-bottom-switch">
              NEW TO UpShift? <Link to="/signup">GET STARTED →</Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="auth-page-title">Reset Password</h1>
            <p className="auth-desc">Enter your email address to receive recovery instructions.</p>

            {error && <div className="alert-message alert-error">{error}</div>}
            {successMsg && <div className="alert-message alert-success">{successMsg}</div>}

            <form onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="name@college.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-box"
                />
              </div>

              <button type="submit" disabled={loading} className="btn-submit-red">
                {loading ? 'Sending...' : 'Send Recovery Email →'}
              </button>
            </form>

            <div className="auth-bottom-switch">
              <button type="button" onClick={() => { setIsForgot(false); setError(''); }}>
                ← Back to Sign In
              </button>
            </div>
          </>
        )}
      </div>

      <Link to="/" className="back-home-link">
        ← Back to UpShift Home
      </Link>

      <p className="auth-footer">
        UPSHIFT · THE AI SCHOOL © 2026 · ALL RIGHTS RESERVED
      </p>
    </div>
  );
}
