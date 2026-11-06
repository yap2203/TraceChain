import { Download, QrCode } from 'lucide-react';
import { useMemo } from 'react';

import type { TransferQrConfiguration } from './custody-transfer.types';
import { createTransferQrModel, type TransferQrModel } from './transfer-qr';
import './custody-transfer.css';

interface TransferQrDisplayProps {
  configuration?: TransferQrConfiguration;
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

export function TransferQrDisplay({ configuration, transferId }: TransferQrDisplayProps) {
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
    <section className="transfer-qr-display" aria-label="Custody transfer QR code">
      <div className="transfer-qr-canvas">
        <svg
          aria-label="TraceChain custody-transfer QR code"
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
      <button
        className="transfer-qr-button"
        onClick={() => downloadPng(result.model!, transferId)}
        type="button"
      >
        <Download aria-hidden="true" size={16} />
        Download PNG
      </button>
      <p>Contains only the chain, CustodyTransfer contract, and transfer ID.</p>
    </section>
  );
}
