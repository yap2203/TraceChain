import { ProductInformation } from './sections/ProductInformation';
import { ManufacturerVerification } from './sections/ManufacturerVerification';
import { IngredientVerification } from './sections/IngredientVerification';
import { CustodyTransferTimeline } from './sections/CustodyTransferTimeline';
import { QuantityReconciliation } from './sections/QuantityReconciliation';
import { CredentialStatusHistory } from './sections/CredentialStatusHistory';
import { BlockchainReferences } from './sections/BlockchainReferences';
import { IntegrityChecks } from './sections/IntegrityChecks';
import { T, Btn, Badge, SectionTitle } from '../shared/ui';

export default function AuditReport() {
  return (
    <div>
      <SectionTitle
        title="Product History Audit Report"
        sub="CHOCOLATE-2026-050 · Generated 2026-08-09 · By Product Traceability Authority"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="outline" size="sm">
              Export PDF
            </Btn>
            <Btn variant="outline" size="sm">
              Export CSV
            </Btn>
            <Btn variant="outline" size="sm">
              Print
            </Btn>
          </div>
        }
      />

      {/* Overall result banner */}
      <div
        style={{
          background: T.greenBg,
          border: `1px solid color-mix(in srgb, ${T.green} 19%, transparent)`,
          borderRadius: 12,
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: T.green }}>
            All Checks Passed — Product Verified
          </div>
          <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>
            All ingredient credentials valid · Custody chain complete · No integrity failures
            detected
          </div>
        </div>
        <Badge label="verified" variant="verified" />
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <ProductInformation />
        <ManufacturerVerification />
        <IngredientVerification />
        <CustodyTransferTimeline />
        <QuantityReconciliation />
        <CredentialStatusHistory />
        <BlockchainReferences />
        <IntegrityChecks />
      </div>
    </div>
  );
}
