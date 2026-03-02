import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/useAuth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { TrackingPage } from './pages/TrackingPage';
import { PlatformsPage } from './pages/PlatformsPage';
import { EventsPage } from './pages/EventsPage';
import { RulesPage } from './pages/RulesPage';
import { MappingsPage } from './pages/MappingsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { UsersPage } from './pages/UsersPage';
import { DocsPage } from './pages/DocsPage';
import { AppsPage } from './pages/AppsPage';

export default function App() {
  const { token } = useAuth();

  if (!token) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="apps" element={<AppsPage />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="platforms" element={<PlatformsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="mappings" element={<MappingsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="docs" element={<DocsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
