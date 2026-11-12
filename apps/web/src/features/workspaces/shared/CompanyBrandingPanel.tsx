import { ImageUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CompanyAvatar } from '../../orders/CatalogueMedia';
import { getMyCompanyBranding, imageFilePayload, uploadCompanyLogo } from '../../orders/orders.api';
import { Alert, Btn, Card } from './ui';

interface Branding {
  companyName: string;
  logoPath?: string;
  role: string;
}

export function CompanyBrandingPanel({ walletAddress }: { walletAddress: string }) {
  const [branding, setBranding] = useState<Branding>();
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void getMyCompanyBranding()
      .then(({ branding: value }) => setBranding(value))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Company branding is unavailable.'),
      );
  }, []);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadCompanyLogo(walletAddress, await imageFilePayload(file));
      setBranding((current) =>
        current ? { ...current, logoPath: result.branding.logoPath } : current,
      );
      setFile(undefined);
      setNotice('Company logo updated for catalogue presentation. Authorization is unchanged.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The company logo could not be saved.');
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
          disabled={busy || !file}
          onClick={() => void upload()}
        >
          {branding?.logoPath ? 'Replace logo' : 'Upload logo'}
        </Btn>
      </div>
    </Card>
  );
}
