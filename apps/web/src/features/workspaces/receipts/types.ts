export type ScanState =
  | 'idle'
  | 'camera'
  | 'searching'
  | 'found'
  | 'wrong_recipient'
  | 'already_received'
  | 'cancelled'
  | 'unknown'
  | 'product_qr';

export type CameraPhase = 'idle' | 'requesting' | 'active' | 'scanning' | 'denied' | 'unavailable';

export type QRValidationError =
  | 'wrong_shipment'
  | 'product_qr'
  | 'unknown'
  | 'already_received'
  | 'wrong_recipient'
  | 'cancelled'
  | 'img_no_qr'
  | 'img_multi_qr'
  | 'img_format'
  | 'img_size';

export type ConfirmStep = 'review' | 'confirm' | 'signing' | 'success';
