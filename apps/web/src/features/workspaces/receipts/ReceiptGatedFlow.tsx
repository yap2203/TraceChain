import { TransferQrScanner } from '../../custody-transfers';
import { useOperationalData } from '../../blockchain/useOperationalData';

export function ReceiptGatedFlow({
  onDone,
}: {
  role: 'distributor' | 'retailer';
  expectedTransferId?: string;
  onDone: () => void;
}) {
  const { reload } = useOperationalData();
  return <TransferQrScanner onClose={onDone} onResolved={() => void reload()} />;
}
