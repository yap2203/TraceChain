export type ApplicationStatus = 'pending' | 'additional evidence required' | 'approved' | 'rejected' | 'withdrawn';

export interface ChainApplication {
  companyName?: string;
  companyRegistrationNumber?: string;
  applicant: string;
  encryptedProfileCid: string;
  id: string;
  previousApplicationId: string;
  profileHash: string;
  requestedRole: 'Supplier' | 'Manufacturer' | 'Distributor' | 'Retailer';
  status: ApplicationStatus;
  submittedAt: number;
  updatedAt: number;
}
