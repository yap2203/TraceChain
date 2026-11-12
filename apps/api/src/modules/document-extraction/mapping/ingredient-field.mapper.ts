import { ingredientBatchRequestSchema } from '../../ingredient-batches/ingredient-batch.schema.js';
import {
  INGREDIENT_DOCUMENT_FIELDS,
  type ExtractedIngredientField,
  type ExtractedIngredientFields,
} from '../document-extraction.types.js';

type SourceKind = 'document' | 'ocr';

const aliases: Record<keyof ExtractedIngredientFields, string[]> = {
  allergenInformation: [
    'allergen information',
    'allergen declaration',
    'allergens',
    'handling notes',
  ],
  batchReference: [
    'supplier batch reference',
    'batch reference',
    'batch number',
    'batch no',
    'lot number',
    'lot no',
  ],
  category: ['ingredient category', 'product category', 'category'],
  certifications: [
    'certification or quality reference',
    'quality reference',
    'certifications',
    'certification',
  ],
  currency: ['currency code', 'currency'],
  expiryDate: ['expiration date', 'expiry date', 'exp date', 'best before', 'use by'],
  ingredientName: ['ingredient name', 'material name', 'product name', 'ingredient'],
  origin: ['country of origin', 'produced in', 'place of origin', 'origin'],
  price: ['indicative unit price', 'unit price', 'indicative price', 'price'],
  productionDate: ['production date', 'manufactured on', 'manufacturing date', 'mfg date'],
  quantity: ['total quantity', 'net quantity', 'quantity supplied', 'quantity'],
  unit: ['unit of measurement', 'measurement unit', 'uom', 'unit'],
};

const currencyCodes = new Set(
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('currency')
    : ['MYR', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'JPY', 'CNY'],
);

const unitAliases: Record<string, string> = {
  each: 'each',
  ea: 'each',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  l: 'litre',
  liter: 'litre',
  liters: 'litre',
  litre: 'litre',
  litres: 'litre',
  pc: 'each',
  pcs: 'each',
  piece: 'each',
  pieces: 'each',
  unit: 'unit',
  units: 'unit',
};

export function mapIngredientFields(text: string, source: SourceKind = 'document') {
  const values = findLabelledValues(text);
  const warnings: string[] = [];
  const fields = Object.fromEntries(
    INGREDIENT_DOCUMENT_FIELDS.map((field) => [field, missingField()]),
  ) as ExtractedIngredientFields;
  const confidence = source === 'ocr' ? 'Review required' : 'High';

  setText(fields, 'ingredientName', values.ingredientName, 160, confidence, warnings);
  setReference(fields, values.batchReference, confidence, warnings);
  setCategory(fields, values.category, confidence, warnings);
  setText(fields, 'origin', values.origin, 160, confidence, warnings);
  setDate(fields, 'productionDate', values.productionDate, confidence, warnings);
  setDate(fields, 'expiryDate', values.expiryDate, confidence, warnings);
  setQuantityAndUnit(fields, values.quantity, values.unit, confidence, warnings);
  setPriceAndCurrency(fields, values.price, values.currency, confidence, warnings);
  setText(fields, 'certifications', values.certifications, 2_419, confidence, warnings);
  setText(fields, 'allergenInformation', values.allergenInformation, 500, confidence, warnings);

  validateDates(fields, warnings);
  validateAgainstRegistrationSchema(fields, warnings);
  return { fields, warnings: [...new Set(warnings)] };
}

function findLabelledValues(text: string) {
  const lines = text
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/ +/g, ' ').trim())
    .filter(Boolean);
  const values: Partial<Record<keyof ExtractedIngredientFields, string>> = {};
  for (let index = 0; index < lines.length; index += 1) {
    for (const field of INGREDIENT_DOCUMENT_FIELDS) {
      if (values[field]) continue;
      const matched = matchAlias(lines[index]!, aliases[field]);
      if (matched !== undefined) {
        values[field] = matched || lines[index + 1] || '';
        break;
      }
    }
  }
  return values;
}

function matchAlias(line: string, candidates: string[]) {
  for (const alias of candidates.sort((left, right) => right.length - left.length)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = line.match(new RegExp(`^${escaped}(?:\\s*[:=–—-]\\s*|\\t+| {2,})(.*)$`, 'i'));
    if (match) return match[1]?.trim() ?? '';
    if (line.toLowerCase() === alias) return '';
  }
  return undefined;
}

function setText(
  fields: ExtractedIngredientFields,
  field: keyof ExtractedIngredientFields,
  raw: string | undefined,
  maximum: number,
  confidence: ExtractedIngredientField['confidence'],
  warnings: string[],
) {
  const value = raw?.trim() ?? '';
  if (!value) return;
  if (value.length > maximum) {
    warnings.push(`${fieldLabel(field)} was longer than the supported limit and was left empty.`);
    return;
  }
  fields[field] = { confidence, value };
}

function setReference(
  fields: ExtractedIngredientFields,
  raw: string | undefined,
  confidence: ExtractedIngredientField['confidence'],
  warnings: string[],
) {
  const value = raw?.trim() ?? '';
  if (!value) return;
  if (value.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(value)) {
    warnings.push('Batch reference contains unsupported characters or exceeds 120 characters.');
    return;
  }
  fields.batchReference = { confidence, value };
}

