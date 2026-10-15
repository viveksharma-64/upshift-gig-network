import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';

const ALL_INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry"
];

const COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "United Arab Emirates",
  "Singapore",
  "Germany",
  "Other"
];

export default function Signup() {
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const [step, setStep] = useState(1); // 1, 2, or 3
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    password: '',
    gender: 'Male',
    street: '',
    city: '',
    district: '',
    state: 'Maharashtra',
    postalCode: '',
    country: 'India',
    currentStatus: 'Student',
    institution: '',
    degree: '',
    branch: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Dynamic labels & placeholders based on user role/status
  const getDynamicLabels = () => {
    switch (formData.currentStatus) {
      case 'Working Professional':
        return {
          institutionLabel: 'Current Organization / Company',
          institutionPlaceholder: 'e.g. Infosys, TCS, Startup, etc.',
          degreeLabel: 'Designation / Highest Degree',
          degreePlaceholder: 'e.g. Software Engineer / B.Tech',
          branchLabel: 'Domain / Specialization',
          branchPlaceholder: 'e.g. AI Engineering, Fullstack, Cloud',
        };
      case 'Freelancer / Self-Employed':
        return {
          institutionLabel: 'Brand / Agency / Workplace',
          institutionPlaceholder: 'e.g. Freelance, Self-Employed, Studio',
          degreeLabel: 'Primary Service / Qualification',
          degreePlaceholder: 'e.g. AI Content Creator, Web Developer',
          branchLabel: 'Niche / Expertise',
          branchPlaceholder: 'e.g. Video Production, Automation, SEO',
        };
      case 'Looking for Opportunities':
        return {
          institutionLabel: 'Last Academic Institution or Workplace',
          institutionPlaceholder: 'e.g. University or previous company',
          degreeLabel: 'Highest Qualification',
          degreePlaceholder: 'e.g. B.Tech, BCA, B.Sc, MBA',
          branchLabel: 'Core Skills / Specialization',
          branchPlaceholder: 'e.g. Python, AI Tools, Graphic Design',
        };
      default: // Student
        return {
          institutionLabel: 'Academic Institution / College',
          institutionPlaceholder: 'e.g. IIT Bombay, Delhi University',
          degreeLabel: 'Course / Degree',
          degreePlaceholder: 'e.g. B.Tech / BCA / B.Com',
          branchLabel: 'Branch / Specialization',
          branchPlaceholder: 'e.g. Computer Science, AI, Design',
        };
    }
  };

  const dynamicLabels = getDynamicLabels();

  // Validate Step 1
  const validateStep1 = () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('Please provide both First Name and Last Name.');
      return false;
    }
    if (!formData.phone.trim()) {
      setError('Please provide your WhatsApp Phone Number.');
      return false;
    }
    if (!formData.email.trim() || !formData.email.includes('@')) {
      setError('Please provide a valid email address.');
      return false;
    }
    if (!formData.street.trim() || !formData.city.trim() || !formData.district.trim() || !formData.postalCode.trim()) {
      setError('Please complete all Address Details.');
      return false;
    }
    return true;
  };

  // Validate Step 2
  const validateStep2 = () => {
    if (!formData.institution.trim()) {
      setError(`Please provide your ${dynamicLabels.institutionLabel}.`);
      return false;
    }
    if (!formData.degree.trim()) {
      setError(`Please provide your ${dynamicLabels.degreeLabel}.`);
      return false;
    }
    if (!formData.branch.trim()) {
      setError(`Please provide your ${dynamicLabels.branchLabel}.`);
      return false;
    }
    return true;
  };

  const handleNext = (e) => {
    e.preventDefault();
    setError('');

    if (step === 1) {
      if (validateStep1()) {
        setStep(2);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else if (step === 2) {
      if (validateStep2()) {
        setStep(3);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  const handleBack = () => {
    setError('');
    setStep(prev => Math.max(1, prev - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveDraft = () => {
    try {
      localStorage.setItem('upshift_enrollment_draft', JSON.stringify(formData));
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch {
      alert('Draft saved locally in browser!');
    }
  };

  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      const fullName = `${formData.firstName} ${formData.lastName}`.trim();
      const { data, error: signupError } = await signUp(formData.email, formData.password, {
        full_name: fullName,
        role: 'learner',
        phone: formData.phone,
        gender: formData.gender,
        street: formData.street,
        city: formData.city,
        district: formData.district,
        state: formData.state,
        postal_code: formData.postalCode,
        country: formData.country,
        current_status: formData.currentStatus,
        institution: formData.institution,
        degree: formData.degree,
        branch: formData.branch,
      });

      if (signupError) {
        setError(signupError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      localStorage.removeItem('upshift_enrollment_draft');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message || 'Enrollment registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="enrollment-wrapper">
      {/* TOP BAR */}
      <header className="enrollment-top-bar">
        <Link to="/" className="enrollment-brand">
          <span style={{ fontSize: '18px' }}>🦊</span>
          <span style={{ color: '#e31b23' }}>The AI SCHOOL</span>
          <span style={{ color: '#94a3b8' }}>/</span>
          <span>UpShift</span>
        </Link>
        <div className="enrollment-top-right">
          Already registered? <Link to="/login">SIGN IN →</Link>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="enrollment-content-area">
        <Link to="/" className="enrollment-back-btn">
          ← Back to UpShift
        </Link>

        <div>
          <div className="enrollment-header-badge">
            <span style={{ color: '#e31b23' }}>●</span> UpShift · ENROLLMENT
          </div>
          <h1 className="enrollment-page-title">AI UpShift Enrollment</h1>
          <p className="enrollment-subtitle">
            Complete your registration and secure enrollment below. Powered by The AI SCHOOL.
          </p>
        </div>

        {/* ENROLLMENT CARD */}
        <div className="enrollment-card-container">
          <div className="enrollment-card-hero">
            <h2 className="enrollment-card-title">START YOUR UpShift JOURNEY</h2>
            <p className="enrollment-card-sub">
              {step === 1 && 'Step 1: Tell us about your personal and contact details'}
              {step === 2 && 'Step 2: Tell us about your academic or professional background'}
              {step === 3 && 'Step 3: Set your login password to complete registration'}
            </p>
          </div>

          {savedNotice && (
            <div className="alert-message alert-success">
              ✓ Progress saved to your browser session!
            </div>
          )}

          {error && <div className="alert-message alert-error">{error}</div>}

          {success ? (
            <div className="alert-message alert-success" style={{ textAlign: 'center', padding: '24px' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🎉</div>
              <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>
                Enrollment Completed Successfully!
              </h3>
              <p style={{ color: '#065f46', fontSize: '14px', marginBottom: '18px' }}>
                Your account is ready and verified. You can now sign in to your UpShift workspace.
              </p>
              <button onClick={() => navigate('/login')} className="btn-pill-next">
                Go to Sign In →
              </button>
            </div>
          ) : (
            <div>
              {/* STEP 1: PERSONAL INFORMATION & ADDRESS */}
              {step === 1 && (
                <form onSubmit={handleNext}>
                  <div className="form-section-title">PERSONAL INFORMATION</div>

                  {/* Name */}
                  <div className="form-group">
                    <label className="form-label">Name <span style={{ color: '#e31b23' }}>*</span></label>
                    <div className="field-grid-2">
                      <div>
                        <div className="input-with-icon-wrap">
                          <span className="input-icon-prefix">👤</span>
                          <input
                            type="text"
                            name="firstName"
                            required
                            placeholder="John"
                            value={formData.firstName}
                            onChange={handleChange}
                            className="input-box input-iconic"
                          />
                        </div>
                        <span className="field-sublabel">First Name</span>
                      </div>
                      <div>
                        <input
                          type="text"
                          name="lastName"
                          required
                          placeholder="Smith"
                          value={formData.lastName}
                          onChange={handleChange}
                          className="input-box"
                        />
                        <span className="field-sublabel">Last Name</span>
                      </div>
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="form-group">
                    <label className="form-label">Phone(WhatsApp Number) <span style={{ color: '#e31b23' }}>*</span></label>
                    <div className="input-with-icon-wrap">
                      <span className="input-icon-prefix">📱</span>
                      <input
                        type="tel"
                        name="phone"
                        required
                        placeholder="+91 98765 43210"
                        value={formData.phone}
                        onChange={handleChange}
                        className="input-box input-iconic"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div className="form-group">
                    <label className="form-label">Email <span style={{ color: '#e31b23' }}>*</span></label>
                    <div className="input-with-icon-wrap">
                      <span className="input-icon-prefix">✉️</span>
                      <input
                        type="email"
                        name="email"
                        required
                        placeholder="name@college.edu or name@company.com"
                        value={formData.email}
                        onChange={handleChange}
                        className="input-box input-iconic"
                      />
                    </div>
                  </div>

                  {/* Gender */}
                  <div className="form-group">
                    <label className="form-label">Gender <span style={{ color: '#e31b23' }}>*</span></label>
                    <div className="gender-options">
                      {['Male', 'Female', 'Other'].map(g => (
                        <label key={g} className="radio-item">
                          <input
                            type="radio"
                            name="gender"
                            value={g}
                            checked={formData.gender === g}
                            onChange={handleChange}
                          />
                          <span>{g}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Address Details */}
                  <div className="form-group">
                    <label className="form-label">Address Details <span style={{ color: '#e31b23' }}>*</span></label>
                    
                    <div style={{ marginBottom: '12px' }}>
                      <input
                        type="text"
                        name="street"
                        required
                        placeholder="123 Innovation Street, Sector 4"
                        value={formData.street}
                        onChange={handleChange}
                        className="input-box"
                      />
                      <span className="field-sublabel">Street / Locality</span>
                    </div>

                    <div style={{ marginBottom: '12px' }}>
                      <input
                        type="text"
                        name="city"
                        required
                        placeholder="Mumbai"
                        value={formData.city}
                        onChange={handleChange}
                        className="input-box"
                      />
                      <span className="field-sublabel">City</span>
                    </div>

                    <div className="field-grid-2" style={{ marginBottom: '12px' }}>
                      <div>
                        <input
                          type="text"
                          name="district"
                          required
                          placeholder="Mumbai Suburban"
                          value={formData.district}
                          onChange={handleChange}
                          className="input-box"
                        />
                        <span className="field-sublabel">District</span>
                      </div>
                      <div>
                        {/* ALL INDIAN STATES (NO "OTHER") */}
                        <select
                          name="state"
                          value={formData.state}
                          onChange={handleChange}
                          className="input-box"
                          required
                        >
                          {ALL_INDIAN_STATES.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <span className="field-sublabel">State</span>
                      </div>
                    </div>

                    <div className="field-grid-2">
                      <div>
                        <input
                          type="text"
                          name="postalCode"
                          required
                          placeholder="400001"
                          value={formData.postalCode}
                          onChange={handleChange}
                          className="input-box"
                        />
                        <span className="field-sublabel">Postal / Zip Code</span>
                      </div>
                      <div>
                        {/* EDITABLE COUNTRY DROPDOWN */}
                        <select
                          name="country"
                          value={formData.country}
                          onChange={handleChange}
                          className="input-box"
                        >
                          {COUNTRIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <span className="field-sublabel">Country (Editable)</span>
                      </div>
                    </div>
                  </div>

                  {/* FOOTER 1/3 */}
                  <div className="enrollment-button-footer">
                    <button
                      type="button"
                      className="btn-pill-save"
                      onClick={handleSaveDraft}
                    >
                      Save
                    </button>
                    <button
                      type="submit"
                      className="btn-pill-next"
                    >
                      Next →
                    </button>
                    <span className="page-step-indicator">1/3</span>
                  </div>
                </form>
              )}

              {/* STEP 2: ACADEMIC & BACKGROUND */}
              {step === 2 && (
                <form onSubmit={handleNext}>
                  <div className="form-section-title">ACADEMIC & BACKGROUND</div>

                  <div className="form-group">
                    <label className="form-label">Current Status <span style={{ color: '#e31b23' }}>*</span></label>
                    <select
                      name="currentStatus"
                      value={formData.currentStatus}
                      onChange={handleChange}
                      className="input-box"
                    >
                      <option value="Student">Student</option>
                      <option value="Working Professional">Working Professional</option>
                      <option value="Freelancer / Self-Employed">Freelancer / Self-Employed</option>
                      <option value="Looking for Opportunities">Looking for Opportunities</option>
                    </select>
                  </div>

                  {/* Dynamically adapted fields for students vs professionals */}
                  <div className="form-group">
                    <label className="form-label">
                      {dynamicLabels.institutionLabel} <span style={{ color: '#e31b23' }}>*</span>
                    </label>
                    <div className="input-with-icon-wrap">
                      <span className="input-icon-prefix">🏛️</span>
                      <input
                        type="text"
                        name="institution"
                        required
                        placeholder={dynamicLabels.institutionPlaceholder}
                        value={formData.institution}
                        onChange={handleChange}
                        className="input-box input-iconic"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      {dynamicLabels.degreeLabel} <span style={{ color: '#e31b23' }}>*</span>
                    </label>
                    <div className="input-with-icon-wrap">
                      <span className="input-icon-prefix">🎓</span>
                      <input
                        type="text"
                        name="degree"
                        required
                        placeholder={dynamicLabels.degreePlaceholder}
                        value={formData.degree}
                        onChange={handleChange}
                        className="input-box input-iconic"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      {dynamicLabels.branchLabel} <span style={{ color: '#e31b23' }}>*</span>
                    </label>
                    <div className="input-with-icon-wrap">
                      <span className="input-icon-prefix">📚</span>
                      <input
                        type="text"
                        name="branch"
                        required
                        placeholder={dynamicLabels.branchPlaceholder}
                        value={formData.branch}
                        onChange={handleChange}
                        className="input-box input-iconic"
                      />
                    </div>
                  </div>

                  {/* FOOTER 2/3 */}
                  <div className="enrollment-button-footer">
                    <button
                      type="button"
                      className="btn-pill-save"
                      onClick={handleBack}
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      className="btn-pill-save"
                      onClick={handleSaveDraft}
                    >
                      Save
                    </button>
                    <button
                      type="submit"
                      className="btn-pill-next"
                    >
                      Next →
                    </button>
                    <span className="page-step-indicator">2/3</span>
                  </div>
                </form>
              )}

              {/* STEP 3: ACCOUNT CREDENTIALS & SUBMIT */}
              {step === 3 && (
                <form onSubmit={handleFinalSubmit}>
                  <div className="form-section-title">ACCOUNT SETUP & SECURITY</div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', marginBottom: '20px' }}>
                    <p style={{ fontSize: '13.5px', color: '#334155', fontWeight: '600' }}>
                      📋 Enrollment Summary
                    </p>
                    <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                      Enrolling as <strong>{formData.firstName} {formData.lastName}</strong> ({formData.email}) · Status: <strong>{formData.currentStatus}</strong>
                    </p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Set Account Password <span style={{ color: '#e31b23' }}>*</span></label>
                    <input
                      type="password"
                      name="password"
                      required
                      placeholder="At least 6 characters"
                      value={formData.password}
                      onChange={handleChange}
                      className="input-box"
                      autoFocus
                    />
                    <span className="field-sublabel">You will use this password to sign in at /login</span>
                  </div>

                  {/* FOOTER 3/3 */}
                  <div className="enrollment-button-footer">
                    <button
                      type="button"
                      className="btn-pill-save"
                      onClick={handleBack}
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-pill-next"
                      style={{ background: '#e31b23' }}
                    >
                      {loading ? 'Submitting...' : 'Complete Enrollment ✓'}
                    </button>
                    <span className="page-step-indicator">3/3</span>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
