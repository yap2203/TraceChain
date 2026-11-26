import { reportError } from '../../../components/ui/feedback';
import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { CheckCircle2, Download, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  getMyCompanyIdentity,
  verifyMyCompanyIdentity,
  type CompanyIdentityResponse,
} from '../../auth/auth.api';
import { CredentialCard } from './CredentialCard';
import { HolderSigningKeyPanel } from '../../didcomm/HolderSigningKeyPanel';
import { Alert, Badge, Btn, Card, SectionTitle, T, TechnicalDetails } from './ui';
import './company-identity.css';
import { CompanyBrandingPanel } from './CompanyBrandingPanel';

export function StakeholderCredentialPage({
  expectedRole: _expectedRole,
}: {
  expectedRole: string;
}) {
  const [data, setData] = useState<CompanyIdentityResponse>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getMyCompanyIdentity());
    } catch (cause) {
      setError(reportError(cause, 'The company credential could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!actionMessage && !actionError) return;
    const timeout = window.setTimeout(() => {
      setActionMessage('');
      setActionError('');
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [actionError, actionMessage]);

  const verify = async () => {
    setVerifying(true);
    setVerificationError('');
    try {
      setData(await verifyMyCompanyIdentity());
      setActionMessage('Credential verification completed successfully.');
    } catch (cause) {
      setVerificationError(reportError(cause, 'Credential verification is unavailable.'));
    } finally {
      setVerifying(false);
    }
  };

  const copyValue = async (label: string, value: string) => {
    setActionMessage('');
    setActionError('');
    try {
      await navigator.clipboard.writeText(value);
      setActionMessage(`${label} copied successfully.`);
    } catch {
      setActionError(`${label} could not be copied. Check browser clipboard permission.`);
    }
  };

  const download = () => {
    setActionMessage('');
    setActionError('');
    try {
      downloadIdentityPdf(data!);
      setActionMessage('Identity summary downloaded successfully.');
    } catch {
      setActionError('The identity summary could not be downloaded.');
    }
  };

  if (loading) return <LoadingIndicator page label="Loading company identity…" />;
  if (!data)
    return (
      <div>
        <SectionTitle title="Company identity" sub="Company digital identity card" />
        <Alert type="error" message={error || 'No credential is available for this wallet.'} />
        <Btn style={{ marginTop: 12 }} variant="outline" onClick={() => void load()}>
          Retry
        </Btn>
      </div>
    );

  const identity = data.identity;
  const verification = data.verification;
  const role = displayRole(identity.role);
  const authorized = identity.lifecycleStatus === 'ACTIVE';
  // Recovery for older Ed25519-bound credentials: shown only when a "Manage legacy presentation keys" link opens it.
  const legacyKeys =
    typeof window !== 'undefined' && window.location.hash === '#legacy-presentation-signing';
  return (
    <div className="company-identity-page">
      <SectionTitle
        title="Company identity"
        sub="Your company's approved role in TraceChain and the status of its credential."
        action={
          <div className="action-row">
            <Btn
              size="sm"
              variant="outline"
              icon={<RefreshCw size={14} />}
              onClick={() => void load()}
            >
              Refresh
            </Btn>
            <Btn size="sm" variant="outline" icon={<Download size={14} />} onClick={download}>
              Download summary
            </Btn>
            <Btn
              size="sm"
              icon={<ShieldCheck size={14} />}
              disabled={verifying}
              onClick={() => void verify()}
            >
              {verifying ? 'Verifying…' : 'Verify credential'}
            </Btn>
          </div>
        }
      />
      {(actionMessage || actionError) && (
        <div
          role={actionError ? 'alert' : 'status'}
          aria-live={actionError ? 'assertive' : 'polite'}
          className="company-identity-toast"
        >
          <Alert type={actionError ? 'error' : 'success'} message={actionError || actionMessage} />
        </div>
      )}
      <CredentialCard
        credentialId={identity.credentialId}
        expiry={formatDate(identity.expiresAt)}
        issue={formatDate(identity.issuedAt)}
        issuer={identity.issuerName}
        org={identity.companyName || 'Unavailable'}
        registrationNumber={identity.companyRegistrationNumber || 'Unavailable'}
        role={role}
        status={identity.lifecycleStatus}
        subjectDid={identity.subjectDid}
        wallet={identity.associatedWallet}
        onCopy={(label, value) => void copyValue(label, value)}
      />
      {verificationError && (
        <Alert type="error" message={`Verification service unavailable: ${verificationError}`} />
      )}

      <div className="company-identity-grid">
        <Card>
          <h3 className="company-identity-title">Registry status</h3>
          <dl className="company-identity-rows">
            <div>
              <dt>Credential</dt>
              <dd>
                <Badge
                  label={statusLabel(identity.lifecycleStatus)}
                  variant={lifecycleVariant(identity.lifecycleStatus)}
                />
              </dd>
            </div>
            <div>
              <dt>On-chain authorization</dt>
              <dd>
                <Badge
                  label={authorized ? 'Authorized' : 'Not authorized'}
                  variant={authorized ? 'active' : 'revoked'}
                />
              </dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatDateTime(identity.updatedAt)}</dd>
            </div>
          </dl>
          <p className="company-identity-note">
            Read from the on-chain registries, separately from the signature check.
          </p>
        </Card>
        <Card>
          <div className="company-identity-title-row">
            <h3 className="company-identity-title">Signature check</h3>
            {verification && (
              <Badge
                label={verification.outcome === 'CHECKS_PASSED' ? 'Checks passed' : 'Checks failed'}
                variant={verification.outcome === 'CHECKS_PASSED' ? 'verified' : 'invalid'}
              />
            )}
          </div>
          {!verification ? (
            <p className="company-identity-note">
              Not checked yet. Choose Verify credential to retrieve the signed credential and check
              it.
            </p>
          ) : (
            <>
              <ul className="company-identity-checks">
                {verification.checks.map((check) => (
                  <li key={check.label}>
                    {check.status === 'PASSED' ? (
                      <CheckCircle2 size={17} color={T.green} aria-label="Passed" />
                    ) : (
                      <XCircle size={17} color={T.red} aria-label="Failed" />
                    )}
                    <div>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="company-identity-note">
                Checked {formatDateTime(verification.verifiedAt)}
              </p>
            </>
          )}
        </Card>
      </div>

      <details className="workspace-profile-settings">
        <summary>Company logo settings</summary>
        <CompanyBrandingPanel walletAddress={identity.associatedWallet} />
      </details>
      {legacyKeys && (
        <details id="legacy-presentation-signing" className="workspace-profile-settings" open>
          <summary>Legacy Ed25519 presentation keys</summary>
          <p className="company-identity-note">
            Only older credentials bound to these keys need this recovery flow. New credentials sign
            with MetaMask.
          </p>
          <HolderSigningKeyPanel />
        </details>
      )}
      <TechnicalDetails
        fields={[
          { label: 'Full credential ID', value: identity.credentialId },
          { label: 'Registry credential ID', value: identity.registryCredentialId },
          { label: 'Subject DID', value: identity.subjectDid },
          { label: 'Issuer DID', value: identity.issuerDid },
          { label: 'Recorded credential hash', value: identity.credentialHash },
          { label: 'Encrypted CID / reference', value: identity.encryptedCredentialCid },
          { label: 'Application reference', value: identity.applicationReference },
          { label: 'Chain ID', value: String(identity.chainId) },
          {
            label: 'StakeholderRegistry',
            value: identity.registryReferences.stakeholderRegistry,
          },
          { label: 'CredentialRegistry', value: identity.registryReferences.credentialRegistry },
        ]}
      />
      <p className="company-identity-note">
        This credential confirms approval to take part in TraceChain in the stated role. It is not a
        government or independent product certification.
      </p>
    </div>
  );
}

const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase();
const lifecycleVariant = (status: string) =>
  status === 'ACTIVE'
    ? 'active'
    : status === 'SUSPENDED'
      ? 'suspended'
      : status === 'EXPIRED'
        ? 'expired'
        : 'revoked';

function displayRole(role: string) {
  return role
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function downloadIdentityPdf(data: CompanyIdentityResponse) {
  const identity = data.identity;
  const blob = createIdentitySummaryPdf(data, new Date());
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tracechain-company-identity-${identity.companyRegistrationNumber}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export function createIdentitySummaryLines(data: CompanyIdentityResponse, generatedAt: Date) {
  const identity = data.identity;
  const verification = data.verification;
  return [
    'TraceChain Company Digital Identity',
    '',
    `Company: ${identity.companyName}`,
    `Registration number: ${identity.companyRegistrationNumber}`,
    `Approved role: ${displayRole(identity.role)}`,
    `Issuer: ${identity.issuerName}`,
    `Issue date: ${formatDate(identity.issuedAt)}`,
    `Expiry date: ${formatDate(identity.expiresAt)}`,
    `Lifecycle status: ${identity.lifecycleStatus}`,
    `Associated wallet: ${identity.associatedWallet}`,
    `Subject DID: ${identity.subjectDid}`,
    `Credential ID: ${identity.credentialId}`,
    `Verification: ${verification?.outcome ?? 'Not verified in this session'}`,
    `Verification time: ${verification?.verifiedAt ?? 'Unavailable'}`,
    `Generated: ${generatedAt.toISOString()}`,
    '',
    'Credential summary — not a substitute for the original signed credential.',
    'This credential confirms approval to participate in the TraceChain network in the stated role.',
    'It does not represent government or independent product certification.',
  ];
}

export function createIdentitySummaryPdf(data: CompanyIdentityResponse, generatedAt: Date) {
  return new Blob([createIdentitySummaryPdfSource(data, generatedAt)], {
    type: 'application/pdf',
  });
}

/** Creates the branded PDF without persisting or exposing the original signed credential. */
export function createIdentitySummaryPdfSource(data: CompanyIdentityResponse, generatedAt: Date) {
  const content = createIdentityPdfContent(data, generatedAt);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
    .join(
      '\n',
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function createIdentityPdfContent(data: CompanyIdentityResponse, generatedAt: Date) {
  const { identity, verification } = data;
  const commands: string[] = [];
  const lifecycleColor = statusColor(identity.lifecycleStatus);
  const verificationLabel = verification
    ? verification.outcome === 'CHECKS_PASSED'
      ? 'Checks passed'
      : 'Checks failed'
    : 'Not verified in this session';
  const verificationColor = verification
    ? verification.outcome === 'CHECKS_PASSED'
      ? '#17865B'
      : '#C43D4B'
    : '#667085';

  // Page background and branded masthead.
  rect(commands, 0, 0, 612, 842, '#F4F7FA');
  rect(commands, 0, 692, 612, 150, '#062E5B');
  rect(commands, 0, 692, 612, 5, '#10C9D8');
  drawTraceChainMark(commands, 42, 767);
  text(commands, 'TraceChain', 94, 791, 21, '#FFFFFF', true);
  text(commands, 'SUPPLY CHAIN SSI', 95, 775, 8, '#7DE4EB', true);
  text(commands, 'COMPANY DIGITAL IDENTITY', 42, 735, 10, '#7DE4EB', true);
  text(commands, 'Identity Summary', 42, 708, 23, '#FFFFFF', true);
  pill(commands, identity.lifecycleStatus, 466, 713, 104, lifecycleColor);

  // Company identity card.
  card(commands, 34, 500, 544, 170);
  sectionHeading(commands, 'COMPANY IDENTITY', 54, 644);
  text(commands, safe(identity.companyName), 54, 615, 19, '#102A43', true);
  text(commands, `${displayRole(identity.role)} company`, 54, 596, 10, '#526579');
  field(commands, 'REGISTRATION NUMBER', safe(identity.companyRegistrationNumber), 54, 555, 225);
  field(commands, 'ISSUER', safe(identity.issuerName), 307, 555, 225);
  field(commands, 'ISSUED', formatPdfDate(identity.issuedAt), 54, 514, 225);
  field(commands, 'EXPIRES', formatPdfDate(identity.expiresAt), 307, 514, 225);

  // Credential and verification panels.
  card(commands, 34, 330, 264, 148);
  sectionHeading(commands, 'CREDENTIAL', 54, 452);
  field(commands, 'CREDENTIAL ID', safe(identity.credentialId), 54, 413, 224, 8.5);
  field(commands, 'ASSOCIATED WALLET', safe(identity.associatedWallet), 54, 371, 224, 8.5);
  field(commands, 'SUBJECT DID', safe(identity.subjectDid), 54, 337, 224, 8.5);

  card(commands, 314, 330, 264, 148);
  sectionHeading(commands, 'VERIFICATION', 334, 452);
  pill(commands, verificationLabel, 334, 413, 146, verificationColor, 'left');
  field(
    commands,
    'LAST VERIFIED',
    verification?.verifiedAt ? formatPdfDateTime(verification.verifiedAt) : 'Unavailable',
    334,
    371,
    218,
  );
  field(commands, 'CHAIN ID', String(identity.chainId), 334, 337, 218);

  // Human-readable verification results.
  card(commands, 34, 172, 544, 136);
  sectionHeading(commands, 'VERIFICATION CHECKS', 54, 282);
  const checks = verification?.checks.slice(0, 4) ?? [];
  if (checks.length === 0) {
    text(
      commands,
      'Run Verify My Credential in TraceChain to add cryptographic check results.',
      54,
      249,
      10,
      '#526579',
    );
  } else {
    checks.forEach((check, index) => {
      const y = 251 - index * 21;
      circle(commands, 59, y + 2, 5, check.status === 'PASSED' ? '#17865B' : '#C43D4B');
      text(commands, check.status === 'PASSED' ? 'OK' : '!', 55.5, y - 0.5, 6, '#FFFFFF', true);
      text(commands, check.label, 72, y, 9.5, '#243B53', true);
      text(commands, truncate(check.detail, 68), 204, y, 8.5, '#667085');
    });
  }

  // Disclaimer and document provenance.
  rect(commands, 34, 76, 544, 74, '#E7F8FA', '#B6E8EC');
  text(commands, 'IMPORTANT', 50, 128, 8, '#087A87', true);
  text(
    commands,
    'Credential summary - not a substitute for the original signed credential.',
    50,
    110,
    9.5,
    '#12344D',
    true,
  );
  text(
    commands,
    'This credential confirms approval to participate in the TraceChain network in the stated role.',
    50,
    94,
    8.5,
    '#36566F',
  );
  text(
    commands,
    'It does not represent government or independent product certification.',
    50,
    82,
    8.5,
    '#36566F',
  );
  text(commands, `Generated ${formatPdfDateTime(generatedAt.toISOString())}`, 34, 46, 8, '#667085');
  text(commands, 'tracechain / company identity summary', 398, 46, 8, '#667085');
  return commands.join('\n');
}

function drawTraceChainMark(commands: string[], x: number, y: number) {
  // Compact vector interpretation of the official linked-chain and package mark.
  circle(commands, x + 12, y + 14, 11, '#10C9D8', '#7DE4EB', 2);
  circle(commands, x + 32, y + 34, 11, '#FFFFFF', '#AFCBE4', 2);
  line(commands, x + 18, y + 22, x + 26, y + 28, '#10C9D8', 6);
  rect(commands, x + 14, y + 12, 17, 16, '#0A3A72');
  line(commands, x + 14, y + 28, x + 22.5, y + 33, '#7DE4EB', 1.5);
  line(commands, x + 31, y + 28, x + 22.5, y + 33, '#7DE4EB', 1.5);
}

function card(commands: string[], x: number, y: number, width: number, height: number) {
  rect(commands, x + 2, y - 2, width, height, '#DDE5EC');
  rect(commands, x, y, width, height, '#FFFFFF', '#D9E2EC');
}
function sectionHeading(commands: string[], label: string, x: number, y: number) {
  rect(commands, x, y - 3, 25, 2, '#10C9D8');
  text(commands, label, x + 33, y - 6, 8, '#087A87', true);
}
function field(
  commands: string[],
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 9.5,
) {
  text(commands, label, x, y + 12, 7, '#7B8794', true);
  text(
    commands,
    truncate(value, Math.max(12, Math.floor(width / (size * 0.53)))),
    x,
    y,
    size,
    '#243B53',
  );
}
function pill(
  commands: string[],
  label: string,
  x: number,
  y: number,
  width: number,
  color: string,
  align: 'center' | 'left' = 'center',
) {
  rect(commands, x, y, width, 24, color);
  const textX = align === 'center' ? x + Math.max(8, (width - label.length * 5.2) / 2) : x + 12;
  text(commands, label.toUpperCase(), textX, y + 8, 8, '#FFFFFF', true);
}
function text(
  commands: string[],
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  bold = false,
) {
  commands.push(
    `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${pdfColor(color)} rg ${x} ${y} Td (${pdfText(value)}) Tj ET`,
  );
}
function rect(
  commands: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke?: string,
) {
  commands.push(
    stroke
      ? `q ${pdfColor(fill)} rg ${pdfColor(stroke)} RG 1 w ${x} ${y} ${width} ${height} re B Q`
      : `q ${pdfColor(fill)} rg ${x} ${y} ${width} ${height} re f Q`,
  );
}
function circle(
  commands: string[],
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke?: string,
  strokeWidth = 1,
) {
  const k = radius * 0.5522848;
  const path = `${x + radius} ${y} m ${x + radius} ${y + k} ${x + k} ${y + radius} ${x} ${y + radius} c ${x - k} ${y + radius} ${x - radius} ${y + k} ${x - radius} ${y} c ${x - radius} ${y - k} ${x - k} ${y - radius} ${x} ${y - radius} c ${x + k} ${y - radius} ${x + radius} ${y - k} ${x + radius} ${y} c`;
  commands.push(
    stroke
      ? `q ${pdfColor(fill)} rg ${pdfColor(stroke)} RG ${strokeWidth} w ${path} B Q`
      : `q ${pdfColor(fill)} rg ${path} f Q`,
  );
}
function line(
  commands: string[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
) {
  commands.push(`q ${pdfColor(color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q`);
}
function pdfColor(hex: string) {
  const value = hex.replace('#', '');
  return [0, 2, 4]
    .map((offset) => (Number.parseInt(value.slice(offset, offset + 2), 16) / 255).toFixed(3))
    .join(' ');
}
function statusColor(status: string) {
  if (status === 'ACTIVE') return '#17865B';
  if (status === 'SUSPENDED') return '#B7791F';
  if (status === 'EXPIRED') return '#667085';
  return '#C43D4B';
}
function safe(value: string | undefined) {
  return value?.trim() || 'Unavailable';
}
function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 3))}...`;
}
function formatPdfDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
function formatPdfDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)}, ${date.toISOString().slice(11, 16)} UTC`;
}
function pdfText(value: string) {
  return value
    .replaceAll('—', '\\227')
    .replace(/[^\x20-\x7E\\]/g, '?')
    .replace(/([()])/g, '\\$1');
}
