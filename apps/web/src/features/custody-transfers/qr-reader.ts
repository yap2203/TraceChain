import type { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';

export interface TransferQrReader {
  decodeImage(file: File): Promise<string>;
  startCamera(
    video: HTMLVideoElement,
    onResult: (payload: string) => void,
    onError: (error: unknown) => void,
  ): Promise<() => void>;
}

export const QrImageDecodeErrorCode = {
  DECODER_FAILED: 'DECODER_FAILED',
  IMAGE_LOAD_FAILED: 'IMAGE_LOAD_FAILED',
  NO_QR_DETECTED: 'NO_QR_DETECTED',
  UNSUPPORTED_IMAGE: 'UNSUPPORTED_IMAGE',
} as const;

export type QrImageDecodeErrorCodeValue =
  (typeof QrImageDecodeErrorCode)[keyof typeof QrImageDecodeErrorCode];

export class QrImageDecodeError extends Error {
  constructor(
    readonly code: QrImageDecodeErrorCodeValue,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'QrImageDecodeError';
  }
}

interface QrResult {
  getText(): string;
}

interface QrImageDecoder {
  decodeFromCanvas(canvas: HTMLCanvasElement): QrResult;
  decodeFromImageUrl(url: string): Promise<QrResult>;
}

type LoadedQrImage = CanvasImageSource & {
  height: number;
  naturalHeight?: number;
  naturalWidth?: number;
  width: number;
};

export interface QrImageRuntime {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  createObjectUrl(file: File): string;
  loadImage(url: string): Promise<LoadedQrImage>;
  releaseImage(image: LoadedQrImage): void;
  revokeObjectUrl(url: string): void;
}

export interface ZxingTransferQrReaderOptions {
  imageRuntime?: QrImageRuntime;
  reader?: QrImageDecoder;
}

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function defaultImageRuntime(): QrImageRuntime {
  return {
    createCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    createObjectUrl: (file) => URL.createObjectURL(file),
    loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The selected image could not be loaded.'));
        image.src = url;
      });
    },
    releaseImage(image) {
      if (image instanceof HTMLImageElement) {
        image.onload = null;
        image.onerror = null;
        image.src = '';
      }
    },
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}

function stopVideo(video: HTMLVideoElement) {
  const stream = video.srcObject;
  if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  video.srcObject = null;
}

function isNoQrError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    ['NotFoundException', 'ChecksumException', 'FormatException'].includes(
      String((error as { name?: string }).name),
    )
  );
}

function imageSize(image: LoadedQrImage) {
  return {
    height: image.naturalHeight || image.height,
    width: image.naturalWidth || image.width,
  };
}

