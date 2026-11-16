import { reportError } from '../../../components/ui/feedback';
import { ImageUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CompanyAvatar } from '../../orders/CatalogueMedia';
import { getMyCompanyBranding, imageFilePayload, uploadCompanyLogo } from '../../orders/orders.api';
import { Alert, Btn, Card } from './ui';
import {
  loadCompanyBranding,
  publishCompanyBranding,
  selectCompanyBranding,
  useCompanyBrandingState,
} from './company-branding.state';

export function CompanyBrandingPanel({ walletAddress }: { walletAddress: string }) {
  useCompanyBrandingState();
  const brandingState = selectCompanyBranding(walletAddress);
  const branding = brandingState.branding;
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void loadCompanyBranding(walletAddress, getMyCompanyBranding).catch((cause) =>
      setError(reportError(cause, 'Company branding is unavailable.')),
    );
  }, [walletAddress]);

  const upload = async () => {
    if (!file || !branding) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadCompanyLogo(walletAddress, await imageFilePayload(file));
      publishCompanyBranding(walletAddress, {
        companyName: branding.companyName,
        logoPath: result.branding.logoPath,
        role: branding.role,
      });
      setFile(undefined);
      setNotice('Company logo updated for catalogue presentation. Authorization is unchanged.');
    } catch (cause) {
      setError(reportError(cause, 'The company logo could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="company-branding">
        <CompanyAvatar
          name={branding?.companyName ?? 'Company'}
          logoPath={branding?.logoPath}
          revision={brandingState.revision}
          size="lg"
        />
        <div>
          <h3>Company catalogue identity</h3>
          <p>
            {branding?.companyName ?? 'Verified company'}
            {branding?.role ? ` — ${branding.role.replaceAll('_', ' ')}` : ''}
          </p>
        </div>
      </div>
      <p>
        Add an optional PNG, JPEG or WebP logo up to 2 MB. The logo is presentation metadata; it
        does not alter your verified company name, credential, role or blockchain authorization.
      </p>
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      <div className="company-branding__actions">
        <input
          aria-label="Choose company logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0])}
        />
        <Btn
          size="sm"
          variant="outline"
          icon={<ImageUp size={15} />}
          disabled={busy || !file || !branding}
          onClick={() => void upload()}
        >
          {branding?.logoPath ? 'Replace logo' : 'Upload logo'}
        </Btn>
      </div>
    </Card>
  );
}
