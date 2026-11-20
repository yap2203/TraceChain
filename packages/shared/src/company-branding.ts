export interface CompanyApplicationBinding {
  applicationId: string;
  applicantWallet: string;
  companyName: string;
  companyRegistrationNumber: string;
  registrationCountry?: string;
  encryptedProfileCid: string;
  initialLocationName?: string;
  initialLocationAddress?: string;
  documentsDigest?: string;
  logoDigest?: string;
  logoFileName?: string;
  logoMimeType?: string;
  previousApplicationId: string;
  profileHash: string;
  requestedRole: number;
}

export interface CompanyApplicationContentFile {
  contentHash: string;
  fileName: string;
  kind: string;
  mimeType: string;
  size: number;
}

export interface CompanyApplicationContentAuthorization {
  applicationId: string;
  applicantWallet: string;
  businessAddress: string;
  chainId: number;
  companyDid?: string;
  companyEmail: string;
  companyName: string;
  companyRegistrationNumber: string;
  contactNumber: string;
  declarationAcceptedAt: string;
  declarationVersion: string;
  documents: CompanyApplicationContentFile[];
  logo?: CompanyApplicationContentFile;
  previousApplicationId: string;
  registryAddress: string;
  registrationCountry?: string;
  representativeName: string;
  representativePosition: string;
  requestedRole: number;
  submissionTime: string;
}

export function companyApplicationContentAuthorizationMessage(
  content: CompanyApplicationContentAuthorization,
) {
  const roles: Record<number, string> = {
    1: 'System Admin',
    2: 'Supplier',
    3: 'Manufacturer',
    4: 'Distributor',
    5: 'Retailer',
  };
  const quote = (value: string | undefined) =>
    value === undefined ? 'Not provided' : JSON.stringify(value);
  const fileLines = [...content.documents]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .map(
      (file) =>
        `${file.kind}: ${quote(file.fileName)} | ${file.mimeType} | ${file.size} bytes | ${file.contentHash.toLowerCase()}`,
    );
  return [
    'TraceChain - Authorize company application content',
    '',
    'Sign to authorize encryption and storage of this exact application content.',
    'This signature does not submit a blockchain transaction or transfer funds.',
    '',
    'Signing format: TraceChain encrypted application manifest v1',
    'Application ID: ' + content.applicationId.toLowerCase(),
    'Applicant wallet: ' + content.applicantWallet.toLowerCase(),
    'Chain ID: ' + content.chainId,
    'Stakeholder Registry: ' + content.registryAddress.toLowerCase(),
    'Previous application ID: ' + content.previousApplicationId.toLowerCase(),
    'Requested role: ' +
      (roles[content.requestedRole] ?? 'Unknown') +
      ' (' +
      content.requestedRole +
      ')',
    '',
    'Company name: ' + quote(content.companyName),
    'Registration number: ' + quote(content.companyRegistrationNumber),
    'Registration country: ' + quote(content.registrationCountry),
    'Business address: ' + quote(content.businessAddress),
    'Company email: ' + quote(content.companyEmail),
    'Contact number: ' + quote(content.contactNumber),
    'Representative name: ' + quote(content.representativeName),
    'Representative position: ' + quote(content.representativePosition),
    'Company DID: ' + quote(content.companyDid),
    '',
    'Supporting documents:',
    ...fileLines,
    ...(content.logo
      ? [
          `companyLogo: ${quote(content.logo.fileName)} | ${content.logo.mimeType} | ${content.logo.size} bytes | ${content.logo.contentHash.toLowerCase()}`,
        ]
      : ['companyLogo: Not provided']),
    '',
    'Submission time: ' + content.submissionTime,
    'Declaration: ' + content.declarationVersion,
    'Declaration accepted at: ' + content.declarationAcceptedAt,
    '',
    'The listed fingerprints bind the exact selected file bytes.',
    'A separate signature and MetaMask transaction will bind the encrypted manifest CID on-chain.',
  ].join('\n');
}

export function companyApplicationBindingMessage(binding: CompanyApplicationBinding) {
  const roles: Record<number, string> = {
    1: 'System Admin',
    2: 'Supplier',
    3: 'Manufacturer',
    4: 'Distributor',
    5: 'Retailer',
  };
  // Quote user-entered strings so line breaks cannot impersonate another message field.
  const text = (value: string | undefined) =>
    value === undefined ? 'Not provided' : JSON.stringify(value);
  return [
    'TraceChain - Company registration',
    '',
    'Sign to confirm that you own this company wallet and authorize this application submission.',
    'This signature does not send a blockchain transaction or transfer funds.',
    'A separate MetaMask transaction will submit your application and may charge a network fee.',
    '',
    'Company: ' + text(binding.companyName),
    'Registration number: ' + text(binding.companyRegistrationNumber),
    ...(binding.registrationCountry
      ? ['Registration country: ' + text(binding.registrationCountry)]
      : []),
    'Requested role: ' +
      (roles[binding.requestedRole] ?? 'Unknown') +
      ' (' +
      binding.requestedRole +
      ')',
    'Company wallet: ' + binding.applicantWallet.toLowerCase(),
    '',
    'Application details bound by this signature',
    'Signing format: TraceChain company application v2',
    'Application ID: ' + binding.applicationId.toLowerCase(),
    'Profile fingerprint: ' + binding.profileHash.toLowerCase(),
    'Profile reference: ' + text(binding.encryptedProfileCid),
    'Previous application ID: ' + binding.previousApplicationId.toLowerCase(),
    ...(binding.initialLocationName !== undefined
      ? ['Initial location name: ' + text(binding.initialLocationName)]
      : []),
    ...(binding.initialLocationAddress !== undefined
      ? ['Initial location address: ' + text(binding.initialLocationAddress)]
      : []),
    ...(binding.logoDigest !== undefined
      ? ['Logo fingerprint: ' + binding.logoDigest.toLowerCase()]
      : []),
    ...(binding.logoFileName !== undefined
      ? ['Logo file name: ' + text(binding.logoFileName)]
      : []),
    ...(binding.logoMimeType !== undefined
      ? ['Logo file type: ' + text(binding.logoMimeType)]
      : []),
    ...(binding.documentsDigest
      ? ['Supporting documents fingerprint: ' + binding.documentsDigest.toLowerCase()]
      : []),
    '',
    'The fingerprints bind your submitted profile, logo and documents to this exact application.',
    'Signing confirms your submission; it does not mean TraceChain has approved your company.',
  ].join('\n');
}