function setCategory(
  fields: ExtractedIngredientFields,
  raw: string | undefined,
  confidence: ExtractedIngredientField['confidence'],
  warnings: string[],
) {
  if (!raw?.trim()) return;
  const value = raw.trim().toLowerCase();
  const category = value.match(/cocoa|chocolate/)
    ? 'cocoa'
    : value.match(/dairy|milk|cream/)
      ? 'dairy'
      : value.match(/sugar|sweetener/)
        ? 'sugar'
        : value.match(/grain|flour|wheat|rice/)
          ? 'grain'
          : 'other';
  fields.category = {
    confidence: category === 'other' ? 'Review required' : confidence,
    value: category,
  };
  if (category === 'other') warnings.push('Review the extracted category before registration.');
}

function setDate(
  fields: ExtractedIngredientFields,
  field: 'productionDate' | 'expiryDate',
  raw: string | undefined,
  confidence: ExtractedIngredientField['confidence'],
  warnings: string[],
) {
  if (!raw?.trim()) return;
  const parsed = parseDate(raw.trim());
  if (!parsed) {
    warnings.push(`${fieldLabel(field)} could not be interpreted safely and was left empty.`);
    return;
  }
  fields[field] = {
    confidence: parsed.ambiguous ? 'Review required' : confidence,
    value: parsed.value,
  };
}

function parseDate(raw: string): { ambiguous: boolean; value: string } | undefined {
  const iso = raw.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), false);
  const dayFirst = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    return validDate(Number(dayFirst[3]), month, day, day <= 12 && month <= 12);
  }
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return undefined;
  const date = new Date(timestamp);
  return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), true);
}

function validDate(year: number, month: number, day: number, ambiguous: boolean) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    return undefined;
  return { ambiguous, value: date.toISOString().slice(0, 10) };
}

function setQuantityAndUnit(
  fields: ExtractedIngredientFields,
  quantityRaw: string | undefined,
  unitRaw: string | undefined,
  confidence: ExtractedIngredientField['confidence'],
  warnings: string[],
) {
  const combined = quantityRaw?.trim() ?? '';
  const quantityMatch = combined.match(/(-?[\d,]+(?:\.\d+)?)\s*([A-Za-z]+)?/);
  const quantity = quantityMatch?.[1]?.replace(/,/g, '') ?? '';
  const unit = unitRaw?.trim() || quantityMatch?.[2] || '';
  if (quantity) {
    if (!/^[1-9]\d{0,38}$/.test(quantity)) {
      warnings.push('Quantity must be a positive whole number and was left empty.');
    } else fields.quantity = { confidence, value: quantity };
  }
  if (unit) {
    const normalizedUnit = unitAliases[unit.toLowerCase().replace(/\.$/, '')];
    if (!normalizedUnit) warnings.push('The extracted unit is unsupported and was left empty.');
    else fields.unit = { confidence, value: normalizedUnit };
  }
}

function setPriceAndCurrency(
  fields: ExtractedIngredientFields,
  priceRaw: string | undefined,
  currencyRaw: string | undefined,
  confidence: ExtractedIngredientField['confidence'],
  warnings: string[],
) {
  const combined = priceRaw?.trim() ?? '';
  const currency = (
    currencyRaw?.trim() ||
    combined.match(/\b[A-Za-z]{3}\b/)?.[0] ||
    ''
  ).toUpperCase();
  const price = combined.match(/\d[\d,]*(?:\.\d{1,2})?/)?.[0]?.replace(/,/g, '') ?? '';
  if (price) {
    if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(price))
      warnings.push('The extracted indicative price is invalid and was left empty.');
    else fields.price = { confidence, value: price };
  }
  if (currency) {
    if (!currencyCodes.has(currency))
      warnings.push('The extracted currency code is invalid and was left empty.');
    else fields.currency = { confidence, value: currency };
  }
}

function validateDates(fields: ExtractedIngredientFields, warnings: string[]) {
  const production = fields.productionDate.value;
  const expiry = fields.expiryDate.value;
  if (production && expiry && expiry <= production) {
    fields.expiryDate = missingField();
    warnings.push('Expiry date must follow the production date and was left empty.');
  }
}

function validateAgainstRegistrationSchema(fields: ExtractedIngredientFields, warnings: string[]) {
  const required = [
    fields.ingredientName.value,
    fields.batchReference.value,
    fields.category.value,
    fields.origin.value,
    fields.productionDate.value,
    fields.expiryDate.value,
    fields.quantity.value,
    fields.unit.value,
  ];
  if (required.some((value) => !value)) return;
  const result = ingredientBatchRequestSchema.safeParse({
    allergenInformation: fields.allergenInformation.value,
    batchReference: fields.batchReference.value,
    category: fields.category.value,
    certifications: fields.certifications.value
      .split(/[,;|]/)
      .map((value) => value.trim())
      .filter(Boolean),
    currency: fields.currency.value || 'MYR',
    expiryDate: fields.expiryDate.value,
    ingredientName: fields.ingredientName.value,
    origin: fields.origin.value,
    ...(fields.price.value ? { price: fields.price.value } : {}),
    productionDate: fields.productionDate.value,
    quantity: fields.quantity.value,
    unit: fields.unit.value,
  });
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && field in fields) {
        fields[field as keyof ExtractedIngredientFields] = missingField();
        warnings.push(
          `${fieldLabel(field as keyof ExtractedIngredientFields)} was invalid and was left empty.`,
        );
      }
    }
  }
}

function missingField(): ExtractedIngredientField {
  return { confidence: 'Missing', value: '' };
}

function fieldLabel(field: keyof ExtractedIngredientFields) {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
}
