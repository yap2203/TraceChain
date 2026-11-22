import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

// Compatible companion deployment: point this at an existing trusted registry.
export default buildModule('CompanyProofs', (m) => {
  const stakeholders = m.getParameter('stakeholderRegistry');
  const companyProofs = m.contract('CompanyProofRegistry', [stakeholders]);
  return { companyProofs };
});
