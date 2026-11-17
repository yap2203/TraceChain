import { describe, expect, it } from 'vitest';
import { Wallet, id, verifyMessage, ZeroHash } from 'ethers';
import {
  companyApplicationBindingMessage,
  type CompanyApplicationBinding,
} from './company-branding.js';

const input: CompanyApplicationBinding = {
  applicationId: id('application'),
  applicantWallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  companyName: 'Test Company',
  companyRegistrationNumber: 'REG-123',
  requestedRole: 3,
  encryptedProfileCid: 'ipfs://encrypted-profile',
  previousApplicationId: ZeroHash,
  profileHash: id('profile'),
  documentsDigest: id('documents'),
  logoDigest: id('logo'),
  logoFileName: 'logo.png',
  logoMimeType: 'image/png',
  initialLocationName: 'Factory',
  initialLocationAddress: 'Synthetic address',
};
describe('readable application signatures', () => {
  it('shows the company and role without a JSON object or a false transaction claim', () => {
    const message = companyApplicationBindingMessage(input);
    expect(message).toContain('Company: "Test Company"');
    expect(message).toContain('Requested role: Manufacturer (3)');
    expect(message).toContain('does not send a blockchain transaction');
    expect(message).not.toContain('{"applicationId"');
  });
  it('binds every field and prevents user text from creating misleading message lines', async () => {
    const signer = Wallet.createRandom();
    const message = companyApplicationBindingMessage(input);
    const signature = await signer.signMessage(message);
    expect(verifyMessage(message, signature)).toBe(signer.address);
    for (const field of Object.keys(input) as (keyof CompanyApplicationBinding)[]) {
      const changed = {
        ...input,
        [field]: field === 'requestedRole' ? 2 : String(input[field]) + '-changed',
      };
      expect(verifyMessage(companyApplicationBindingMessage(changed), signature)).not.toBe(
        signer.address,
      );
    }
    expect(
      companyApplicationBindingMessage({ ...input, companyName: 'Acme\nRequested role: Admin' }),
    ).toContain('Company: "Acme\\nRequested role: Admin"');
  });
});
