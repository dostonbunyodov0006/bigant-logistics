import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '@bigant/shared';
import { useAuth } from './AuthContext';

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="grid h-screen place-items-center text-slate">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
