import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing-page-root">
      {/* FLOATING PILL NAVBAR */}
      <header className="landing-navbar-wrapper">
        <nav className="landing-navbar">
          <Link to="/" className="landing-nav-brand">
            <img src="/fox.svg" alt="UpShift Logo" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
            <span>The AI SCHOOL | UpShift</span>
          </Link>

          <ul className="landing-nav-links">
            <li><a href="#programs">Programs</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#stories">Our Stories</a></li>
            <li><a href="#opportunities">Opportunities</a></li>
            <li><a href="#partners">Partners</a></li>
          </ul>

          <div className="landing-nav-actions">
            <Link to="/login" className="btn-landing-nav-login">WORKSPACE</Link>
            <Link to="/signup" className="btn-landing-nav-getstarted">
              GET STARTED <span>↗</span>
            </Link>
          </div>
        </nav>
      </header>

      {/* HERO SECTION */}
      <section className="landing-hero-section">
        {/* Subtle top spotlight beam onto fox mascot */}
        <div className="landing-hero-spotlight" aria-hidden="true" />

        <div className="landing-hero-container">
          {/* Left Text */}
          <div className="landing-hero-content">
            <h1 className="landing-hero-title">
              YOU KNOW <span className="red-text">AI.</span><br />
              NOW MAKE IT<br />
              EARN FOR<br />
              <span className="red-text">YOU.</span>
            </h1>

            <p className="landing-hero-description">
              Build practical AI skills. Create real outcomes and Start earning through digital gigs, transforming local businesses into AI-native businesses, and building AI-powered ventures.
            </p>

            <div className="landing-hero-cta-group">
              <button onClick={() => navigate('/signup')} className="btn-landing-primary-red">
                HOW UPSHIFT WORKS →
              </button>
              <a href="#programs" className="btn-landing-outline-white">
                EXPLORE PROGRAMS ↓
              </a>
            </div>
          </div>

          {/* Right Visual with Mascot */}
          <div className="landing-hero-visual">
            <div className="landing-mascot-wrapper">
              <span className="landing-handwritten-tag">A Bigger<br />You</span>
              <img
                src="/mascot.webp"
                alt="UpShift Fox Mascot"
                className="landing-mascot-image"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = '/fox.svg';
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* SIX TRACKS OVERVIEW */}
      <section id="programs" className="landing-tracks-section">
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p className="landing-tracks-badge">
            ● Opportunity Modules
          </p>
          <h2 className="landing-tracks-title">
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
              <div key={m.id} className="landing-track-card">
                <span className="landing-track-id">{m.id}</span>
                <h3 className="landing-track-heading">{m.title}</h3>
                <p className="landing-track-desc">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
