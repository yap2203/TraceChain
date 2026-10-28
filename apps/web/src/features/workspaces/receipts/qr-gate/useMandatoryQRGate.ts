import { useState, useEffect, useRef, useCallback } from 'react';
import { TRANSFERS } from '../fixtures';
import { type CameraPhase, type QRValidationError } from '../types';
export function useMandatoryQRGate({
  expectedTransferId,
  role,
  onVerified,
  onBack,
}: {
  expectedTransferId?: string;
  role: 'distributor' | 'retailer';
  onVerified: (transferId: string, method: 'camera' | 'upload') => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<'camera' | 'upload'>('camera');
  const [cameraPhase, setCamPhase] = useState<CameraPhase>('idle');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setPreview] = useState<string | null>(null);
  const [readingQR, setReadingQR] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<QRValidationError | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [verified, setVerified] = useState<{
    transferId: string;
    method: 'camera' | 'upload';
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    },
    [uploadPreview],
  );

  const expectedRecipient =
    role === 'distributor' ? 'Swift Distribution Sdn. Bhd.' : 'FreshMart Retail Sdn. Bhd.';

  const validate = (id: string, method: 'camera' | 'upload') => {
    const transfer = TRANSFERS[id];
    if (!transfer) {
      setError('unknown');
      return false;
    }
    if (transfer.status === 'received') {
      setError('already_received');
      return false;
    }
    if (transfer.status === 'cancelled' || transfer.status === 'rejected') {
      setError('cancelled');
      return false;
    }
    if (transfer.recipient !== expectedRecipient) {
      setError('wrong_recipient');
      return false;
    }
    if (expectedTransferId && id !== expectedTransferId) {
      setError('wrong_shipment');
      return false;
    }
    setError(null);
    setVerified({ transferId: id, method });
    return true;
  };

  const startCamera = () => {
    setCamPhase('requesting');
    setTimeout(() => setCamPhase('active'), 800);
  };

  const simulateCameraScan = () => {
    setCamPhase('scanning');
    setValidating(true);
    setTimeout(() => {
      const id =
        expectedTransferId ?? (role === 'distributor' ? 'TRANSFER-2026-001' : 'TRANSFER-2026-002');
      validate(id, 'camera');
      setValidating(false);
      setCamPhase('active');
    }, 1600);
  };

  const handleFileSelect = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      setError('img_format');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('img_size');
      return;
    }
    setError(null);
    setUploadFile(file);
    const url = URL.createObjectURL(file);
    setPreview(url);
  };

  const readUploadedQR = () => {
    if (!uploadFile) return;
    setReadingQR(true);
    setTimeout(() => {
      setReadingQR(false);
      const id =
        expectedTransferId ?? (role === 'distributor' ? 'TRANSFER-2026-001' : 'TRANSFER-2026-002');
      validate(id, 'upload');
    }, 1800);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  return {
    tab,
    setTab,
    cameraPhase,
    setCamPhase,
    uploadFile,
    setUploadFile,
    uploadPreview,
    setPreview,
    readingQR,
    setReadingQR,
    validating,
    setValidating,
    error,
    setError,
    requestSent,
    setRequestSent,
    verified,
    setVerified,
    fileRef,
    dropRef,
    expectedRecipient,
    validate,
    startCamera,
    simulateCameraScan,
    handleFileSelect,
    readUploadedQR,
    handleDrop,
    expectedTransferId,
    role,
    onVerified,
    onBack,
  };
}
export type QrGateModel = ReturnType<typeof useMandatoryQRGate>;
