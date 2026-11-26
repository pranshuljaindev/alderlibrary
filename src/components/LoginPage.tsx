import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  Home,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError, apiRequest, setAccessToken } from '../lib/api';
import { checkBackendHealth } from '../lib/connectionStatus';
import type { BootstrapStatus, User, UserRole } from '../types';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { LibraryAtmosphere } from './LibraryAtmosphere';
import { LibraryLogo } from './LibraryLogo';

interface LoginPageProps {
  bootstrapStatus: BootstrapStatus;
  sessionNotice: string | null;
  onClearSessionNotice: () => void;
  onAuthSuccess: (user: User) => void;
  onBootstrapComplete: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

type PortalStep = 'home' | 'form';
type AuthViewMode = 'login' | 'register' | 'forgot';
type ResetStep = 'request' | 'complete';

export function LoginPage({
  bootstrapStatus,
  sessionNotice,
  onClearSessionNotice,
  onAuthSuccess,
  onBootstrapComplete,
  onNotify,
}: LoginPageProps) {
  const [portalStep, setPortalStep] = useState<PortalStep>('home');
  const [loginPortal, setLoginPortal] = useState<UserRole>('student');
  const [viewMode, setViewMode] = useState<AuthViewMode>('login');
  const [resetStep, setResetStep] = useState<ResetStep>('request');

  // Standard login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // First-run admin bootstrap state
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupDepartment, setSetupDepartment] = useState('Library Administration');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [showSetupPassword, setShowSetupPassword] = useState(false);

  // Student self-registration state
  const [regName, setRegName] = useState('');
  const [regStudentId, setRegStudentId] = useState('');
  const [regDepartment, setRegDepartment] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Forgot / reset password state
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  // UI feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showAdminBootstrap =
    portalStep === 'form' &&
    loginPortal === 'admin' &&
    bootstrapStatus.needsAdminSetup &&
    viewMode === 'login';

  // Bounded live backend health check for status indicator
  useEffect(() => {
    void checkBackendHealth();
  }, []);

  function openPortal(portal: UserRole) {
    setLoginPortal(portal);
    setPortalStep('form');
    setViewMode('login');
    setErrorMsg(null);
    setSuccessMsg(null);
    onClearSessionNotice();
  }

  function returnToHome() {
    setPortalStep('home');
    setViewMode('login');
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  function validatePasswordClient(pw: string): string | null {
    if (pw.length < 8) return 'Password must be at least 8 characters long.';
    if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
      return 'Password must contain uppercase, lowercase, and at least one number.';
    }
    return null;
  }

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    onClearSessionNotice();

    const trimmedId = identifier.trim();
    if (!trimmedId) {
      setErrorMsg(
        loginPortal === 'admin'
          ? 'Please enter your staff email address.'
          : 'Please enter your Student ID or email address.'
      );
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ accessToken: string; user: User }>('/api/auth/login', {
        method: 'POST',
        skipAuthHandling: true,
        body: JSON.stringify({
          identifier: trimmedId,
          password,
          loginPortal,
          rememberMe,
        }),
      });

      setAccessToken(res.accessToken);
      onNotify('success', `Welcome back, ${res.user.fullName}.`);
      onAuthSuccess(res.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Unable to sign in right now. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBootstrapSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (setupName.trim().length < 2) {
      setErrorMsg('Please enter the primary administrator full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setupEmail.trim())) {
      setErrorMsg('Please enter a valid institutional email address.');
      return;
    }
    const pwErr = validatePasswordClient(setupPassword);
    if (pwErr) {
      setErrorMsg(pwErr);
      return;
    }
    if (setupPassword !== setupConfirm) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ accessToken: string; user: User }>('/api/auth/bootstrap-admin', {
        method: 'POST',
        skipAuthHandling: true,
        body: JSON.stringify({
          fullName: setupName.trim(),
          email: setupEmail.trim(),
          department: setupDepartment.trim(),
          password: setupPassword,
        }),
      });

      setAccessToken(res.accessToken);
      onBootstrapComplete();
      onNotify('success', 'Primary administrator account initialized.');
      onAuthSuccess(res.user);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Unable to initialize administrator account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegisterSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (regName.trim().length < 2) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (!/^[A-Za-z0-9-]{4,24}$/.test(regStudentId.trim())) {
      setErrorMsg('Student ID must be 4–24 alphanumeric characters or hyphens (e.g. STU-2026-0142).');
      return;
    }
    if (regDepartment.trim().length < 2) {
      setErrorMsg('Please enter your academic department.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) {
      setErrorMsg('Please enter a valid university email address.');
      return;
    }
    const pwErr = validatePasswordClient(regPassword);
    if (pwErr) {
      setErrorMsg(pwErr);
      return;
    }
    if (regPassword !== regConfirm) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/register-student', {
        method: 'POST',
        skipAuthHandling: true,
        body: JSON.stringify({
          fullName: regName.trim(),
          studentId: regStudentId.trim().toUpperCase(),
          department: regDepartment.trim(),
          email: regEmail.trim(),
          password: regPassword,
        }),
      });

