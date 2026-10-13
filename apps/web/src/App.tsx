import { Navigate, Route, Routes } from 'react-router-dom';

import AdminApplicationsPage from './pages/admin/applications';
import AdminCredentialsPage from './pages/admin/credentials';
import AdminStakeholdersPage from './pages/admin/stakeholders';
import DistributorIncomingShipmentsPage from './pages/distributor/incoming-shipments';
import DistributorInventoryPage from './pages/distributor/inventory';
import DistributorTransfersPage from './pages/distributor/transfers';
import LoginPage from './pages/login';
import ManufacturerIngredientEvidencePage from './pages/manufacturer/ingredient-evidence';
import ManufacturerProductBatchesPage from './pages/manufacturer/product-batches';
import ManufacturerTransfersPage from './pages/manufacturer/transfers';
import RegisterCompanyPage from './pages/register-company';
import RetailerIncomingProductsPage from './pages/retailer/incoming-products';
import RetailerReportsPage from './pages/retailer/reports';
import RetailerTraceabilityPage from './pages/retailer/traceability';
import SupplierCredentialsPage from './pages/supplier/credentials';
import SupplierEvidenceRequestsPage from './pages/supplier/evidence-requests';
import SupplierIngredientsPage from './pages/supplier/ingredients';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/login" />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register-company" element={<RegisterCompanyPage />} />

      <Route path="/admin" element={<Navigate replace to="/admin/applications" />} />
      <Route path="/admin/applications" element={<AdminApplicationsPage />} />
      <Route path="/admin/credentials" element={<AdminCredentialsPage />} />
      <Route path="/admin/stakeholders" element={<AdminStakeholdersPage />} />

      <Route path="/supplier" element={<Navigate replace to="/supplier/ingredients" />} />
      <Route path="/supplier/ingredients" element={<SupplierIngredientsPage />} />
      <Route path="/supplier/credentials" element={<SupplierCredentialsPage />} />
      <Route path="/supplier/evidence-requests" element={<SupplierEvidenceRequestsPage />} />

      <Route
        path="/manufacturer"
        element={<Navigate replace to="/manufacturer/ingredient-evidence" />}
      />
      <Route
        path="/manufacturer/ingredient-evidence"
        element={<ManufacturerIngredientEvidencePage />}
      />
      <Route path="/manufacturer/product-batches" element={<ManufacturerProductBatchesPage />} />
      <Route path="/manufacturer/transfers" element={<ManufacturerTransfersPage />} />

      <Route
        path="/distributor"
        element={<Navigate replace to="/distributor/incoming-shipments" />}
      />
      <Route
        path="/distributor/incoming-shipments"
        element={<DistributorIncomingShipmentsPage />}
      />
      <Route path="/distributor/inventory" element={<DistributorInventoryPage />} />
      <Route path="/distributor/transfers" element={<DistributorTransfersPage />} />

      <Route path="/retailer" element={<Navigate replace to="/retailer/incoming-products" />} />
      <Route path="/retailer/incoming-products" element={<RetailerIncomingProductsPage />} />
      <Route path="/retailer/traceability" element={<RetailerTraceabilityPage />} />
      <Route path="/retailer/reports" element={<RetailerReportsPage />} />

      <Route path="*" element={<Navigate replace to="/login" />} />
    </Routes>
  );
}

export default App;
