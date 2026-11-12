const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 10_000;

export const catalogueImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type CatalogueImageMimeType = (typeof catalogueImageMimeTypes)[number];

export interface CatalogueImageInput {
  data: string;
  fileName: string;
  mimeType: CatalogueImageMimeType;
}

export interface StoredCatalogueImage {
  data: string;
  height: number;
  mimeType: CatalogueImageMimeType;
  version: 1;
  width: number;
}

export class CatalogueImageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function validateCatalogueImage(input: CatalogueImageInput): StoredCatalogueImage {
  if (!catalogueImageMimeTypes.includes(input.mimeType))
    throw new CatalogueImageError('IMAGE_TYPE_UNSUPPORTED', 'Choose a PNG, JPEG or WebP image.');
  const extension = input.fileName.split('.').pop()?.toLowerCase();
  const expectedExtensions: Record<CatalogueImageMimeType, string[]> = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/webp': ['webp'],
  };
  if (!extension || !expectedExtensions[input.mimeType].includes(extension))
    throw new CatalogueImageError(
      'IMAGE_TYPE_MISMATCH',
      'The filename extension does not match the selected image type.',
    );
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))
    throw new CatalogueImageError('IMAGE_INVALID', 'The image data is invalid or corrupted.');
  const bytes = Buffer.from(input.data, 'base64');
  if (!bytes.length)
    throw new CatalogueImageError('IMAGE_INVALID', 'The image data is invalid or corrupted.');
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new CatalogueImageError('IMAGE_TOO_LARGE', 'Images must not exceed 2 MB.');
  const dimensions = dimensionsFor(bytes, input.mimeType);
  if (
    !dimensions ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION
  )
    throw new CatalogueImageError(
      'IMAGE_INVALID',
      'The image is corrupt or has invalid dimensions.',
    );
  return {
    data: bytes.toString('base64'),
    height: dimensions.height,
    mimeType: input.mimeType,
    version: 1,
    width: dimensions.width,
  };
}

export function decodeStoredCatalogueImage(value: unknown) {
  const image = value as Partial<StoredCatalogueImage>;
  if (
    image.version !== 1 ||
    typeof image.data !== 'string' ||
    !catalogueImageMimeTypes.includes(image.mimeType as CatalogueImageMimeType)
  )
    throw new CatalogueImageError('IMAGE_UNAVAILABLE', 'The catalogue image is unavailable.');
  const checked = validateCatalogueImage({
    data: image.data,
    fileName: `catalogue.${extensionFor(image.mimeType as CatalogueImageMimeType)}`,
    mimeType: image.mimeType as CatalogueImageMimeType,
  });
  return { ...checked, bytes: Buffer.from(checked.data, 'base64') };
}

export function extensionFor(mimeType: CatalogueImageMimeType) {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
}

function dimensionsFor(bytes: Buffer, mimeType: CatalogueImageMimeType) {
  if (mimeType === 'image/png') {
    if (
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
    )
      return undefined;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    )
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    offset += length;
  }
  return undefined;
}

function webpDimensions(bytes: Buffer) {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  )
    return undefined;
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X')
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  if (chunk === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a])))
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const b1 = bytes[21],
      b2 = bytes[22],
      b3 = bytes[23],
      b4 = bytes[24];
    return {
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    };
  }
  return undefined;
}
