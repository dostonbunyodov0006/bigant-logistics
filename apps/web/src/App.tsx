import { useShiftTimeLabels } from './lib/useShiftTimes';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import i18n from './i18n';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { useRealtime } from './hooks/useRealtime';
import { Layout } from './components/Layout';
import { NewVersionBadge } from './components/NewVersionBadge';
import { SellerVozvratReviewPage } from './pages/SellerVozvratReviewPage';
import { SellerBoardPage } from './pages/SellerBoardPage';
import { LoginPage } from './pages/LoginPage';
import { OmborPage } from './pages/ombor/OmborPage';
import { DashboardPage } from './pages/DashboardPage';
import { OrdersPage } from './pages/OrdersPage';
import { CreateOrderPage } from './pages/CreateOrderPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { DriversPage } from './pages/DriversPage';
import { ClientsPage } from './pages/ClientsPage';
import { PickupPlacesPage } from './pages/PickupPlacesPage';
import { StaffPage } from './pages/StaffPage';
import { SellerDetailPage } from './pages/SellerDetailPage';
import { DriverDetailPage } from './pages/DriverDetailPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { PayrollPage } from './pages/PayrollPage';
import { PayrollDriverPage } from './pages/PayrollDriverPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { FuelDriverRefundPage } from './pages/fuel/FuelDriverRefundPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkTimePage } from './pages/WorkTimePage';
import { CreateVozvratOrderPage } from './pages/CreateVozvratOrderPage';

/** An old page link lands on its tab, keeping its own query (?tab=settle). */
function ToTab({ to, bolim }: { to: string; bolim: string }) {
  const [p] = useSearchParams();
  p.set('bolim', bolim);
  return <Navigate to={`${to}?${p.toString()}`} replace />;
}

export function App() {
  const { user } = useAuth();
  // Live board updates (SSE) for any signed-in user; polling stays as a fallback.
  useRealtime(!!user);
  // "9:00 dan oldin", "18:00 dan keyin": the times the office set, not the code's.
  useShiftTimeLabels(!!user);
  // Sellers get the dedicated dark reservation board and nothing else.
  const isSeller = user?.role === 'seller';
  // The board speaks Uzbek, full stop. It has no language switch of its own,
  // so whatever the browser — or an admin who used English on the same
  // machine — left in storage would otherwise leak through as a half-English
  // screen for a seller who never asked for it.
  useEffect(() => {
    if (isSeller && i18n.language !== 'uz') void i18n.changeLanguage('uz');
  }, [isSeller]);
  return (
    <>
    <NewVersionBadge />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Omborchi: opened inside Telegram, signs in with it, not with a login (owner, 05.11.2026). */}
      <Route path="/ombor" element={<OmborPage />} />
      <Route element={<ProtectedRoute />}>
        {isSeller ? (
          <>
          <Route path="/seller" element={<SellerBoardPage />} />
          <Route path="/seller/vozvrat/new" element={<div className="min-h-screen bg-canvas p-6"><CreateVozvratOrderPage /></div>} />
          <Route path="/seller/vozvrat-review/:orderId" element={<SellerVozvratReviewPage />} />
          </>
        ) : (
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route element={<ProtectedRoute roles={['admin', 'manager', 'seller']} />}>
            <Route path="/orders/new" element={<CreateOrderPage />} />
            <Route path="/orders/new-vozvrat" element={<CreateVozvratOrderPage />} />
            <Route path="/drivers" element={<DriversPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/pickup-places" element={<PickupPlacesPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={['admin', 'manager']} />}>
            {/* The seller board inside the console (owner, 05.11.2026). */}
            <Route path="/statuslar" element={<SellerBoardPage embedded />} />
            <Route path="/statuslar/vozvrat-review/:orderId" element={<SellerVozvratReviewPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/sellers/:id" element={<SellerDetailPage />} />
            <Route path="/drivers/:id" element={<DriverDetailPage />} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
            <Route path="/vehicles" element={<VehiclesPage />} />
            <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
            <Route path="/documents" element={<Navigate to="/vehicles?bolim=documents" replace />} />
            <Route path="/attendance" element={<Navigate to="/ish-vaqti?bolim=attendance" replace />} />
            <Route path="/work-report" element={<Navigate to="/ish-vaqti?bolim=report" replace />} />
            <Route path="/fines" element={<ToTab to="/payroll" bolim="fines" />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/payroll/:driverId" element={<PayrollDriverPage />} />
            <Route path="/leave" element={<Navigate to="/ish-vaqti?bolim=leave" replace />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/fuel" element={<ToTab to="/expenses" bolim="fuel" />} />
            <Route path="/fuel/refund/:driverId" element={<FuelDriverRefundPage />} />
            <Route path="/service" element={<Navigate to="/vehicles?bolim=service" replace />} />
            <Route path="/vozvrat" element={<Navigate to="/orders?bolim=vozvrat" replace />} />
            <Route path="/analytics" element={<Navigate to="/drivers?bolim=analytics" replace />} />
            <Route path="/track" element={<Navigate to="/drivers?bolim=track" replace />} />
            {/* Superseded routes kept as redirects so existing links and
                bookmarks land somewhere useful instead of on the dashboard.
                /timesheet showed the same per-driver rows as /work-report. */}
            <Route path="/sellers" element={<Navigate to="/staff" replace />} />
            <Route path="/managers" element={<Navigate to="/staff?role=dispetcher" replace />} />
            <Route path="/timesheet" element={<Navigate to="/work-report" replace />} />
            <Route path="/cargo-types" element={<Navigate to="/settings" replace />} />
            {/* Open to managers: RolesGuard treats a manager as a second admin
                ("A Manager is a second admin"), so every @Roles('admin') endpoint
                on this page already accepts them. The old admin-only gate locked
                managers out of vehicle tariffs they are permitted to edit. */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/work-hours" element={<Navigate to="/ish-vaqti" replace />} />
            <Route path="/ish-vaqti" element={<WorkTimePage />} />
          </Route>
        </Route>
        )}
      </Route>
      <Route path="*" element={<Navigate to={isSeller ? '/seller' : '/'} replace />} />
    </Routes>
    </>
  );
}
