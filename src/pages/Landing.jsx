import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div>
      {/* FLOATING PILL NAVBAR */}
      <header className="navbar-wrapper">
        <nav className="navbar">
          <Link to="/" className="nav-brand">
            <span className="fox-badge">🦊</span>
            <span>The AI SCHOOL | UpShift</span>
          </Link>

          <ul className="nav-links">
            <li><a href="#programs">Programs</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#stories">Our Stories</a></li>
            <li><a href="#opportunities">Opportunities</a></li>
            <li><a href="#partners">Partners</a></li>
          </ul>

          <div className="nav-actions">
            <Link to="/login" className="btn-nav-login">LOGIN</Link>
            <Link to="/signup" className="btn-nav-getstarted">
              GET STARTED <span>↗</span>
            </Link>
          </div>
        </nav>
      </header>

      {/* HERO SECTION */}
      <section className="hero-section">
        <div className="hero-container">
          {/* Left Text */}
          <div className="hero-content">
            <h1 className="hero-title">
              YOU KNOW <span className="red-text">AI.</span><br />
              NOW MAKE IT<br />
              EARN FOR<br />
              <span className="red-text">YOU.</span>
            </h1>

            <p className="hero-description">
              Build practical AI skills. Create real outcomes and Start earning through digital gigs, transforming local businesses into AI-native businesses, and building AI-powered ventures.
            </p>

            <div className="hero-cta-group">
              <button onClick={() => navigate('/signup')} className="btn-primary-red">
                HOW UPSHIFT WORKS →
              </button>
              <a href="#programs" className="btn-outline-white">
                EXPLORE PROGRAMS ↓
              </a>
            </div>
          </div>

          {/* Right Visual with Mascot SVG */}
          <div className="hero-visual">
            <div className="mascot-svg-wrapper">
              <span className="handwritten-tag">A Bigger<br />You</span>
              {/* Fox mascot loaded as SVG with automatic fallback */}
              <img
                src="/fox.svg"
                alt="UpShift Fox Mascot"
                className="mascot-svg-image"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = '/mascot.webp';
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* SIX TRACKS OVERVIEW */}
      <section id="programs" style={{ padding: '80px 24px', background: '#faf8f5', color: '#111827', textAlign: 'center' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p style={{ color: '#e31b23', fontWeight: '700', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '8px' }}>
            ● Opportunity Modules
          </p>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '36px', fontWeight: '800', marginBottom: '32px' }}>
            Six Tracks to Monetize AI Skills
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            {[
              { id: 'M1', title: 'AI Video / Reels', desc: 'Short-form video, reels generation, AI editing and viral production.' },
              { id: 'M2', title: 'AI Design / Visual', desc: 'Brand assets, image synthesis, visual campaigns and graphics.' },
              { id: 'M3', title: 'AI Data & Evaluation', desc: 'RLHF feedback, data annotation, AI quality testing and evaluation.' },
              { id: 'M4', title: 'AI Coding & Web Dev', desc: 'AI-assisted fullstack software, agents, web apps and scripting.' },
              { id: 'M5', title: 'AI Marketing & Growth', desc: 'Social content engines, SEO automation, copy and growth systems.' },
              { id: 'M6', title: 'AI Automation & Agents', desc: 'n8n, Make, Zapier, custom bots and autonomous workflows.' },
            ].map(m => (
              <div key={m.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '24px', textAlign: 'left', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <span style={{ background: '#fef2f2', color: '#e31b23', fontWeight: '800', fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}>{m.id}</span>
                <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '10px 0 6px' }}>{m.title}</h3>
                <p style={{ fontSize: '13.5px', color: '#6b7280', lineHeight: '1.5' }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
