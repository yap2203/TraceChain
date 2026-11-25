import { CountryField } from '../../../registration/CountryField';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { ApplicationDocumentsPanel } from '../../../registration/ApplicationDocumentsPanel';
import { notify, reportError } from '../../../../components/ui/feedback';
import { BrowserProvider, id } from 'ethers';
import { useRef, useState } from 'react';

import { targetChainId } from '../../../../config/chain';
import { issueCompanyRoleCredential } from '../../../auth/auth.api';
import {
  prepareApplicationRejection,
  sendPreparedTransaction,
} from '../../../blockchain/blockchain.api';
import { Alert, Badge, Btn, Card, Input, Modal, T, Textarea } from '../../shared/ui';
import type { ChainApplication } from './types';
import { textError, futureDateError } from '../../../validation/form-validation';
import { CompanyAvatar } from '../../../orders/CatalogueMedia';

export function AppDetail({
  app,
  onBack,
  onChanged,
}: {
  app: ChainApplication;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [companyId, setCompanyId] = useState(app.companyRegistrationNumber ?? '');
  const [registrationCountry, setRegistrationCountry] = useState(app.registrationCountry ?? '');
  const [companyName, setCompanyName] = useState(app.companyName ?? '');
  const [expirationDate, setExpirationDate] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const workflowPending = useRef(false);

  const reject = async () => {
    if (workflowPending.current) return;
    const invalid = textError(reason, 'Rejection reason', 4000);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!window.ethereum || !reason.trim()) return;
    workflowPending.current = true;
    setBusy(true);
    setError('');
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const prepared = await prepareApplicationRejection({
        applicationId: app.id,
        reasonHash: id(reason.trim()),
      });
      if (BigInt(prepared.chainId) !== targetChainId)
        throw new Error('The API transaction targets a different chain.');
      const transaction = await sendPreparedTransaction(signer, prepared);
      await transaction.wait();
      await onChanged();
    } catch (cause) {
      setError(reportError(cause, 'Transaction failed.'));
    } finally {
      workflowPending.current = false;
      setBusy(false);
    }
  };

  const approve = async () => {
    if (workflowPending.current) return;
    const validationError =
      textError(registrationCountry, 'Registration country', 2) ||
      textError(companyId, 'Company registration number', 120) ||
      textError(companyName, 'Verified company name', 200) ||
      futureDateError(expirationDate, 'Credential expiration');
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!window.ethereum || !companyId.trim() || !companyName.trim() || !expirationDate) return;
    workflowPending.current = true;
    setBusy(true);
    setError('');
    try {
      const issued = await issueCompanyRoleCredential({
        applicationId: app.id,
        approvedRole: roleNumber(app.requestedRole),
        companyName: companyName.trim(),
        companyRegistrationNumber: companyId.trim(),
        ...(registrationCountry ? { registrationCountry } : {}),
        expirationDate: new Date(`${expirationDate}T23:59:59.000Z`).toISOString(),
      });
      const transactions = [
        issued.approvalTransaction,
        issued.credentialRegistrationTransaction,
      ].filter((transaction): transaction is NonNullable<typeof transaction> =>
        Boolean(transaction),
      );
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      for (const prepared of transactions) {
        if (BigInt(prepared.chainId) !== targetChainId)
          throw new Error('The API transaction targets a different chain.');
        const transaction = await sendPreparedTransaction(signer, prepared);
        if (!(await transaction.wait())) throw new Error('A transaction was not confirmed.');
      }
      setApproving(false);
      notify(
        'Company credential approved and activated. The company can access it from My company identity.',
        'success',
      );
      await onChanged();
    } catch (cause) {
      setError(reportError(cause, 'Credential issuance failed.'));
    } finally {
      workflowPending.current = false;
      setBusy(false);
    }
  };

  const rows = [
    ['Application ID', app.id],
    ['Applicant wallet', app.applicant],
    ['Requested role', app.requestedRole],
    ['Status', app.status],
    ['Submitted', new Date(app.submittedAt * 1000).toLocaleString()],
    ['Updated', new Date(app.updatedAt * 1000).toLocaleString()],
    ['Profile hash', app.profileHash],
    ['Encrypted profile reference', app.encryptedProfileCid],
    ['Previous application', app.previousApplicationId],
  ];
  const profileRows = [
    ['Registered company name', app.companyName],
    ['Registration number', app.companyRegistrationNumber],
    ['Registration country', app.registrationCountry],
    ['Business address', app.businessAddress],
    ['Company email', app.companyEmail],
    ['Contact number', app.contactNumber],
    ['Authorised representative', app.representativeName],
    ['Representative position', app.representativePosition],
    ['Company DID', app.companyDid],
    ['Initial location', app.initialLocationName],
    ['Initial location address', app.initialLocationAddress],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <div>
      <BackNavigation onClick={onBack}>Back</BackNavigation>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          On-chain application
        </h2>
        <Badge
          label={app.status}
          variant={
            app.status === 'approved'
              ? 'verified'
              : app.status === 'rejected'
                ? 'rejected'
                : 'pending'
          }
        />
      </div>
      <Card>
        <div className="workspace-company-review">
          <CompanyAvatar
            name={app.companyName || 'Company'}
            logoPath={app.pendingLogoPath}
            size="lg"
          />
          <div>
            <strong>{app.companyName || 'Company name unavailable'}</strong>
            <span>Applicant-provided logo · presentation only</span>
          </div>
        </div>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Authoritative local-chain record</div>
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: 'grid',
              gridTemplateColumns: '190px 1fr',
              gap: 12,
              padding: '10px 0',
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            <span style={{ color: T.text2, fontSize: 12 }}>{label}</span>
            <code style={{ color: T.text, fontSize: 12, overflowWrap: 'anywhere' }}>{value}</code>
          </div>
        ))}
      </Card>
      <div style={{ marginTop: 14 }}>
        <Alert
          type={app.contentStatus === 'unavailable' ? 'error' : 'info'}
          message={
            app.contentStatus === 'unavailable'
              ? (app.contentError ?? 'The encrypted application content is unavailable.')
              : app.contentStatus === 'legacy-local'
                ? 'Legacy application details are available from this backend cache only. They are not portable to another backend.'
                : 'Private company information is decrypted from the on-chain encrypted manifest reference for this authorized review.'
          }
        />
      </div>
      {profileRows.length > 0 && (
        <Card>
          <h3>Applicant-provided company information</h3>
          {profileRows.map(([label, value]) => (
            <div className="workspace-detail-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </Card>
      )}
      <ApplicationDocumentsPanel applicationId={app.id} readOnly />
      {error && <div style={{ marginTop: 12, color: T.red, fontSize: 12 }}>{error}</div>}
      {(app.status === 'pending' || app.status === 'approved') && (
        <div style={{ marginTop: 16 }} className="action-row">
          {app.status === 'pending' && (
            <Btn onClick={() => setRejecting(true)} variant="danger">
              Reject on-chain
            </Btn>
          )}
          <Btn disabled={app.contentStatus === 'unavailable'} onClick={() => setApproving(true)}>
            {app.status === 'pending'
              ? 'Issue credential & approve'
              : 'Complete credential activation'}
          </Btn>
        </div>
      )}
      {approving && (
        <Modal
          title="Issue Company Role Credential"
          onClose={() => setApproving(false)}
          width={500}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <Alert
              type="info"
              message={`Confirm the ${app.requestedRole} role requested on-chain for ${app.applicant}. New issuance needs approval and credential-registration confirmations; a retry prepares only unfinished transactions.`}
            />
            <Input
              label="Approved role (fixed by application)"
              value={app.requestedRole}
              onChange={() => undefined}
            />
            <Input
              label={
                app.companyRegistrationNumber
                  ? 'Company registration number (from application)'
                  : 'Company registration number (legacy application)'
              }
              value={companyId}
              onChange={app.companyRegistrationNumber ? () => undefined : setCompanyId}
              required
            />
            <Input
              label={
                app.companyName
                  ? 'Verified company name (from application)'
                  : 'Verified company name (legacy application)'
              }
              value={companyName}
              onChange={app.companyName ? () => undefined : setCompanyName}
              required
            />
            <CountryField
              label="Registration country (verified by Admin)"
              required
              value={registrationCountry}
              onChange={
                app.contentStatus === 'available' ? () => undefined : setRegistrationCountry
              }
            />
            {!registrationCountry && (
              <p>
                Legacy issuance without a country cannot satisfy requests for registration country.
              </p>
            )}
            <Input
              label="Credential expiration"
              value={expirationDate}
              onChange={setExpirationDate}
              type="date"
              required
            />
            <div style={{ marginTop: 4 }} className="action-row">
              <Btn onClick={() => setApproving(false)} variant="outline">
                Cancel
              </Btn>
              <Btn
                disabled={
                  app.contentStatus === 'unavailable' ||
                  !companyId.trim() ||
                  !companyName.trim() ||
                  !expirationDate ||
                  !registrationCountry ||
                  busy
                }
                onClick={() => void approve()}
              >
                {busy
                  ? 'Issuing and confirming...'
                  : app.status === 'pending'
                    ? 'Issue and approve'
                    : 'Resume issuance'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
      {rejecting && (
        <Modal title="Reject on-chain application" onClose={() => setRejecting(false)} width={440}>
          <Textarea
            label="Reason"
            value={reason}
            onChange={setReason}
            placeholder="Reason is hashed before it is written on-chain."
            rows={3}
          />
          <div style={{ marginTop: 14 }} className="action-row">
            <Btn onClick={() => setRejecting(false)} variant="outline">
              Cancel
            </Btn>
            <Btn disabled={!reason.trim() || busy} onClick={() => void reject()} variant="danger">
              {busy ? 'Confirming…' : 'Confirm rejection'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function roleNumber(role: ChainApplication['requestedRole']) {
  return { Supplier: 2, Manufacturer: 3, Distributor: 4, Retailer: 5 }[role];
}
