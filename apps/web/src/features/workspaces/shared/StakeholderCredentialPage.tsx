import { CheckCircle2, ChevronDown, Copy, Download, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  getMyCompanyIdentity,
  verifyMyCompanyIdentity,
  type CompanyIdentityResponse,
} from '../../auth/auth.api';
import { CredentialCard } from './CredentialCard';
import { Alert, Badge, Btn, Card, MONO, SectionTitle, T } from './ui';

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
      setError(
        cause instanceof Error ? cause.message : 'The company credential could not be loaded.',
      );
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
      setVerificationError(
        cause instanceof Error ? cause.message : 'Credential verification is unavailable.',
      );
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

  if (loading)
    return (
      <SectionTitle
        title="My Company Identity"
        sub="Retrieving your encrypted Company Role Credential and current registry status..."
      />
    );
  if (!data)
    return (
      <div>
        <SectionTitle title="My Company Identity" sub="Company Digital Identity Card" />
        <Alert type="error" message={error || 'No credential is available for this wallet.'} />
        <Btn style={{ marginTop: 12 }} variant="outline" onClick={() => void load()}>
          Retry
        </Btn>
      </div>
    );

  const identity = data.identity;
  const verification = data.verification;
  const role = displayRole(identity.role);
  return (
    <div>
      <SectionTitle
        title="My Company Identity"
        sub="Your existing Company Role Credential and current blockchain authorization state"
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Btn size="xs" disabled={verifying} onClick={() => void verify()}>
              {verifying ? 'Verifying...' : 'Verify My Credential'}
            </Btn>
            <Btn size="xs" variant="outline" onClick={download}>
              <Download size={14} /> Download Identity Summary
            </Btn>
            <Btn
              size="xs"
              variant="outline"
              onClick={() => void copyValue('Credential ID', identity.credentialId)}
            >
              Copy Credential ID
            </Btn>
            <Btn size="xs" variant="outline" onClick={() => void load()}>
              Refresh
            </Btn>
          </div>
        }
      />
      {(actionMessage || actionError) && (
        <div
          role={actionError ? 'alert' : 'status'}
          aria-live={actionError ? 'assertive' : 'polite'}
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            width: 'min(360px, calc(100vw - 40px))',
            zIndex: 1000,
            boxShadow: '0 12px 32px rgba(6, 46, 91, 0.18)',
            borderRadius: 10,
          }}
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Credential lifecycle
          </div>
          <StatusRow label="Credential status" value={identity.lifecycleStatus} />
          <StatusRow
            label="Blockchain authorization"
            value={identity.lifecycleStatus === 'ACTIVE' ? 'Authorized' : 'Not authorized'}
          />
          <StatusRow label="Registry updated" value={formatDateTime(identity.updatedAt)} plain />
          <p style={{ color: T.text3, fontSize: 11, margin: '12px 0 0' }}>
            Lifecycle status comes from the deployed registries and remains separate from
            cryptographic VC verification.
          </p>
        </Card>
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>
              Cryptographic verification
            </div>
            {verification && (
              <Badge
                label={verification.outcome === 'CHECKS_PASSED' ? 'Checks passed' : 'Checks failed'}
                variant={verification.outcome === 'CHECKS_PASSED' ? 'verified' : 'invalid'}
              />
            )}
          </div>
          {!verification ? (
            <p style={{ color: T.text2, fontSize: 12 }}>
              Not verified in this session. Select “Verify My Credential” to retrieve and verify the
              signed VC.
            </p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8 }}>
                {verification.checks.map((check) => (
                  <div
                    key={check.label}
                    style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: 8 }}
                  >
                    {check.status === 'PASSED' ? (
                      <CheckCircle2 size={17} color={T.green} />
                    ) : (
                      <XCircle size={17} color={T.red} />
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: T.text }}>
                        {check.label}
                      </div>
                      <div style={{ fontSize: 11, color: T.text3 }}>{check.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ color: T.text3, fontSize: 11, marginTop: 12 }}>
                Verified at {formatDateTime(verification.verifiedAt)}
              </div>
            </>
          )}
        </Card>
      </div>

      <details
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: '14px 18px',
        }}
      >
        <summary
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 700,
            color: T.navy,
          }}
        >
          <ChevronDown size={16} /> View Technical Details
        </summary>
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <TechnicalValue
            label="Full credential ID"
            value={identity.credentialId}
            onCopy={copyValue}
          />
          <TechnicalValue
            label="Registry credential ID"
            value={identity.registryCredentialId}
            onCopy={copyValue}
          />
          <TechnicalValue label="Subject DID" value={identity.subjectDid} onCopy={copyValue} />
          <TechnicalValue label="Issuer DID" value={identity.issuerDid} onCopy={copyValue} />
          <TechnicalValue
            label="Associated wallet"
            value={identity.associatedWallet}
            onCopy={copyValue}
          />
          <TechnicalValue
            label="Recorded credential hash"
            value={identity.credentialHash}
            onCopy={copyValue}
          />
          <TechnicalValue
            label="Encrypted CID / reference"
            value={identity.encryptedCredentialCid}
            onCopy={copyValue}
          />
          <TechnicalValue
            label="Application reference"
            value={identity.applicationReference}
            onCopy={copyValue}
          />
          <TechnicalValue label="Chain ID" value={String(identity.chainId)} onCopy={copyValue} />
          <TechnicalValue
            label="StakeholderRegistry"
            value={identity.registryReferences.stakeholderRegistry || 'Unavailable'}
            onCopy={copyValue}
          />
          <TechnicalValue
            label="CredentialRegistry"
            value={identity.registryReferences.credentialRegistry || 'Unavailable'}
            onCopy={copyValue}
          />
          <TechnicalValue
            label="Last verification"
            value={
              verification?.verifiedAt ? formatDateTime(verification.verifiedAt) : 'Unavailable'
            }
          />
        </div>
      </details>
      <Alert
        type="info"
        message="This credential confirms approval to participate in the TraceChain network in the stated role. It does not represent government or independent product certification."
      />
    </div>
  );
}

function StatusRow({
  label,
  value,
  plain = false,
}: {
  label: string;
  value: string;
  plain?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'center',
        padding: '9px 0',
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <span style={{ fontSize: 12, color: T.text2 }}>{label}</span>
      {plain ? (
        <span style={{ fontSize: 11, color: T.text3 }}>{value}</span>
      ) : (
        <Badge
          label={value}
          variant={
            value === 'ACTIVE' || value === 'Authorized'
              ? 'active'
              : value === 'SUSPENDED'
                ? 'suspended'
                : value === 'EXPIRED'
                  ? 'expired'
                  : 'revoked'
          }
        />
      )}
    </div>
  );
}
function TechnicalValue({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy?: (label: string, value: string) => Promise<void>;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(130px, 190px) minmax(0, 1fr) auto',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 11, color: T.text3 }}>{label}</span>
      <code style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>
        {value || 'Unavailable'}
      </code>
      {onCopy && value && value !== 'Unavailable' && (
        <button
          type="button"
          aria-label={`Copy full ${label}`}
          title={`Copy full ${label}`}
          onClick={() => void onCopy(label, value)}
          style={{ border: 0, background: 'transparent', color: T.teal, cursor: 'pointer' }}
        >
          <Copy size={14} />
        </button>
      )}
    </div>
  );
}
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
