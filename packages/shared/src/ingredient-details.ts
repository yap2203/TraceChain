/** New records use whole canonical grams/millilitres/items; existing on-chain units are unchanged. */
export const ingredientUnits = ['kg', 'g', 'litre', 'mL', 'each'] as const;
export function normalizeIngredientQuantity(value: string, unit: string) {
  const scale = unit === 'kg' || unit === 'litre' ? 1000n : 1n;
  if (!ingredientUnits.includes(unit as (typeof ingredientUnits)[number]))
    throw new Error('Choose kg, g, litre, mL or each.');
  if (!/^(0|[1-9]\d{0,38})(\.\d{1,3})?$/.test(value))
    throw new Error('Enter a positive quantity with at most three decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const thousandths = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
  const amount = thousandths * scale;
  if (amount % 1000n !== 0n)
    throw new Error('This quantity cannot be represented as whole grams, millilitres or items.');
  const canonical = amount / 1000n;
  if (canonical <= 0n || canonical > 10n ** 39n - 1n)
    throw new Error('Quantity must be positive and no more than 39 whole digits.');
  return {
    quantity: canonical.toString(),
    unit: unit === 'kg' ? 'g' : unit === 'litre' ? 'mL' : unit,
  };
}
export interface IngredientOrigin {
  countryCode: string;
  countryName: string;
  region?: string;
  city?: string;
  facility?: string;
  privateAddress?: string;
  processingLocation?: string;
  processingCountry?: string;
}
export interface IngredientAllergen {
  kind: 'contains' | 'mayContain' | 'declaresNone' | 'unknown';
  details?: string;
}
export interface CertificationDocument {
  id: string;
  fileName: string;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg';
  size: number;
  sha256: string;
  cid: string;
}
export interface IngredientCertification {
  id: string;
  name: string;
  issuer: string;
  reference: string;
  issueDate?: string;
  expiryDate?: string;
  noExpiry: boolean;
  scope: 'Company' | 'Facility' | 'Ingredient' | 'This batch';
  scopeReference?: string;
  documents: CertificationDocument[];
}
export interface IngredientQualityTest {
  id: string;
  laboratoryName: string;
  reportNumber: string;
  testDate: string;
  sampleReference: string;
  testedBatchReference: string;
  results: string;
  documents: CertificationDocument[];
}
export const certificationClaim = (id: string) => `certification_${id.replaceAll('-', '')}`;
export const certificationDocumentsClaim = (id: string) =>
  `certificationDocuments_${id.replaceAll('-', '')}`;
export function ingredientDetailClaims(
  origin?: IngredientOrigin,
  allergen?: IngredientAllergen,
  certifications: IngredientCertification[] = [],
  qualityTests: IngredientQualityTest[] = [],
) {
  const claims: Record<string, unknown> = {};
  if (origin)
    Object.assign(claims, {
      countryOfOrigin: origin.countryName,
      originCountryCode: origin.countryCode,
      ...(origin.region ? { originRegion: origin.region } : {}),
      ...(origin.city ? { originCity: origin.city } : {}),
      ...(origin.facility ? { exactSourceFacility: origin.facility } : {}),
      ...(origin.privateAddress ? { privateOriginAddress: origin.privateAddress } : {}),
      ...(origin.processingLocation ? { processingLocation: origin.processingLocation } : {}),
      ...(origin.processingCountry ? { processingCountry: origin.processingCountry } : {}),
    });
  if (allergen) claims.allergenDeclaration = allergen;
  for (const { documents, ...entry } of certifications) {
    claims[certificationClaim(entry.id)] = entry;
    for (const document of documents)
      claims[certificationDocumentsClaim(document.id)] = {
        certificationId: entry.id,
        documents: [document],
      };
  }
  for (const { documents, ...test } of qualityTests) {
    claims[`qualityTest_${test.id.replaceAll('-', '')}`] = test;
    for (const document of documents)
      claims[`qualityDocuments_${document.id.replaceAll('-', '')}`] = {
        qualityTestId: test.id,
        documents: [document],
      };
  }
  return claims;
}
export function ingredientClaimLabel(key: string) {
  const labels: Record<string, string> = {
    certifications: 'Matching certification entries',
    certificationDocuments: 'Explicitly selected certification documents',
    ingredientName: 'Ingredient name',
    batchId: 'TraceChain ingredient batch ID',
    batchReference: 'Supplier batch reference',
    supplierWallet: 'Supplier wallet',
    supplierDid: 'Supplier subject DID',
    productionDate: 'Supplier-reported production date',
    expiryDate: 'Ingredient expiry date',
    countryOfOrigin: 'Country of origin',
    originCountryCode: 'Origin country code',
    originRegion: 'Origin region',
    originCity: 'Origin city/district',
    exactSourceFacility: 'Source facility/farm',
    privateOriginAddress: 'Private source address',
    allergenDeclaration: 'Allergen declaration',
    certificationDetails: 'Legacy certification details',
  };
  return (
    labels[key] ??
    (key.startsWith('certificationDocuments_')
      ? 'Certification supporting documents'
      : key.startsWith('certification_')
        ? 'Supplier-provided certification'
        : key)
  );
}

/** ISO 3166-1 alpha-2: reused phone-country data plus the seven territories without calling codes. */
export const ingredientCountryCodes = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const;
