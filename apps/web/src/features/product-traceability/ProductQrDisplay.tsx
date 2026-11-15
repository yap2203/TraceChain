import { reportError } from '../../components/ui/feedback';
import { Check, Clipboard, Download, Printer, QrCode } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  createProductQrModel,
  createQrModel,
  productQrPngFilename,
  type ProductQrConfiguration,
  type ProductQrModel,
} from './product-qr';
import './product-traceability.css';

export function ProductQrDisplay({
  batchId,
  batchReference,
  configuration,
  productName,
  encodedPayload,
  labelTitle = 'Product Traceability QR',
  instruction = 'Scan with a phone camera to view the blockchain traceability record.',
}: {
  batchId: string;
  batchReference: string;
  configuration?: ProductQrConfiguration;
  productName: string;
  encodedPayload?: string;
  labelTitle?: string;
  instruction?: string;
}) {
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => {
    try {
      return {
        model: encodedPayload
          ? createQrModel(encodedPayload)
          : createProductQrModel(batchId, configuration),
      };
    } catch (error) {
      return {
        error: reportError(error, 'The product QR could not be created.'),
      };
    }
  }, [batchId, configuration, encodedPayload]);
  if (!result.model)
    return (
      <div className="product-trace-error" role="alert">
        <QrCode aria-hidden="true" /> {result.error}
      </div>
    );
  const model = result.model;
  return (
    <section className="product-qr-label" aria-label={labelTitle}>
      <div>
        <span className="product-trace-eyebrow">TraceChain</span>
        <h3>{labelTitle}</h3>
        <div className="product-qr-identity">
          <strong>{productName || 'Registered product'}</strong>
          <span>{batchReference || 'Batch reference unavailable'}</span>
        </div>
      </div>
      <QrSvg model={model} delivery={!!encodedPayload} />
      <p>{instruction}</p>
      <div className="product-qr-actions">
        <button type="button" onClick={() => downloadPng(model, batchReference, !!encodedPayload)}>
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
      <small>
        {encodedPayload
          ? 'Contains only version, chain, Orders registry address and request ID. Scanning alone does not confirm receipt.'
          : 'Contains only version, chain, ProductRegistry address, and product batch ID.'}
      </small>
    </section>
  );
}

function QrSvg({ model, delivery }: { model: ProductQrModel; delivery?: boolean }) {
  const size = model.modules.length;
  return (
    <svg
      className="product-qr-svg"
      aria-label={
        delivery
          ? 'TraceChain ingredient delivery QR code'
          : 'TraceChain product traceability QR code'
      }
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

function downloadPng(model: ProductQrModel, batchReference: string, delivery = false) {
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
  link.download = delivery
    ? productQrPngFilename(batchReference).replace(
        'tracechain-product-',
        'tracechain-ingredient-delivery-',
      )
    : productQrPngFilename(batchReference);
  link.href = canvas.toDataURL('image/png');
  link.click();
}
