import { reportError } from '../../../components/ui/feedback';
import { ImagePlus, ImageUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CompanyAvatar } from '../../orders/CatalogueMedia';
import { getMyCompanyBranding, imageFilePayload, uploadCompanyLogo } from '../../orders/orders.api';
import { Alert, Btn } from './ui';
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
  const picker = useRef<HTMLInputElement>(null);

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

  const role = branding?.role
    ? branding.role.charAt(0) + branding.role.slice(1).toLowerCase().replaceAll('_', ' ')
    : '';
  return (
    <div className="company-branding">
      <div className="company-branding__row">
        <CompanyAvatar
          name={branding?.companyName ?? 'Company'}
          logoPath={branding?.logoPath}
          revision={brandingState.revision}
          size="lg"
        />
        <div className="company-branding__text">
          <strong>{branding?.companyName ?? 'Verified company'}</strong>
          <span>
            {[role, branding?.logoPath ? 'Logo set' : 'No logo yet'].filter(Boolean).join(' · ')}
          </span>
          <small>{file ? `Selected: ${file.name}` : 'PNG, JPEG or WebP, up to 2 MB'}</small>
        </div>
        <div className="company-branding__actions">
          {/* Native picker stays for accessibility and tests; the button below opens it. */}
          <input
            ref={picker}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose company logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0])}
          />
          <Btn
            size="sm"
            variant="outline"
            icon={<ImagePlus size={15} />}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {file ? 'Choose another' : 'Choose image'}
          </Btn>
          <Btn
            size="sm"
            icon={<ImageUp size={15} />}
            disabled={busy || !file || !branding}
            onClick={() => void upload()}
          >
            {busy ? 'Uploading…' : branding?.logoPath ? 'Replace logo' : 'Upload logo'}
          </Btn>
        </div>
      </div>
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      <p className="company-branding__note">
        Shown beside your company name in catalogues and evidence lists. It does not change your
        verified name, credential, role or authorization.
      </p>
    </div>
  );
}
