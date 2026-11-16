import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { BrowserQRCodeReader } from '@zxing/browser';
import { encodeShipmentQr } from '@tracechain/shared';
import qrcode from 'qrcode-generator';
import { describe, expect, it, vi } from 'vitest';

import {
  QrImageDecodeError,
  QrImageDecodeErrorCode,
  ZxingTransferQrReader,
  type QrImageRuntime,
} from './qr-reader';

const shipmentId =
  `0x${'6e8c5f830f776fa796a12f61ec987131c6bfeb4ecbcef5ba780e135b03ec121b'}` as const;
const payload = encodeShipmentQr({
  chainId: 31_337,
  kind: 'ingredient',
  ordersAddress: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  publicAppUrl: 'http://localhost:5173',
  shipmentId,
});

function renderQr(
  value: string,
  options: {
    alpha?: boolean;
    format?: 'image/jpeg' | 'image/png' | 'image/webp';
    scale?: number;
  } = {},
) {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  const quiet = 4;
  const scale = options.scale ?? 10;
  const size = (qr.getModuleCount() + quiet * 2) * scale;
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  if (!options.alpha) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
  }
  context.fillStyle = '#07111f';
  for (let row = 0; row < qr.getModuleCount(); row += 1) {
    for (let column = 0; column < qr.getModuleCount(); column += 1) {
      if (qr.isDark(row, column)) {
        context.fillRect((column + quiet) * scale, (row + quiet) * scale, scale, scale);
      }
    }
  }
  const format = options.format ?? 'image/png';
  return format === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer(format);
}

function fileFrom(bytes: Uint8Array, name: string, type: string) {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new File([arrayBuffer], name, { type });
}

function harness(file: File) {
  const browserReader = new BrowserQRCodeReader();
  const canvases: Canvas[] = [];
  const releaseImage = vi.fn();
  const revokeObjectUrl = vi.fn();
  const decodeFromImageUrl = vi.fn(async (_source?: string) => {
    const image = await loadImage(Buffer.from(await file.arrayBuffer()));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return browserReader.decodeFromCanvas(canvas as unknown as HTMLCanvasElement);
  });
  const runtime: QrImageRuntime = {
    createCanvas(width, height) {
      const canvas = createCanvas(width, height);
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    },
    createObjectUrl: () => 'blob:tracechain-qr-test',
    async loadImage() {
      return (await loadImage(Buffer.from(await file.arrayBuffer()))) as unknown as Awaited<
        ReturnType<QrImageRuntime['loadImage']>
      >;
    },
    releaseImage,
    revokeObjectUrl,
  };
  const reader = new ZxingTransferQrReader({
    imageRuntime: runtime,
    reader: {
      decodeFromCanvas: (canvas) => browserReader.decodeFromCanvas(canvas),
      decodeFromImageUrl,
    },
  });
  return { canvases, decodeFromImageUrl, reader, releaseImage, revokeObjectUrl };
}

describe('shared QR image decoder', () => {
  it('decodes the dense downloaded shipment PNG after the original ZXing attempt fails', async () => {
    const file = fileFrom(
      renderQr(payload),
      'tracechain-ingredient-delivery-Unsweetened-Cocoa-Powder (1)(1).png',
      'image/png',
    );
    const test = harness(file);

    await expect(test.decodeFromImageUrl('blob:tracechain-qr-test')).rejects.toMatchObject({
      name: 'NotFoundException',
    });
    test.decodeFromImageUrl.mockClear();
    await expect(test.reader.decodeImage(file)).resolves.toBe(payload);
    expect(test.decodeFromImageUrl).toHaveBeenCalledOnce();
    expect(test.canvases.length).toBeGreaterThan(1);
  });

  it('keeps the original decoding path for a normal generated shipment QR', async () => {
    const file = fileFrom(renderQr(payload, { scale: 4 }), 'shipment.png', 'image/png');
    const test = harness(file);

    await expect(test.reader.decodeImage(file)).resolves.toBe(payload);
    expect(test.decodeFromImageUrl).toHaveBeenCalledOnce();
    expect(test.canvases).toHaveLength(0);
  });

  it('flattens a transparent PNG onto white before decoding', async () => {
    const file = fileFrom(
      renderQr(payload, { alpha: true, scale: 6 }),
      'transparent.png',
      'image/png',
    );
    await expect(harness(file).reader.decodeImage(file)).resolves.toBe(payload);
  });

  it('decodes a resized QR image without changing its payload', async () => {
    const source = await loadImage(renderQr(payload, { scale: 4 }));
    const resized = createCanvas(417, 417);
    const context = resized.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, 417, 417);
    const file = fileFrom(resized.toBuffer('image/png'), 'resized.png', 'image/png');

    await expect(harness(file).reader.decodeImage(file)).resolves.toBe(payload);
  });

  it.each([
    ['image/jpeg', 'shipment.jpg'],
    ['image/webp', 'shipment.webp'],
  ] as const)('decodes a supported %s image', async (format, name) => {
    const file = fileFrom(renderQr(payload, { format, scale: 4 }), name, format);
    await expect(harness(file).reader.decodeImage(file)).resolves.toBe(payload);
  });

  it('returns a no-QR error for a valid blank image', async () => {
    const canvas = createCanvas(500, 500);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 500, 500);
    const file = fileFrom(canvas.toBuffer('image/png'), 'blank.png', 'image/png');

    await expect(harness(file).reader.decodeImage(file)).rejects.toMatchObject({
      code: QrImageDecodeErrorCode.NO_QR_DETECTED,
    });
  });

  it('returns an image error for corrupted bytes', async () => {
    const file = fileFrom(new Uint8Array([1, 2, 3, 4]), 'corrupted.png', 'image/png');
    await expect(harness(file).reader.decodeImage(file)).rejects.toMatchObject({
      code: QrImageDecodeErrorCode.IMAGE_LOAD_FAILED,
    });
  });

  it('cleans up the object URL, loaded image and temporary canvases', async () => {
    const file = fileFrom(renderQr(payload), 'cleanup.png', 'image/png');
    const test = harness(file);
    await test.reader.decodeImage(file);

    expect(test.revokeObjectUrl).toHaveBeenCalledOnce();
    expect(test.releaseImage).toHaveBeenCalledOnce();
    expect(test.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('rejects unsupported files before creating an object URL', async () => {
    const file = fileFrom(new Uint8Array([1]), 'label.gif', 'image/gif');
    const test = harness(file);
    await expect(test.reader.decodeImage(file)).rejects.toBeInstanceOf(QrImageDecodeError);
    expect(test.revokeObjectUrl).not.toHaveBeenCalled();
  });
});
