import { Navigate, Route, Routes } from 'react-router-dom';

import LoginPage from './features/auth/LoginPage';
import { RegisterCompanyPage } from './features/registration/RegisterCompanyPage';
import { WorkspacePage } from './features/workspaces/WorkspacePage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/login" />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register-company" element={<RegisterCompanyPage />} />

      <Route path="/admin" element={<Navigate replace to="/admin/applications" />} />
      <Route
        path="/admin/applications"
        element={<WorkspacePage page="applications" workspace="admin" />}
      />
      <Route
        path="/admin/credentials"
        element={<WorkspacePage page="credentials" workspace="admin" />}
      />
      <Route
        path="/admin/stakeholders"
        element={<WorkspacePage page="stakeholders" workspace="admin" />}
      />

      <Route path="/supplier" element={<Navigate replace to="/supplier/ingredients" />} />
      <Route
        path="/supplier/ingredients"
        element={<WorkspacePage page="ingredients" workspace="supplier" />}
      />
      <Route
        path="/supplier/credentials"
        element={<WorkspacePage page="credentials" workspace="supplier" />}
      />
      <Route
        path="/supplier/evidence-requests"
        element={<WorkspacePage page="evidence-requests" workspace="supplier" />}
      />

      <Route
        path="/manufacturer"
        element={<Navigate replace to="/manufacturer/ingredient-evidence" />}
      />
      <Route
        path="/manufacturer/ingredient-evidence"
        element={<WorkspacePage page="ingredient-evidence" workspace="manufacturer" />}
      />
      <Route
        path="/manufacturer/product-batches"
        element={<WorkspacePage page="product-batches" workspace="manufacturer" />}
      />
      <Route
        path="/manufacturer/transfers"
        element={<WorkspacePage page="transfers" workspace="manufacturer" />}
      />

      <Route
        path="/distributor"
        element={<Navigate replace to="/distributor/incoming-shipments" />}
      />
      <Route
        path="/distributor/incoming-shipments"
        element={<WorkspacePage page="incoming-shipments" workspace="distributor" />}
      />
      <Route
        path="/distributor/inventory"
        element={<WorkspacePage page="inventory" workspace="distributor" />}
      />
      <Route
        path="/distributor/transfers"
        element={<WorkspacePage page="transfers" workspace="distributor" />}
      />

      <Route path="/retailer" element={<Navigate replace to="/retailer/incoming-products" />} />
      <Route
        path="/retailer/incoming-products"
        element={<WorkspacePage page="incoming-products" workspace="retailer" />}
      />
      <Route
        path="/retailer/traceability"
        element={<WorkspacePage page="traceability" workspace="retailer" />}
      />
      <Route
        path="/retailer/reports"
        element={<WorkspacePage page="reports" workspace="retailer" />}
      />

      <Route path="*" element={<Navigate replace to="/login" />} />
    </Routes>
  );
}

export default App;
