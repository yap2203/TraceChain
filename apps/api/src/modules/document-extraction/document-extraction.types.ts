export const INGREDIENT_DOCUMENT_FIELDS = [
  'ingredientName',
  'batchReference',
  'category',
  'origin',
  'productionDate',
  'expiryDate',
  'quantity',
  'unit',
  'price',
  'currency',
  'certifications',
  'allergenInformation',
] as const;

export type IngredientDocumentField = (typeof INGREDIENT_DOCUMENT_FIELDS)[number];
export type ExtractionConfidence = 'High' | 'Review required' | 'Missing';
export type SupportedDocumentFormat = 'pdf' | 'docx' | 'png' | 'jpeg';

export interface ExtractedIngredientField {
  confidence: ExtractionConfidence;
  value: string;
}

export type ExtractedIngredientFields = Record<IngredientDocumentField, ExtractedIngredientField>;

export interface DocumentExtractionResult {
  document: {
    filename: string;
    format: SupportedDocumentFormat;
    mimeType: string;
    pageCount?: number;
    size: number;
  };
  fields: ExtractedIngredientFields;
  warnings: string[];
}

export interface ExtractedDocumentText {
  pageCount?: number;
  text: string;
  warnings: string[];
}

export interface DocumentTextExtractor {
  extract(buffer: Buffer): Promise<ExtractedDocumentText>;
}

export interface UploadedDocument {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}
