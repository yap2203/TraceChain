export type ApplicationStatus =
  'pending' | 'additional evidence required' | 'approved' | 'rejected' | 'withdrawn';

export interface ChainApplication {
  businessAddress?: string;
  companyDid?: string;
  companyEmail?: string;
  companyName?: string;
  companyRegistrationNumber?: string;
  contactNumber?: string;
  contentError?: string;
  contentStatus?: 'available' | 'legacy-local' | 'unavailable';
  initialLocationAddress?: string;
  initialLocationName?: string;
  representativeName?: string;
  representativePosition?: string;
  registrationCountry?: string;
  applicant: string;
  encryptedProfileCid: string;
  id: string;
  previousApplicationId: string;
  pendingLogoPath?: string;
  profileHash: string;
  requestedRole: 'Supplier' | 'Manufacturer' | 'Distributor' | 'Retailer';
  status: ApplicationStatus;
  submittedAt: number;
  updatedAt: number;
}
