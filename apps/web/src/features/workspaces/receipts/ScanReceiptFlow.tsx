import { ReceiptGatedFlow } from './ReceiptGatedFlow';

export function ScanReceiptFlow({
  role,
  onDone,
}: {
  role: 'distributor' | 'retailer';
  onDone: () => void;
}) {
  return <ReceiptGatedFlow role={role} onDone={onDone} />;
}