function resizeAttempts(width: number, height: number) {
  const longest = Math.max(width, height);
  const factors = longest < 420 ? [1, 2, 3, 0.75] : [1, 0.75, 0.5, 0.375, 1.5];
  const seen = new Set<string>();
  return factors
    .map((factor) => ({
      height: Math.max(1, Math.round(height * factor)),
      width: Math.max(1, Math.round(width * factor)),
    }))
    .filter(({ height: nextHeight, width: nextWidth }) => {
      if (Math.max(nextHeight, nextWidth) > 4096 || Math.min(nextHeight, nextWidth) < 96)
        return false;
      const key = `${nextWidth}x${nextHeight}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function drawImage(runtime: QrImageRuntime, image: LoadedQrImage, width: number, height: number) {
  const canvas = runtime.createCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas image processing is unavailable.');
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function makeHighContrast(canvas: HTMLCanvasElement, runtime: QrImageRuntime) {
  const result = runtime.createCanvas(canvas.width, canvas.height);
  const source = canvas.getContext('2d', { willReadFrequently: true });
  const target = result.getContext('2d', { willReadFrequently: true });
  if (!source || !target) throw new Error('Canvas image processing is unavailable.');
  const imageData = source.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    const value = luminance < 160 ? 0 : 255;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
    pixels[index + 3] = 255;
  }
  target.putImageData(imageData, 0, 0);
  return result;
}

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>>;
};

async function detectWithBrowserBarcodeDetector(canvas: HTMLCanvasElement) {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return undefined;
  try {
    const results = await new Detector({ formats: ['qr_code'] }).detect(canvas);
    return results.find((result) => result.rawValue?.trim())?.rawValue;
  } catch {
    return undefined;
  }
}

export class ZxingTransferQrReader implements TransferQrReader {
  private readerPromise: Promise<QrImageDecoder> | undefined;
  private readonly injectedReader?: QrImageDecoder;
  private readonly imageRuntime: QrImageRuntime;

  constructor(options: ZxingTransferQrReaderOptions = {}) {
    this.injectedReader = options.reader;
    this.imageRuntime = options.imageRuntime ?? defaultImageRuntime();
    if (options.reader) this.readerPromise = Promise.resolve(options.reader);
  }

  private getReader() {
    this.readerPromise ??= import('@zxing/browser')
      .then(({ BrowserQRCodeReader: Reader }) => new Reader() as QrImageDecoder)
      .catch((cause) => {
        this.readerPromise = undefined;
        throw cause;
      });
    return this.readerPromise;
  }

  async decodeImage(file: File) {
    if (!supportedImageTypes.has(file.type)) {
      throw new QrImageDecodeError(
        QrImageDecodeErrorCode.UNSUPPORTED_IMAGE,
        'The selected file is not a supported QR image.',
      );
    }

    const runtime = this.imageRuntime;
    const url = runtime.createObjectUrl(file);
    const canvases: HTMLCanvasElement[] = [];
    let image: LoadedQrImage | undefined;
    let originalError: unknown;
    let unexpectedError: unknown;

    try {
      // Image attempts must not share mutable ZXing state with the live camera or another upload.
      let reader: QrImageDecoder | undefined = this.injectedReader;
      let pureReader: QrImageDecoder | undefined;
      try {
        const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        reader ??= new BrowserQRCodeReader();
        // Clean downloaded labels avoid detector alignment estimation for dense version-11 symbols.
        pureReader = new BrowserQRCodeReader(new Map([[DecodeHintType.PURE_BARCODE, true]]));
      } catch (error) {
        originalError = error;
        unexpectedError = error;
      }
      if (reader)
        try {
          return (await reader.decodeFromImageUrl(url)).getText();
        } catch (error) {
          originalError = error;
          if (!isNoQrError(error)) unexpectedError = error;
        }

      try {
        image = await runtime.loadImage(url);
      } catch (error) {
        throw new QrImageDecodeError(
          QrImageDecodeErrorCode.IMAGE_LOAD_FAILED,
          'The selected image is corrupted or could not be opened.',
          error,
        );
      }

      const { height, width } = imageSize(image);
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        width * height > 32_000_000
      ) {
        throw new QrImageDecodeError(
          QrImageDecodeErrorCode.IMAGE_LOAD_FAILED,
          'The selected image has no readable pixels.',
          originalError,
        );
      }

      for (const size of resizeAttempts(width, height)) {
        const canvas = drawImage(runtime, image, size.width, size.height);
        canvases.push(canvas);
        for (const candidate of [reader, pureReader])
          if (candidate)
            try {
              return candidate.decodeFromCanvas(canvas).getText();
            } catch (error) {
              if (!isNoQrError(error)) unexpectedError ??= error;
            }

        const detected = await detectWithBrowserBarcodeDetector(canvas);
        if (detected) return detected;

        const highContrast = makeHighContrast(canvas, runtime);
        canvases.push(highContrast);
        for (const candidate of [reader, pureReader])
          if (candidate)
            try {
              return candidate.decodeFromCanvas(highContrast).getText();
            } catch (error) {
              if (!isNoQrError(error)) unexpectedError ??= error;
            }
      }

      if (unexpectedError) {
        throw new QrImageDecodeError(
          QrImageDecodeErrorCode.DECODER_FAILED,
          'The QR decoder stopped unexpectedly while reading this image.',
          unexpectedError,
        );
      }
      throw new QrImageDecodeError(
        QrImageDecodeErrorCode.NO_QR_DETECTED,
        'No QR code was detected in the selected image.',
        originalError,
      );
    } finally {
      canvases.forEach((canvas) => {
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove?.();
      });
      if (image) runtime.releaseImage(image);
      runtime.revokeObjectUrl(url);
    }
  }

  async startCamera(
    video: HTMLVideoElement,
    onResult: (payload: string) => void,
    onError: (error: unknown) => void,
  ) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('CAMERA_UNSUPPORTED');
    }

    let scannerControls: IScannerControls | undefined;
    const stop = () => {
      scannerControls?.stop();
      stopVideo(video);
    };

    try {
      const reader = (await this.getReader()) as BrowserQRCodeReader;
      scannerControls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, error, controls) => {
          if (result) {
            controls.stop();
            stopVideo(video);
            onResult(result.getText());
            return;
          }

          if (error && !isNoQrError(error)) {
            controls.stop();
            stopVideo(video);
            onError(error);
          }
        },
      );
      return stop;
    } catch (error) {
      stop();
      throw error;
    }
  }
}

export function qrImageErrorMessage(error: unknown) {
  if (error instanceof QrImageDecodeError) {
    if (error.code === QrImageDecodeErrorCode.NO_QR_DETECTED)
      return 'No QR code was detected in the selected image.';
    if (error.code === QrImageDecodeErrorCode.IMAGE_LOAD_FAILED)
      return 'The selected image is corrupted or could not be opened.';
    if (error.code === QrImageDecodeErrorCode.UNSUPPORTED_IMAGE)
      return 'Choose a PNG, JPEG or WebP image containing a QR code.';
  }
  return 'The QR image decoder stopped unexpectedly. Try another image or use the camera.';
}

export function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Upload a QR image instead.';
  }
  if (message === 'CAMERA_UNSUPPORTED' || name === 'NotFoundError') {
    return 'No supported camera is available. Upload a QR image instead.';
  }
  return 'The camera stopped unexpectedly. Restart it or use another scan method.';
}
