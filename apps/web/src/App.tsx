import { LoadingIndicator } from './components/ui/LoadingIndicator';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import LoginPage from './features/auth/LoginPage';
import { RegisterCompanyPage } from './features/registration/RegisterCompanyPage';
import { ProductTraceabilityPage } from './features/product-traceability';
import { ReceiveTransferPage } from './features/custody-transfers/ReceiveTransferPage';

const WorkspaceApp = lazy(() => import('./features/workspaces/WorkspaceApp'));

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/login" />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register-company" element={<RegisterCompanyPage />} />
      <Route path="/trace/product" element={<ProductTraceabilityPage />} />
      <Route path="/receive/transfer" element={<ReceiveTransferPage />} />

      {(['admin', 'supplier', 'manufacturer', 'distributor', 'retailer'] as const).map((role) => (
        <Route
          key={role}
          path={`/${role}/*`}
          element={
            <Suspense fallback={<LoadingIndicator fullScreen label="Loading workspace…" />}>
              <WorkspaceApp key={role} role={role} />
            </Suspense>
          }
        />
      ))}

      <Route path="*" element={<Navigate replace to="/login" />} />
    </Routes>
  );
}

export default App;
