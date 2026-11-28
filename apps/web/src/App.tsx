import { LoadingIndicator } from './components/ui/LoadingIndicator';
import { Notifications } from './components/ui/Notifications';
import { TransactionProgress } from './components/ui/TransactionProgress';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import LoginPage from './features/auth/LoginPage';

// Lazy so login/QR visitors don't download the phone-input (~900 KB source) or QR-scanner code.
const RegisterCompanyPage = lazy(() =>
  import('./features/registration/RegisterCompanyPage').then((module) => ({
    default: module.RegisterCompanyPage,
  })),
);
const ProductTraceabilityPage = lazy(() =>
  import('./features/product-traceability').then((module) => ({
    default: module.ProductTraceabilityPage,
  })),
);
const ReceiveTransferPage = lazy(() =>
  import('./features/custody-transfers/ReceiveTransferPage').then((module) => ({
    default: module.ReceiveTransferPage,
  })),
);
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
    <>
      <Notifications />
      <TransactionProgress />
      <Routes>
        <Route path="/" element={<Navigate replace to="/login" />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/register-company"
          element={
            <Suspense fallback={<LoadingIndicator fullScreen label="Loading registration…" />}>
              <RegisterCompanyPage />
            </Suspense>
          }
        />
        <Route
          path="/trace/product"
          element={
            <Suspense fallback={<LoadingIndicator fullScreen label="Loading product…" />}>
              <ProductTraceabilityPage />
            </Suspense>
          }
        />
        <Route
          path="/receive/transfer"
          element={
            <Suspense fallback={<LoadingIndicator fullScreen label="Loading transfer…" />}>
              <ReceiveTransferPage />
            </Suspense>
          }
        />
        <Route
          path="/receive/shipment"
          element={
            <Suspense fallback={<LoadingIndicator fullScreen label="Loading shipment…" />}>
              <ReceiveShipmentPage />
            </Suspense>
          }
        />
        <Route
          path="/receive/ingredient"
          element={
            <Suspense fallback={<LoadingIndicator fullScreen label="Loading delivery…" />}>
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
    </>
  );
}

export default App;
