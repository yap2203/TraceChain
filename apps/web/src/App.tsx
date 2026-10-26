import { Navigate, Route, Routes } from 'react-router-dom';

import { CredentialGatePage } from './features/auth/CredentialGatePage';
import LoginPage from './features/auth/LoginPage';
import { RegisterCompanyPage } from './features/registration/RegisterCompanyPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/login" />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register-company" element={<RegisterCompanyPage />} />

      <Route path="/admin/*" element={<CredentialGatePage roleLabel="System Admin" />} />
      <Route path="/supplier/*" element={<CredentialGatePage roleLabel="Supplier" />} />
      <Route path="/manufacturer/*" element={<CredentialGatePage roleLabel="Manufacturer" />} />
      <Route path="/distributor/*" element={<CredentialGatePage roleLabel="Distributor" />} />
      <Route path="/retailer/*" element={<CredentialGatePage roleLabel="Retailer" />} />

      <Route path="*" element={<Navigate replace to="/login" />} />
    </Routes>
  );
}

export default App;
