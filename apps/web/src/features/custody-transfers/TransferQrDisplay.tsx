import { Check, Copy, Download, Printer, QrCode } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { TransferQrConfiguration } from './custody-transfer.types';
import { createTransferQrModel, type TransferQrModel } from './transfer-qr';
import './custody-transfer.css';

interface TransferQrDisplayProps {
  configuration?: TransferQrConfiguration;
  shipmentReference?: string;
  transferId: string;
}

function downloadPng(model: TransferQrModel, transferId: string) {
  const quietZone = 4;
  const scale = 10;
  const moduleCount = model.modules.length;
  const canvas = document.createElement('canvas');
  canvas.width = (moduleCount + quietZone * 2) * scale;
  canvas.height = canvas.width;
  const context = canvas.getContext('2d');
  if (!context) return;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#07111f';
  model.modules.forEach((row, rowIndex) => {
    row.forEach((dark, columnIndex) => {
      if (dark) {
        context.fillRect(
          (columnIndex + quietZone) * scale,
          (rowIndex + quietZone) * scale,
          scale,
          scale,
        );
      }
    });
  });

  const link = document.createElement('a');
  link.download = `tracechain-transfer-${transferId.slice(2, 10)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function TransferQrDisplay({
  configuration,
  shipmentReference,
  transferId,
}: TransferQrDisplayProps) {
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => {
    try {
      return { model: createTransferQrModel(transferId, configuration) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'The transfer QR could not be generated.',
      };
    }
  }, [configuration, transferId]);

  if (!result.model) {
    return (
      <div className="transfer-qr-error" role="alert">
        <QrCode aria-hidden="true" size={22} />
        <span>{result.error}</span>
      </div>
    );
  }

  const size = result.model.modules.length;
  return (
    <section className="transfer-qr-display" aria-label="Receipt Confirmation QR">
      <div className="transfer-qr-heading">
        <strong>Receipt Confirmation QR</strong>
        {shipmentReference && <span>{shipmentReference}</span>}
      </div>
      <div className="transfer-qr-canvas">
        <svg
          aria-label="TraceChain Receipt Confirmation QR code"
          role="img"
          viewBox={`-4 -4 ${size + 8} ${size + 8}`}
        >
          <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="#ffffff" />
          {result.model.modules.flatMap((row, rowIndex) =>
            row.map((dark, columnIndex) =>
              dark ? (
                <rect
                  key={`${rowIndex}-${columnIndex}`}
                  x={columnIndex}
                  y={rowIndex}
                  width="1"
                  height="1"
                  fill="#07111f"
                />
              ) : null,
            ),
          )}
        </svg>
      </div>
      <div className="transfer-qr-actions">
        <button
          className="transfer-qr-button"
          onClick={() => downloadPng(result.model!, transferId)}
          type="button"
        >
          <Download aria-hidden="true" size={16} /> Download PNG
        </button>
        <button
          className="transfer-qr-secondary"
          onClick={() =>
            void navigator.clipboard.writeText(result.model!.payload).then(() => setCopied(true))
          }
          type="button"
        >
          {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button className="transfer-qr-secondary" onClick={() => window.print()} type="button">
          <Printer aria-hidden="true" size={16} /> Print label
        </button>
      </div>
      <p>
        Only the intended recipient can sign in and confirm receipt. This is separate from the
        Product Traceability QR.
      </p>
    </section>
  );
}
