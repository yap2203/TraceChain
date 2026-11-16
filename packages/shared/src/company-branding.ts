export interface CompanyApplicationBinding {
  applicationId: string;
  applicantWallet: string;
  companyName: string;
  companyRegistrationNumber: string;
  encryptedProfileCid: string;
  initialLocationName?: string;
  logoDigest?: string;
  logoFileName?: string;
  logoMimeType?: string;
  previousApplicationId: string;
  profileHash: string;
  requestedRole: number;
}

export function companyApplicationBindingMessage(binding: CompanyApplicationBinding) {
  return [
    'TraceChain company application',
    JSON.stringify({
      applicationId: binding.applicationId.toLowerCase(),
      applicantWallet: binding.applicantWallet.toLowerCase(),
      companyName: binding.companyName,
      companyRegistrationNumber: binding.companyRegistrationNumber,
      encryptedProfileCid: binding.encryptedProfileCid,
      initialLocationName: binding.initialLocationName ?? null,
      logoDigest: binding.logoDigest?.toLowerCase() ?? null,
      logoFileName: binding.logoFileName ?? null,
      logoMimeType: binding.logoMimeType ?? null,
      previousApplicationId: binding.previousApplicationId.toLowerCase(),
      profileHash: binding.profileHash.toLowerCase(),
      requestedRole: binding.requestedRole,
    }),
    'Purpose: prove ownership of the applicant wallet and bind every submitted field to this exact application.',
  ].join('\n');
}
