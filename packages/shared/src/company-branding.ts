export interface CompanyLogoBinding {
  applicationId: string;
  applicantWallet: string;
  profileHash: string;
  logoDigest: string;
}

export function companyLogoBindingMessage(binding: CompanyLogoBinding) {
  return [
    'TraceChain company registration logo',
    `Application: ${binding.applicationId.toLowerCase()}`,
    `Applicant: ${binding.applicantWallet.toLowerCase()}`,
    `Profile: ${binding.profileHash.toLowerCase()}`,
    `Logo: ${binding.logoDigest.toLowerCase()}`,
    'Purpose: bind this optional presentation logo to this exact company application.',
  ].join('\n');
}
