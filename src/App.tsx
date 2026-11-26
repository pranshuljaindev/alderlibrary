import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { AdminDashboard } from './components/AdminDashboard';
import { LoginPage } from './components/LoginPage';
import { StudentDashboard } from './components/StudentDashboard';
import { ToastContainer, type ToastItem } from './components/Toast';
import { apiRequest, getAccessToken, setAccessToken, setSessionExpiredHandler } from './lib/api';
import { checkBackendHealth } from './lib/connectionStatus';
import type { BootstrapStatus, User } from './types';

type AppRoute = '/' | '/admin' | '/student';

function normalizeRoute(pathname: string): AppRoute {
  if (pathname.startsWith('/admin')) return '/admin';
  if (pathname.startsWith('/student')) return '/student';
  return '/';
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() =>
    normalizeRoute(window.location.pathname)
  );
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>({
    needsAdminSetup: false,
    hasEnvPasscode: false,
    allowSelfRegistration: true,
    libraryName: 'Alderbrook Library',
  });

  const pushToast = useCallback((type: ToastItem['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const navigate = useCallback((target: AppRoute, replace = false) => {
    setRoute(target);
    if (window.location.pathname !== target) {
      if (replace) {
        window.history.replaceState(null, '', target);
      } else {
        window.history.pushState(null, '', target);
      }
    }
  }, []);

  const fetchBootstrapStatus = useCallback(async () => {
    try {
      const status = await apiRequest<BootstrapStatus>('/api/auth/bootstrap-status', {
        skipAuthHandling: true,
      });
      setBootstrapStatus(status);
    } catch {
      // Non-fatal fallback
    }
  }, []);

  useEffect(() => {
    setSessionExpiredHandler((message) => {
      setUser(null);
      setAccessToken(null);
      setSessionNotice(message);
      navigate('/', true);
    });

    return () => setSessionExpiredHandler(null);
  }, [navigate]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(normalizeRoute(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let active = true;

    async function boot() {
      await Promise.all([checkBackendHealth(), fetchBootstrapStatus()]);

      // If no session token exists in localStorage, do not attempt refresh and do not log in
      const token = getAccessToken();
      if (!token) {
        if (!active) return;
        setUser(null);
        setInitializing(false);
        return;
      }

      try {
        const res = await apiRequest<{ accessToken: string; user: User }>('/api/auth/refresh', {
          method: 'POST',
          skipAuthHandling: true,
        });
        if (!active) return;
        setAccessToken(res.accessToken);
        setUser(res.user);
      } catch {
        if (!active) return;
        setAccessToken(null);
        setUser(null);
      } finally {
        if (active) setInitializing(false);
      }
    }

    void boot();
    return () => {
      active = false;
    };
  }, [fetchBootstrapStatus]);

  // Enforce SPA route protection matching verified user role
  useEffect(() => {
    if (initializing) return;

    if (!user) {
      // If unauthenticated user directly opens /admin or /student, redirect to Login Page (/)
      if (route !== '/') {
        setSessionNotice('Please sign in to access that workspace.');
        navigate('/', true);
      }
      return;
    }

    // Role-based route enforcement for authenticated users
    if (route === '/admin' && user.role !== 'admin') {
      pushToast('error', 'Access denied. Student accounts cannot access the Admin Console.');
      navigate('/student', true);
    } else if (route === '/student' && user.role !== 'student') {
      navigate('/admin', true);
    }
  }, [initializing, user, route, navigate, pushToast]);

  const handleAuthSuccess = useCallback(
    (authenticatedUser: User) => {
      setUser(authenticatedUser);
      setSessionNotice(null);
      navigate(authenticatedUser.role === 'admin' ? '/admin' : '/student', true);
    },
    [navigate]
  );

  const handleLogout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', skipAuthHandling: true });
    } catch {
      // Proceed with local cleanup even if request fails
    }
    setAccessToken(null);
    setUser(null);
    setSessionNotice(null);
    await fetchBootstrapStatus();
    navigate('/', true);
    pushToast('info', 'You have been signed out securely.');
  }, [fetchBootstrapStatus, navigate, pushToast]);

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#070913] flex flex-col items-center justify-center gap-3 text-[#94A3B8]">
        <Loader2 className="w-6 h-6 animate-spin text-[#A78BFA]" />
        <p className="text-sm font-medium">Verifying library session...</p>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      {!user || route === '/' ? (
        <LoginPage
          bootstrapStatus={bootstrapStatus}
          sessionNotice={sessionNotice}
          onClearSessionNotice={() => setSessionNotice(null)}
          onAuthSuccess={handleAuthSuccess}
          onBootstrapComplete={() => void fetchBootstrapStatus()}
          onNotify={pushToast}
        />
      ) : user.role === 'admin' ? (
        <AdminDashboard
          currentUser={user}
          onLogout={() => void handleLogout()}
          onNotify={pushToast}
        />
      ) : (
        <StudentDashboard
          currentUser={user}
          libraryName={bootstrapStatus.libraryName}
          onUserUpdated={setUser}
          onLogout={() => void handleLogout()}
          onNotify={pushToast}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </MotionConfig>
  );
}
