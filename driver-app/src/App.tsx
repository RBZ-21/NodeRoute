import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { useDriverApp } from '@/hooks/useDriverApp';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { LoginPage } from '@/pages/LoginPage';
import { RoutePage } from '@/pages/RoutePage';
import { StopDetailPage } from '@/pages/StopDetailPage';
import { StopsPage } from '@/pages/StopsPage';
import { TemperatureLogPage } from '@/pages/TemperatureLogPage';

function ProtectedRoute() {
  const { token } = useDriverApp();
  return token ? <AppShell /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<RoutePage />} />
        <Route path="/stops" element={<StopsPage />} />
        <Route path="/stops/:stopId" element={<StopDetailPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/temperature" element={<TemperatureLogPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