      setSuccessMsg(res.message);
      setRegName('');
      setRegStudentId('');
      setRegDepartment('');
      setRegEmail('');
      setRegPassword('');
      setRegConfirm('');
      onNotify('info', 'Student registration request submitted for librarian approval.');
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Unable to submit registration request.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!forgotIdentifier.trim()) {
      setErrorMsg('Please enter your registered email address or Student ID.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        skipAuthHandling: true,
        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
      });
      setSuccessMsg(res.message);
      setResetStep('complete');
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Unable to submit password reset request.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetCompleteSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!forgotIdentifier.trim() || !resetCode.trim()) {
      setErrorMsg('Please provide your Email / Student ID and one-time verification code.');
      return;
    }
    const pwErr = validatePasswordClient(resetNewPassword);
    if (pwErr) {
      setErrorMsg(pwErr);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        skipAuthHandling: true,
        body: JSON.stringify({
          identifier: forgotIdentifier.trim(),
          resetCode: resetCode.trim().toUpperCase(),
          newPassword: resetNewPassword,
        }),
      });
      setSuccessMsg(res.message);
      setResetCode('');
      setResetNewPassword('');
      setViewMode('login');
      setIdentifier(forgotIdentifier.trim());
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Unable to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const isAdmin = loginPortal === 'admin';
  const focusClass = isAdmin && viewMode === 'login' ? 'dark-glass-input-gold' : 'dark-glass-input-blue';

  return (
    <div className="relative min-h-screen w-full bg-[#0B1220] text-[#F5F3EE] flex flex-col justify-between overflow-x-hidden">
      {/* Layered Illustrated Library Background + Floating Academic Elements */}
      <LibraryAtmosphere />

      {/* Top Navigation Bar (Single-Row 3-Zone Contract) */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 pt-5 pb-3 flex items-center justify-between gap-6">
        <button
          type="button"
          onClick={returnToHome}
          className="inline-flex items-center gap-2 text-xs font-medium text-[#F5F3EE]/80 hover:text-[#D6AD60] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1.5"
        >
          <Home className="w-3.5 h-3.5 text-[#D6AD60]" aria-hidden="true" />
          <span>Back to Home</span>
        </button>

        {/* Live Backend Connection Status */}
        <div className="hidden sm:flex items-center">
          <ConnectionStatusBadge onRetryComplete={onBootstrapComplete} />
        </div>

        {/* Secure Login Indicator */}
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D6AD60] whitespace-nowrap shrink-0">
          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Secure Login</span>
        </div>
      </header>

      {/* Main Centered Login Focal Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-6 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[540px] mx-auto space-y-6"
        >
          {/* Editorial University Library Branding Header */}
          <div className="text-center flex flex-col items-center">
            <LibraryLogo
              variant="gold"
              size="xl"
              showSubtitle
              serifTitle
              name="SMART LIBRARY"
              subtitle="Your Gateway to Knowledge"
            />
            <div className="mt-4 h-px w-40 bg-gradient-to-r from-transparent via-[#D6AD60]/60 to-transparent" />
          </div>

          {/* Glassmorphism Login Panel */}
          <motion.section
            layout
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            aria-label="Smart Library Authentication"
            className="smart-glass-panel rounded-2xl p-6 sm:p-8"
          >
            {/* Global Alerts (Session Expiry, Errors, Successes) */}
            <AnimatePresence mode="wait">
              {sessionNotice && (
                <motion.div
                  key="session-notice"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  role="alert"
                  className="mb-5 flex items-start gap-2.5 rounded-xl border border-[#D6AD60]/40 bg-[#D6AD60]/10 px-4 py-3 text-sm text-[#F5F3EE]"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[#D6AD60]" aria-hidden="true" />
                  <span>{sessionNotice}</span>
                </motion.div>
              )}

              {errorMsg && (
                <motion.div
                  key="error-msg"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  role="alert"
                  className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-400/40 bg-red-950/55 px-4 py-3 text-sm text-red-100"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
                  <span>{errorMsg}</span>
                </motion.div>
              )}

              {successMsg && (
                <motion.div
                  key="success-msg"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  role="status"
                  className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-400/40 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-100"
                >
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>{successMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {/* STEP 1: PORTAL SELECTION HOME CARDS */}
              {portalStep === 'home' && (
                <motion.div
                  key="portal-home"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-6"
                >
                  <div className="text-center space-y-1.5">
                    <h1 className="font-serif text-2xl sm:text-[26px] font-semibold tracking-tight text-[#F5F3EE] [text-wrap:balance]">
                      Select Your Access Portal
                    </h1>
                    <p className="text-sm text-[#F5F3EE]/70">
                      Choose your university role to proceed to verified authentication.
                    </p>
                  </div>

                  {/* Two Interactive Portal Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* ADMIN PORTAL CARD (Warm Gold Accent) */}
                    <motion.button
                      type="button"
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.99 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      onClick={() => openPortal('admin')}
                      className="group relative text-left rounded-xl border border-[#D6AD60]/35 bg-[#0B1220]/65 p-5 hover:border-[#D6AD60] hover:bg-[#D6AD60]/10 hover:shadow-[0_12px_32px_-12px_rgba(214,173,96,0.35)] transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-11 h-11 rounded-xl bg-[#D6AD60]/15 border border-[#D6AD60]/40 flex items-center justify-center text-[#D6AD60] group-hover:bg-[#D6AD60]/25 transition-colors">
                          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <ArrowRight
                          className="w-4 h-4 text-[#D6AD60]/60 group-hover:text-[#D6AD60] group-hover:translate-x-0.5 transition-all"
                          aria-hidden="true"
                        />
                      </div>
                      <h2 className="font-display text-sm font-semibold tracking-wider text-[#D6AD60]">
                        ADMIN PORTAL
                      </h2>
                      <p className="mt-1.5 text-xs text-[#F5F3EE]/75 leading-relaxed">
                        Administrative access for librarians &amp; faculty governance.
                      </p>
                    </motion.button>

                    {/* STUDENT PORTAL CARD (Royal Blue Accent) */}
                    <motion.button
                      type="button"
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.99 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      onClick={() => openPortal('student')}
                      className="group relative text-left rounded-xl border border-[#315C9A]/55 bg-[#0B1220]/65 p-5 hover:border-[#60A5FA] hover:bg-[#315C9A]/20 hover:shadow-[0_12px_32px_-12px_rgba(49,92,154,0.45)] transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60A5FA]"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-11 h-11 rounded-xl bg-[#315C9A]/25 border border-[#60A5FA]/40 flex items-center justify-center text-[#7AB3FF] group-hover:bg-[#315C9A]/40 transition-colors">
                          <GraduationCap className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <ArrowRight
                          className="w-4 h-4 text-[#7AB3FF]/60 group-hover:text-[#7AB3FF] group-hover:translate-x-0.5 transition-all"
                          aria-hidden="true"
                        />
                      </div>
                      <h2 className="font-display text-sm font-semibold tracking-wider text-[#93C5FD]">
                        STUDENT PORTAL
                      </h2>
                      <p className="mt-1.5 text-xs text-[#F5F3EE]/75 leading-relaxed">
                        Student library access for catalog search, holds &amp; loans.
                      </p>
                    </motion.button>
                  </div>

                  {/* Secondary Portal Utilities */}
                  <div className="pt-4 border-t border-[#F5F3EE]/10 flex flex-wrap items-center justify-between gap-3 text-xs text-[#F5F3EE]/65">
                    <button
                      type="button"
                      onClick={() => {
                        setLoginPortal('student');
                        setPortalStep('form');
                        setViewMode('forgot');
                        setResetStep('request');
                        setErrorMsg(null);
                        setSuccessMsg(null);
                      }}
                      className="hover:text-[#D6AD60] transition-colors cursor-pointer"
                    >
                      Forgot Password?
                    </button>

                    {bootstrapStatus.allowSelfRegistration && (
                      <button
                        type="button"
                        onClick={() => {
                          setLoginPortal('student');
                          setPortalStep('form');
                          setViewMode('register');
                          setErrorMsg(null);
                          setSuccessMsg(null);
                        }}
                        className="inline-flex items-center gap-1.5 text-[#93C5FD] hover:text-[#F5F3EE] transition-colors cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>New Student Registration</span>
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              {/* STEP 2: SELECTED PORTAL AUTHENTICATION FORMS */}
              {portalStep === 'form' && (
                <motion.div
                  key={`portal-form-${loginPortal}-${viewMode}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* Card Top Controls: Back to Home + Portal Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-5 border-b border-[#F5F3EE]/10">
                    <button
                      type="button"
                      onClick={returnToHome}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F5F3EE]/75 hover:text-[#D6AD60] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Back to Home</span>
                    </button>

                    <div className="flex items-center gap-3 text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 font-medium ${
                          isAdmin ? 'text-[#D6AD60]' : 'text-[#93C5FD]'
                        }`}
                      >
                        {isAdmin ? (
                          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <GraduationCap className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{isAdmin ? 'ADMIN PORTAL' : 'STUDENT PORTAL'}</span>
                      </span>

                      {viewMode === 'login' && (
                        <>
                          <span className="text-[#F5F3EE]/25" aria-hidden="true">
                            ·
                          </span>
                          <button
                            type="button"
                            onClick={() => openPortal(isAdmin ? 'student' : 'admin')}
                            className="text-[#F5F3EE]/65 hover:text-[#F5F3EE] underline underline-offset-4 cursor-pointer whitespace-nowrap"
                          >
                            Switch to {isAdmin ? 'Student' : 'Admin'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Form Heading */}
                  <div className="mb-5">
                    {viewMode === 'login' && !showAdminBootstrap && (
                      <>
                        <h1 className="font-serif text-2xl font-semibold tracking-tight text-[#F5F3EE]">
                          {isAdmin ? 'Administrator Sign In' : 'Student Library Sign In'}
                        </h1>
                        <p className="text-sm text-[#F5F3EE]/65 mt-1">
                          {isAdmin
                            ? 'Authorized library staff only. Sessions are role-verified on the server.'
                            : 'Enter your registered Student ID or university email address.'}
                        </p>
                      </>
                    )}

                    {showAdminBootstrap && (
                      <>
                        <h1 className="font-serif text-2xl font-semibold tracking-tight text-[#F5F3EE]">
                          Initialize Administrator
                        </h1>
                        <p className="text-sm text-[#F5F3EE]/65 mt-1">
                          Claim the primary librarian account to configure the library and approve student accounts.
                        </p>
                      </>
                    )}

                    {viewMode === 'register' && (
                      <>
                        <h1 className="font-serif text-2xl font-semibold tracking-tight text-[#F5F3EE]">
                          Request Student Account
                        </h1>
                        <p className="text-sm text-[#F5F3EE]/65 mt-1">
                          Self-registered accounts require librarian verification before first sign-in.
                        </p>
                      </>
                    )}

                    {viewMode === 'forgot' && (
                      <>
                        <h1 className="font-serif text-2xl font-semibold tracking-tight text-[#F5F3EE]">
                          Reset Your Password
                        </h1>
                        <p className="text-sm text-[#F5F3EE]/65 mt-1">
                          Request a reset and enter the one-time verification code issued by your librarian.
                        </p>
                      </>
                    )}
                  </div>

                  {/* FORM 1: First-Run Admin Bootstrap */}
                  {showAdminBootstrap && (
                    <form onSubmit={handleBootstrapSubmit} className="space-y-4" noValidate>
                      <div>
                        <label htmlFor="setup-name" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1.5">
                          Full Name
                        </label>
                        <input
                          id="setup-name"
                          type="text"
                          required
                          value={setupName}
                          onChange={(e) => setSetupName(e.target.value)}
                          placeholder="Dr. Eleanor Vance"
                          className="w-full rounded-xl px-4 py-2.5 text-sm dark-glass-input dark-glass-input-gold"
                        />
                      </div>

                      <div>
                        <label htmlFor="setup-email" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1.5">
                          Institutional Email
                        </label>
                        <input
                          id="setup-email"
                          type="email"
                          required
                          value={setupEmail}
                          onChange={(e) => setSetupEmail(e.target.value)}
                          placeholder="librarian@alderbrook.edu"
                          className="w-full rounded-xl px-4 py-2.5 text-sm dark-glass-input dark-glass-input-gold"
                        />
                      </div>

                      <div>
                        <label htmlFor="setup-dept" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1.5">
                          Department / Office
                        </label>
                        <input
                          id="setup-dept"
                          type="text"
                          value={setupDepartment}
                          onChange={(e) => setSetupDepartment(e.target.value)}
                          className="w-full rounded-xl px-4 py-2.5 text-sm dark-glass-input dark-glass-input-gold"
                        />
                      </div>

                      <div>
                        <label htmlFor="setup-password" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1.5">
                          Administrator Password
                        </label>
                        <div className="relative">
                          <input
                            id="setup-password"
                            type={showSetupPassword ? 'text' : 'password'}
                            required
                            value={setupPassword}
                            onChange={(e) => setSetupPassword(e.target.value)}
                            placeholder="Min 8 chars, upper, lower & number"
                            className="w-full rounded-xl px-4 py-2.5 pr-11 text-sm dark-glass-input dark-glass-input-gold"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSetupPassword((v) => !v)}
                            aria-label={showSetupPassword ? 'Hide password' : 'Show password'}
                            className="absolute inset-y-0 right-0 flex items-center px-3.5 text-[#F5F3EE]/55 hover:text-[#D6AD60] cursor-pointer"
                          >
                            {showSetupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="setup-confirm" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1.5">
                          Confirm Password
                        </label>
                        <input
                          id="setup-confirm"
                          type={showSetupPassword ? 'text' : 'password'}
                          required
                          value={setupConfirm}
                          onChange={(e) => setSetupConfirm(e.target.value)}
                          placeholder="Re-enter password"
                          className="w-full rounded-xl px-4 py-2.5 text-sm dark-glass-input dark-glass-input-gold"
                        />
                      </div>

                      <motion.button
                        whileTap={{ scale: 0.99 }}
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D6AD60] to-[#C29340] px-4 py-3 text-sm font-semibold text-[#0B1220] hover:from-[#E3BD72] hover:to-[#D6AD60] disabled:opacity-60 transition-all cursor-pointer shadow-lg shadow-[#D6AD60]/20"
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                        <span>{isSubmitting ? 'Initializing Account...' : 'Create Administrator & Sign In'}</span>
                      </motion.button>
                    </form>
                  )}

                  {/* FORM 2: Standard Sign In */}
                  {viewMode === 'login' && !showAdminBootstrap && (
                    <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
                      {/* Exhibition Demo Account Credentials */}
                      {isAdmin ? (
                        <div className="rounded-xl border border-[#D6AD60]/35 bg-[#D6AD60]/10 p-3 text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[#D6AD60]">Demo Administrator Account</span>
                            <button
                              type="button"
                              onClick={() => {
                                setIdentifier('pranshul@example.com');
                                setPassword('Admin@1234');
                              }}
                              className="text-[11px] font-medium text-[#D6AD60] hover:text-white underline underline-offset-2 cursor-pointer transition-colors"
                            >
                              Click to Auto-fill
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[#F5F3EE]/80 font-mono">
                            <span>Email: <strong className="text-white">pranshul@example.com</strong></span>
                            <span>Password: <strong className="text-white">Admin@1234</strong></span>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[#60A5FA]/35 bg-[#315C9A]/20 p-3 text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[#93C5FD]">Demo Student Account</span>
                            <button
                              type="button"
                              onClick={() => {
                                setIdentifier('STU-2026-0101');
                                setPassword('Student@1234');
                              }}
                              className="text-[11px] font-medium text-[#93C5FD] hover:text-white underline underline-offset-2 cursor-pointer transition-colors"
                            >
                              Click to Auto-fill
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[#F5F3EE]/80 font-mono">
                            <span>ID: <strong className="text-white">STU-2026-0101</strong> (or Pranshul)</span>
                            <span>Password: <strong className="text-white">Student@1234</strong></span>
                          </div>
                        </div>
                      )}

                      <div>
                        <label htmlFor="login-identifier" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1.5">
                          {isAdmin ? 'Staff Email Address' : 'Student ID or Email'}
                        </label>
                        <input
                          id="login-identifier"
                          type={isAdmin ? 'email' : 'text'}
                          autoComplete="username"
                          required
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder={isAdmin ? 'pranshul@example.com' : 'Pranshul or student@alderbrook.edu'}
                          className={`w-full rounded-xl px-4 py-2.5 text-sm dark-glass-input ${focusClass}`}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="login-password" className="block text-xs font-medium text-[#F5F3EE]/85">
                            Password
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setViewMode('forgot');
                              setResetStep('request');
                              setForgotIdentifier(identifier);
                              setErrorMsg(null);
                              setSuccessMsg(null);
                            }}
                            className={`text-xs font-medium transition-colors cursor-pointer ${
                              isAdmin
                                ? 'text-[#D6AD60] hover:text-[#E7C682]'
                                : 'text-[#93C5FD] hover:text-[#BFDBFE]'
                            }`}
                          >
                            Forgot password?
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            id="login-password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            className={`w-full rounded-xl px-4 py-2.5 pr-11 text-sm dark-glass-input ${focusClass}`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            className="absolute inset-y-0 right-0 flex items-center px-3.5 text-[#F5F3EE]/55 hover:text-[#D6AD60] cursor-pointer transition-colors"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-0.5">
                        <label className="inline-flex items-center gap-2 text-xs sm:text-sm text-[#F5F3EE]/75 cursor-pointer select-none hover:text-[#F5F3EE]">
                          <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className={`h-4 w-4 rounded border-[#F5F3EE]/30 bg-[#0B1220] ${
                              isAdmin
                                ? 'accent-[#D6AD60] focus:ring-[#D6AD60]'
                                : 'accent-[#315C9A] focus:ring-[#60A5FA]'
                            }`}
                          />
                          <span>Remember me for 7 days</span>
                        </label>

                        <span className="text-[11px] text-[#F5F3EE]/55 inline-flex items-center gap-1">
                          <Lock className="w-3 h-3 text-[#D6AD60]" aria-hidden="true" />
                          <span>Role-verified</span>
                        </span>
                      </div>

                      <motion.button
                        whileTap={{ scale: 0.99 }}
                        type="submit"
                        disabled={isSubmitting}
                        className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60 transition-all cursor-pointer shadow-lg ${
                          isAdmin
                            ? 'bg-gradient-to-r from-[#D6AD60] to-[#C29340] text-[#0B1220] hover:from-[#E4BE74] hover:to-[#D6AD60] shadow-[#D6AD60]/20'
                            : 'bg-gradient-to-r from-[#315C9A] to-[#254B82] text-[#F5F3EE] border border-[#60A5FA]/35 hover:from-[#3B6CB3] hover:to-[#315C9A] shadow-[#315C9A]/35'
                        }`}
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                        <span>
                          {isSubmitting
                            ? 'Verifying Credentials...'
                            : isAdmin
                              ? 'Sign In to Admin Portal'
                              : 'Sign In to Student Portal'}
                        </span>
                      </motion.button>

                      {!isAdmin && bootstrapStatus.allowSelfRegistration && (
                        <div className="pt-4 border-t border-[#F5F3EE]/10 flex items-center justify-between text-xs text-[#F5F3EE]/70">
                          <span>New to {bootstrapStatus.libraryName || 'Smart Library'}?</span>
                          <button
                            type="button"
                            onClick={() => {
                              setViewMode('register');
                              setErrorMsg(null);
                              setSuccessMsg(null);
                            }}
                            className="inline-flex items-center gap-1.5 font-medium text-[#93C5FD] hover:text-[#F5F3EE] cursor-pointer"
                          >
                            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Request Student Account</span>
                          </button>
                        </div>
                      )}
                    </form>
                  )}

                  {/* FORM 3: Student Self-Registration */}
                  {viewMode === 'register' && (
                    <form onSubmit={handleRegisterSubmit} className="space-y-3.5" noValidate>
                      <div>
                        <label htmlFor="reg-name" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                          Full Name
                        </label>
                        <input
                          id="reg-name"
                          type="text"
                          required
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          placeholder="Maya Lin"
                          className="w-full rounded-xl px-3.5 py-2 text-sm dark-glass-input dark-glass-input-blue"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="reg-student-id" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                            Student ID
                          </label>
                          <input
                            id="reg-student-id"
                            type="text"
                            required
                            value={regStudentId}
                            onChange={(e) => setRegStudentId(e.target.value)}
                            placeholder="STU-2026-0142"
                            className="w-full rounded-xl px-3.5 py-2 text-sm font-mono uppercase dark-glass-input dark-glass-input-blue"
                          />
                        </div>
                        <div>
                          <label htmlFor="reg-dept" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                            Department
                          </label>
                          <input
                            id="reg-dept"
                            type="text"
                            required
                            value={regDepartment}
                            onChange={(e) => setRegDepartment(e.target.value)}
                            placeholder="Computer Science"
                            className="w-full rounded-xl px-3.5 py-2 text-sm dark-glass-input dark-glass-input-blue"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="reg-email" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                          University Email
                        </label>
                        <input
                          id="reg-email"
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="maya.lin@alderbrook.edu"
                          className="w-full rounded-xl px-3.5 py-2 text-sm dark-glass-input dark-glass-input-blue"
                        />
                      </div>

                      <div>
                        <label htmlFor="reg-password" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                          Password
                        </label>
                        <div className="relative">
                          <input
                            id="reg-password"
                            type={showRegPassword ? 'text' : 'password'}
                            required
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="Min 8 chars, upper, lower & number"
                            className="w-full rounded-xl px-3.5 py-2 pr-10 text-sm dark-glass-input dark-glass-input-blue"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPassword((v) => !v)}
                            aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                            className="absolute inset-y-0 right-0 flex items-center px-3 text-[#F5F3EE]/55 hover:text-[#93C5FD] cursor-pointer"
                          >
                            {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="reg-confirm" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                          Confirm Password
                        </label>
                        <input
                          id="reg-confirm"
                          type={showRegPassword ? 'text' : 'password'}
                          required
                          value={regConfirm}
                          onChange={(e) => setRegConfirm(e.target.value)}
                          placeholder="Confirm password"
                          className="w-full rounded-xl px-3.5 py-2 text-sm dark-glass-input dark-glass-input-blue"
                        />
                      </div>

                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setViewMode('login');
                            setErrorMsg(null);
                          }}
                          className="rounded-xl border border-[#F5F3EE]/20 px-4 py-2.5 text-xs font-medium text-[#F5F3EE]/80 hover:border-[#F5F3EE]/40 hover:text-[#F5F3EE] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Back to Sign In
                        </button>
                        <motion.button
                          whileTap={{ scale: 0.99 }}
                          type="submit"
                          disabled={isSubmitting}
                          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#315C9A] to-[#254B82] border border-[#60A5FA]/35 px-4 py-2.5 text-sm font-semibold text-[#F5F3EE] hover:from-[#3B6CB3] hover:to-[#315C9A] disabled:opacity-60 transition-all cursor-pointer"
                        >
                          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                          <span>{isSubmitting ? 'Submitting...' : 'Submit Registration'}</span>
                        </motion.button>
                      </div>
                    </form>
                  )}

                  {/* FORM 4: Forgot & Reset Password */}
                  {viewMode === 'forgot' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0B1220]/70 rounded-xl border border-[#F5F3EE]/12">
                        <button
                          type="button"
                          onClick={() => {
                            setResetStep('request');
                            setErrorMsg(null);
                          }}
                          className={`py-2 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                            resetStep === 'request'
                              ? 'bg-[#315C9A] text-[#F5F3EE] shadow-xs'
                              : 'text-[#F5F3EE]/65 hover:text-[#F5F3EE]'
                          }`}
                        >
                          1. Request Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetStep('complete');
                            setErrorMsg(null);
                          }}
                          className={`py-2 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                            resetStep === 'complete'
                              ? 'bg-[#315C9A] text-[#F5F3EE] shadow-xs'
                              : 'text-[#F5F3EE]/65 hover:text-[#F5F3EE]'
                          }`}
                        >
                          2. Enter Reset Code
                        </button>
                      </div>

                      {resetStep === 'request' ? (
                        <form onSubmit={handleForgotSubmit} className="space-y-4" noValidate>
                          <div>
                            <label htmlFor="forgot-id" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1.5">
                              Email Address or Student ID
                            </label>
                            <input
                              id="forgot-id"
                              type="text"
                              required
                              value={forgotIdentifier}
                              onChange={(e) => setForgotIdentifier(e.target.value)}
                              placeholder="Pranshul or pranshul@example.com"
                              className="w-full rounded-xl px-4 py-2.5 text-sm dark-glass-input dark-glass-input-blue"
                            />
                          </div>
                          <motion.button
                            whileTap={{ scale: 0.99 }}
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#315C9A] to-[#254B82] border border-[#60A5FA]/35 px-4 py-2.5 text-sm font-semibold text-[#F5F3EE] hover:from-[#3B6CB3] hover:to-[#315C9A] disabled:opacity-60 transition-all cursor-pointer"
                          >
                            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                            <span>{isSubmitting ? 'Logging Request...' : 'Request Password Reset'}</span>
                          </motion.button>
                        </form>
                      ) : (
                        <form onSubmit={handleResetCompleteSubmit} className="space-y-3.5" noValidate>
                          <div>
                            <label htmlFor="reset-id" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                              Email Address or Student ID
                            </label>
                            <input
                              id="reset-id"
                              type="text"
                              required
                              value={forgotIdentifier}
                              onChange={(e) => setForgotIdentifier(e.target.value)}
                              placeholder="Pranshul or pranshul@example.com"
                              className="w-full rounded-xl px-3.5 py-2 text-sm dark-glass-input dark-glass-input-blue"
                            />
                          </div>
                          <div>
                            <label htmlFor="reset-code" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                              One-Time Reset Code
                            </label>
                            <input
                              id="reset-code"
                              type="text"
                              required
                              value={resetCode}
                              onChange={(e) => setResetCode(e.target.value)}
                              placeholder="8-character code from librarian"
                              className="w-full rounded-xl px-3.5 py-2 text-sm font-mono uppercase dark-glass-input dark-glass-input-blue"
                            />
                          </div>
                          <div>
                            <label htmlFor="reset-new-pw" className="block text-xs font-medium text-[#F5F3EE]/85 mb-1">
                              New Password
                            </label>
                            <div className="relative">
                              <input
                                id="reset-new-pw"
                                type={showResetPassword ? 'text' : 'password'}
                                required
                                value={resetNewPassword}
                                onChange={(e) => setResetNewPassword(e.target.value)}
                                placeholder="Min 8 chars, upper, lower & number"
                                className="w-full rounded-xl px-3.5 py-2 pr-10 text-sm dark-glass-input dark-glass-input-blue"
                              />
                              <button
                                type="button"
                                onClick={() => setShowResetPassword((v) => !v)}
                                aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                                className="absolute inset-y-0 right-0 flex items-center px-3 text-[#F5F3EE]/55 hover:text-[#93C5FD] cursor-pointer"
                              >
                                {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          <motion.button
                            whileTap={{ scale: 0.99 }}
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#315C9A] to-[#254B82] border border-[#60A5FA]/35 px-4 py-2.5 text-sm font-semibold text-[#F5F3EE] hover:from-[#3B6CB3] hover:to-[#315C9A] disabled:opacity-60 transition-all cursor-pointer"
                          >
                            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                            <span>{isSubmitting ? 'Updating Password...' : 'Set New Password'}</span>
                          </motion.button>
                        </form>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        </motion.div>
      </main>

      {/* Institutional Copyright Footer */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 pb-5 pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-[#F5F3EE]/60">
        <span>
          © 2026 Smart Library · {bootstrapStatus.libraryName || 'Alderbrook Library'}. All rights reserved.
        </span>
        <span className="inline-flex items-center gap-2">
          <Lock className="w-3 h-3 text-[#D6AD60]" aria-hidden="true" />
          <span>Encrypted Credentials · Backend Role-Verified Access</span>
        </span>
      </footer>
    </div>
  );
}
