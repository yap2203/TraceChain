import { type QRValidationError } from './types';

export const RECEIPT_STEPS = [
  'Scan or Upload Evidence',
  'Review Shipment',
  'Check Quantities',
  'Sign and Confirm',
];

export const TRANSFERS: Record<
  string,
  {
    id: string;
    sender: string;
    senderDid: string;
    recipient: string;
    recipientDid: string;
    product: string;
    batch: string;
    qty: number;
    dispatch: string;
    notes: string;
    status: 'awaiting' | 'received' | 'rejected' | 'cancelled';
    receivedDate?: string;
    receivedQty?: number;
    usableQty?: number;
    txHash?: string;
  }
> = {
  'TRANSFER-2026-001': {
    id: 'TRANSFER-2026-001',
    sender: 'CocoaCraft Manufacturing Sdn. Bhd.',
    senderDid: 'did:ethr:0x7B82…44A1',
    recipient: 'Swift Distribution Sdn. Bhd.',
    recipientDid: 'did:ethr:0x5C91…19D4',
    product: 'Milk Chocolate',
    batch: 'CHOCOLATE-2026-050',
    qty: 500,
    dispatch: '2026-08-05',
    notes: 'Keep refrigerated between 15–20°C.',
    status: 'awaiting',
  },
  'TRANSFER-2026-002': {
    id: 'TRANSFER-2026-002',
    sender: 'Swift Distribution Sdn. Bhd.',
    senderDid: 'did:ethr:0x5C91…19D4',
    recipient: 'FreshMart Retail Sdn. Bhd.',
    recipientDid: 'did:ethr:0x2D18…73B2',
    product: 'Milk Chocolate',
    batch: 'CHOCOLATE-2026-050',
    qty: 490,
    dispatch: '2026-08-09',
    notes: 'Handle with care. Stack max 5 pallets.',
    status: 'awaiting',
  },
};

export const QR_ERROR_MESSAGES: Record<QRValidationError, string> = {
  wrong_shipment: 'This QR belongs to a different shipment. Scan the QR for the selected transfer.',
  product_qr:
    "This QR opens product history. Scan the shipment's Receipt Confirmation QR to confirm receipt.",
  unknown: 'No QR code was found or the reference is unknown. Try again.',
  already_received: 'This shipment has already been received. No further confirmation is required.',
  wrong_recipient:
    "You are not authorised to receive this shipment. Sign in with the intended recipient's wallet.",
  cancelled: 'This transfer is no longer available for receipt confirmation.',
  img_no_qr: 'No QR code was found. Upload a clearer image showing the complete code.',
  img_multi_qr: 'Several QR codes were found. Crop the image to show only the shipment QR.',
  img_format: 'Unsupported image format. Upload a PNG or JPG.',
  img_size: 'The image is too large. Maximum size is 10 MB.',
};
