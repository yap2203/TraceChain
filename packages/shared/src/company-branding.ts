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
