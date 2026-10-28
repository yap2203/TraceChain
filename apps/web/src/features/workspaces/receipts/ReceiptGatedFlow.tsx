import { useState } from 'react';
import { MandatoryQRGate } from './qr-gate/MandatoryQRGate';
import { ReviewAndConfirmReceipt } from './confirmation/ReviewAndConfirmReceipt';

export function ReceiptGatedFlow({
  role,
  expectedTransferId,
  onDone,
}: {
  role: 'distributor' | 'retailer';
  expectedTransferId?: string;
  onDone: () => void;
}) {
  const [verified, setVerified] = useState<{ id: string; method: 'camera' | 'upload' } | null>(
    null,
  );

  if (verified) {
    return (
      <ReviewAndConfirmReceipt
        transferId={verified.id}
        identificationMethod={verified.method}
        showProgress
        onBack={() => {
          setVerified(null);
          onDone();
        }}
      />
    );
  }
  return (
    <MandatoryQRGate
      role={role}
      expectedTransferId={expectedTransferId}
      onVerified={(id, method) => setVerified({ id, method })}
      onBack={onDone}
    />
  );
}
