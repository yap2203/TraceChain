import { TransferQrScanner } from '../../custody-transfers';

export function ReceiptGatedFlow({
  onDone,
}: {
  role: 'distributor' | 'retailer';
  expectedTransferId?: string;
  onDone: () => void;
}) {
  return <TransferQrScanner onClose={onDone} />;
}
