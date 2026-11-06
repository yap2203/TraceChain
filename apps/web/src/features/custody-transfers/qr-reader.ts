import type { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';

export interface TransferQrReader {
  decodeImage(file: File): Promise<string>;
  startCamera(
    video: HTMLVideoElement,
    onResult: (payload: string) => void,
    onError: (error: unknown) => void,
  ): Promise<() => void>;
}

function stopVideo(video: HTMLVideoElement) {
  const stream = video.srcObject;
  if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  video.srcObject = null;
}

export class ZxingTransferQrReader implements TransferQrReader {
  private readerPromise: Promise<BrowserQRCodeReader> | undefined;

  private getReader() {
    this.readerPromise ??= import('@zxing/browser').then(
      ({ BrowserQRCodeReader: Reader }) => new Reader(),
    );
    return this.readerPromise;
  }

  async decodeImage(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const reader = await this.getReader();
      const result = await reader.decodeFromImageUrl(url);
      return result.getText();
    } finally {
      URL.revokeObjectURL(url);
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
      const reader = await this.getReader();
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

          if (error && error.name !== 'NotFoundException') {
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

export function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Use image upload or manual paste instead.';
  }
  if (message === 'CAMERA_UNSUPPORTED' || name === 'NotFoundError') {
    return 'No supported camera is available. Use image upload or manual paste instead.';
  }
  return 'The camera stopped unexpectedly. Restart it or use another scan method.';
}
