import { Check, Clipboard, Download, Printer, QrCode } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  createProductQrModel,
  productQrPngFilename,
  type ProductQrConfiguration,
  type ProductQrModel,
} from './product-qr';
import './product-traceability.css';

export function ProductQrDisplay({
  batchId,
  configuration,
}: {
  batchId: string;
  configuration?: ProductQrConfiguration;
}) {
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => {
    try {
      return { model: createProductQrModel(batchId, configuration) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'The product QR could not be created.',
      };
    }
  }, [batchId, configuration]);
  if (!result.model)
    return (
      <div className="product-trace-error" role="alert">
        <QrCode aria-hidden="true" /> {result.error}
      </div>
    );
  const model = result.model;
  return (
    <section className="product-qr-label" aria-label="Product Traceability QR">
      <div>
        <span className="product-trace-eyebrow">TraceChain</span>
        <h3>Product Traceability QR</h3>
        <p>Open with a phone camera to view the blockchain traceability record.</p>
      </div>
      <QrSvg model={model} />
      <div className="product-qr-actions">
        <button type="button" onClick={() => downloadPng(model, batchId)}>
          <Download size={15} /> Download PNG
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(model.payload).then(() => setCopied(true));
          }}
        >
          {copied ? <Check size={15} /> : <Clipboard size={15} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" onClick={() => window.print()}>
          <Printer size={15} /> Print label
        </button>
      </div>
      <small>Contains only version, chain, ProductRegistry address, and product batch ID.</small>
    </section>
  );
}

function QrSvg({ model }: { model: ProductQrModel }) {
  const size = model.modules.length;
  return (
    <svg
      className="product-qr-svg"
      aria-label="TraceChain product traceability QR code"
      role="img"
      viewBox={`-4 -4 ${size + 8} ${size + 8}`}
    >
      <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="#fff" />
      {model.modules.flatMap((row, rowIndex) =>
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
  );
}

function downloadPng(model: ProductQrModel, batchId: string) {
  const quiet = 4;
  const scale = 10;
  const canvas = document.createElement('canvas');
  canvas.width = (model.modules.length + quiet * 2) * scale;
  canvas.height = canvas.width;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#07111f';
  model.modules.forEach((row, rowIndex) =>
    row.forEach((dark, columnIndex) => {
      if (dark)
        context.fillRect((columnIndex + quiet) * scale, (rowIndex + quiet) * scale, scale, scale);
    }),
  );
  const link = document.createElement('a');
  link.download = productQrPngFilename(batchId);
  link.href = canvas.toDataURL('image/png');
  link.click();
}
