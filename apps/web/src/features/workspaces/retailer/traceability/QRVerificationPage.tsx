import { ProductTraceabilityPage } from '../../../product-traceability';

export function QRVerification({
  initialBatch,
  onBack,
}: {
  initialBatch?: string;
  onBack: () => void;
}) {
  return <ProductTraceabilityPage initialBatchId={initialBatch} onBack={onBack} />;
}
