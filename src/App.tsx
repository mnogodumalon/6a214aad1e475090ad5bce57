import '@/lib/sentry';
import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ActionsProvider } from '@/context/ActionsContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorBusProvider } from '@/components/ErrorBus';
import { Layout } from '@/components/Layout';
import DashboardOverview from '@/pages/DashboardOverview';
import { WorkflowPlaceholders } from '@/components/WorkflowPlaceholders';
import AdminPage from '@/pages/AdminPage';
import PatientenPage from '@/pages/PatientenPage';
import PatientenDetailPage from '@/pages/PatientenDetailPage';
import TerminbuchungenPage from '@/pages/TerminbuchungenPage';
import TerminbuchungenDetailPage from '@/pages/TerminbuchungenDetailPage';
import PublicFormPatienten from '@/pages/public/PublicForm_Patienten';
import PublicFormTerminbuchungen from '@/pages/public/PublicForm_Terminbuchungen';
// <public:imports>
// </public:imports>
// <custom:imports>
// </custom:imports>

export default function App() {
  return (
    <ErrorBoundary>
      <ErrorBusProvider>
        <HashRouter>
          <ActionsProvider>
            <Routes>
              <Route path="public/6a214a984f40c7c263b3488a" element={<PublicFormPatienten />} />
              <Route path="public/6a214a9c6f620e33f3b2586e" element={<PublicFormTerminbuchungen />} />
              {/* <public:routes> */}
              {/* </public:routes> */}
              <Route element={<Layout />}>
                <Route index element={<><div className="mb-8"><WorkflowPlaceholders /></div><DashboardOverview /></>} />
                <Route path="patienten" element={<PatientenPage />} />
                <Route path="patienten/:id" element={<PatientenDetailPage />} />
                <Route path="terminbuchungen" element={<TerminbuchungenPage />} />
                <Route path="terminbuchungen/:id" element={<TerminbuchungenDetailPage />} />
                <Route path="admin" element={<AdminPage />} />
                {/* <custom:routes> */}
                {/* </custom:routes> */}
              </Route>
            </Routes>
          </ActionsProvider>
        </HashRouter>
      </ErrorBusProvider>
    </ErrorBoundary>
  );
}
