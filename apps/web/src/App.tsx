import { LoadingIndicator } from './components/ui/LoadingIndicator';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import LoginPage from './features/auth/LoginPage';
import { RegisterCompanyPage } from './features/registration/RegisterCompanyPage';
import { ProductTraceabilityPage } from './features/product-traceability';
import { ReceiveTransferPage } from './features/custody-transfers/ReceiveTransferPage';

const WorkspaceApp = lazy(() => import('./features/workspaces/WorkspaceApp'));
const ReceiveShipmentPage = lazy(() =>
  import('./features/orders/ReceiveShipmentPage').then((module) => ({
    default: module.ReceiveShipmentPage,
  })),
);
const ReceiveIngredientPage = lazy(() =>
  import('./features/orders/ReceiveIngredientPage').then((module) => ({
    default: module.ReceiveIngredientPage,
  })),
);

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/login" />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register-company" element={<RegisterCompanyPage />} />
      <Route path="/trace/product" element={<ProductTraceabilityPage />} />
      <Route path="/receive/transfer" element={<ReceiveTransferPage />} />
      <Route
        path="/receive/shipment"
        element={
          <Suspense fallback={<LoadingIndicator label="Loading shipment…" />}>
            <ReceiveShipmentPage />
          </Suspense>
        }
      />
      <Route
        path="/receive/ingredient"
        element={
          <Suspense fallback={<LoadingIndicator label="Loading delivery…" />}>
            <ReceiveIngredientPage />
          </Suspense>
        }
      />

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
