import { BrowserProvider, ZeroHash, hexlify, id, randomBytes } from 'ethers';
import { Check, ChevronLeft, ChevronRight, FileCheck2, Link2, UploadCloud } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Brand } from '../../components/brand/Brand';
import { Button, Card, Input, Select, StatusBadge } from '../../components/ui';
import { chainConfig, targetChainId } from '../../config/chain';
import { prepareCompanyApplication, sendPreparedTransaction } from '../blockchain/blockchain.api';

const roleOptions = [
  { label: 'Select a company role', value: '' }, { label: 'Supplier', value: 'SUPPLIER' },
  { label: 'Manufacturer', value: 'MANUFACTURER' }, { label: 'Distributor', value: 'DISTRIBUTOR' },
  { label: 'Retailer', value: 'RETAILER' },
] as const;
const steps = ['Company information', 'Supporting documents', 'Review & submit'] as const;
const acceptedFiles = '.pdf,.jpg,.jpeg,.png';
const roleValues: Record<string, number> = { SUPPLIER: 2, MANUFACTURER: 3, DISTRIBUTOR: 4, RETAILER: 5 };

interface RegistrationData { address: string; companyDid: string; companyEmail: string; companyName: string; contactNumber: string; declaration: boolean; registrationNumber: string; representativeName: string; representativePosition: string; requestedRole: string; wallet: string }
const initialData: RegistrationData = { address: '', companyDid: '', companyEmail: '', companyName: '', contactNumber: '', declaration: false, registrationNumber: '', representativeName: '', representativePosition: '', requestedRole: '', wallet: '' };

function DocumentUpload({ label, name, onChange, required = false, value }: { label: string; name: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void; required?: boolean; value?: File }) {
  return <label className="document-upload"><input accept={acceptedFiles} name={name} onChange={onChange} required={required} type="file" /><span className="document-upload__icon">{value ? <FileCheck2 /> : <UploadCloud />}</span><span><strong>{label}{required ? ' *' : ''}</strong><small>{value ? value.name : 'PDF, JPG or PNG · maximum 10 MB'}</small></span></label>;
}

export function RegisterCompanyPage() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialData);
  const [documents, setDocuments] = useState<Record<string, File>>({});
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transaction, setTransaction] = useState<{ applicationId: string; hash: string }>();
  const update = (field: keyof RegistrationData, value: string | boolean) => { setData((current) => ({ ...current, [field]: value })); setError(''); };

  const connectWallet = async () => {
    if (!window.ethereum) { setError('MetaMask was not detected. Install or enable it before continuing.'); return; }
    setConnecting(true);
    try {
      const accounts = await new BrowserProvider(window.ethereum).send('eth_requestAccounts', []);
      update('wallet', String(accounts[0] ?? ''));
    } catch { setError('Wallet connection was cancelled or could not be completed.'); }
    finally { setConnecting(false); }
  };

  const next = () => {
    if (step === 0 && Object.entries(data).some(([key, value]) => !['companyDid', 'declaration'].includes(key) && !value)) { setError('Complete all required company and representative information.'); return; }
    if (step === 1 && !['registrationProof', 'businessProof', 'authorisationProof'].every((name) => documents[name])) { setError('Upload all three required supporting documents.'); return; }
    setError(''); setStep((current) => Math.min(current + 1, 2));
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { event.target.value = ''; setError(`${file.name} is larger than 10 MB.`); return; }
    setDocuments((current) => ({ ...current, [event.target.name]: file })); setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!data.declaration) { setError('Confirm the declaration before submitting.'); return; }
    if (!window.ethereum) { setError('MetaMask is required to submit the application.'); return; }
    setSubmitting(true); setError('');
    try {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== targetChainId) throw new Error(`Switch MetaMask to ${chainConfig.name} before submitting.`);
      const signer = await provider.getSigner();
      if ((await signer.getAddress()).toLowerCase() !== data.wallet.toLowerCase()) throw new Error('The active MetaMask account does not match the connected application wallet.');
      const applicationId = id(`tracechain-application:${data.wallet}:${hexlify(randomBytes(16))}`);
      const profileHash = id(JSON.stringify({ ...data, declaration: undefined, documents: Object.entries(documents).map(([kind, file]) => ({ kind, name: file.name, size: file.size, type: file.type })) }));
      const localContentReference = `local://${profileHash}`;
      const prepared = await prepareCompanyApplication({
        applicationId,
        encryptedProfileCid: localContentReference,
        previousApplicationId: ZeroHash,
        profileHash,
        requestedRole: roleValues[data.requestedRole],
      });
      if (BigInt(prepared.chainId) !== targetChainId) throw new Error('The API transaction targets a different chain.');
      const pending = await sendPreparedTransaction(signer, prepared);
      const receipt = await pending.wait();
      if (!receipt) throw new Error('The transaction was not confirmed.');
      setTransaction({ applicationId, hash: receipt.hash });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The local blockchain transaction failed.');
    } finally { setSubmitting(false); }
  };

  return <div className="public-form-page registration-page">
    <header className="public-form-header"><Link to="/login"><Brand /></Link><Link className="public-form-header__link" to="/login">Return to sign in</Link></header>
    <main className="registration-content">
      <section className="registration-heading"><StatusBadge tone="info">Company onboarding</StatusBadge><h1>Register your company</h1><p>Apply to join the TraceChain network and receive a verified Company Role Credential.</p></section>
      <nav aria-label="Registration progress" className="registration-progress">{steps.map((label, index) => <div className={index === step ? 'is-active' : index < step ? 'is-complete' : ''} key={label}><span>{index < step ? <Check /> : index + 1}</span><p><strong>{label}</strong><small>Step {index + 1} of 3</small></p></div>)}</nav>
      <form onSubmit={submit}><Card className="registration-card">
        {step === 0 && <section className="registration-step"><header><h2>Company information</h2><p>Enter the legal organisation and authorised representative details.</p></header><div className="registration-form">
          <Input label="Registered company name *" onChange={(e) => update('companyName', e.target.value)} value={data.companyName} />
          <Input label="Registration number *" onChange={(e) => update('registrationNumber', e.target.value)} value={data.registrationNumber} />
          <Select label="Requested supply-chain role *" onChange={(e) => update('requestedRole', e.target.value)} options={roleOptions} value={data.requestedRole} />
          <Input label="Company email *" onChange={(e) => update('companyEmail', e.target.value)} type="email" value={data.companyEmail} />
          <Input label="Contact number *" onChange={(e) => update('contactNumber', e.target.value)} type="tel" value={data.contactNumber} />
          <label className="field registration-field--wide"><span className="field__label">Business address *</span><textarea className="field__control" onChange={(e) => update('address', e.target.value)} rows={3} value={data.address} /></label>
          <Input label="Authorised representative *" onChange={(e) => update('representativeName', e.target.value)} value={data.representativeName} />
          <Input label="Representative position *" onChange={(e) => update('representativePosition', e.target.value)} value={data.representativePosition} />
          <Input hint="Optional — add this if your organisation already has a DID." label="Company DID" onChange={(e) => update('companyDid', e.target.value)} value={data.companyDid} />
          <div className="wallet-field"><span className="field__label">Connected wallet *</span><div><code>{data.wallet || 'No wallet connected'}</code><Button loading={connecting} onClick={connectWallet} size="small" type="button" variant="secondary"><Link2 size={15} /> Connect</Button></div><small>The wallet will own and sign this company application.</small></div>
        </div></section>}
        {step === 1 && <section className="registration-step"><header><h2>Supporting documents</h2><p>Documents are prepared for encrypted off-chain storage; only integrity references belong on-chain.</p></header><div className="document-grid">
          <DocumentUpload label="Company registration proof" name="registrationProof" onChange={selectFile} required value={documents.registrationProof} />
          <DocumentUpload label="Business licence / role proof" name="businessProof" onChange={selectFile} required value={documents.businessProof} />
          <DocumentUpload label="Representative authorisation" name="authorisationProof" onChange={selectFile} required value={documents.authorisationProof} />
          <DocumentUpload label="Optional certifications" name="certifications" onChange={selectFile} value={documents.certifications} />
        </div><aside className="registration-security-note"><FileCheck2 /><p><strong>Your documents remain private.</strong><span>They must be encrypted before IPFS upload and are reviewed only by the Product Traceability Authority.</span></p></aside></section>}
        {step === 2 && <section className="registration-step"><header><h2>Review your application</h2><p>Confirm that the organisation, requested role, wallet, and documents are correct.</p></header><dl className="registration-review">
          <div><dt>Company</dt><dd>{data.companyName}</dd></div><div><dt>Registration no.</dt><dd>{data.registrationNumber}</dd></div><div><dt>Requested role</dt><dd>{roleOptions.find((option) => option.value === data.requestedRole)?.label}</dd></div><div><dt>Business email</dt><dd>{data.companyEmail}</dd></div><div className="registration-review--wide"><dt>Connected wallet</dt><dd><code>{data.wallet}</code></dd></div><div className="registration-review--wide"><dt>Documents</dt><dd>{Object.keys(documents).length} file(s) selected</dd></div>
        </dl><label className="registration-declaration"><input checked={data.declaration} onChange={(e) => update('declaration', e.target.checked)} type="checkbox" /><span>I confirm that I am authorised to submit this application and that the information provided is accurate.</span></label></section>}
        {transaction && <p aria-live="polite" className="registration-success"><strong>Application submitted on {chainConfig.name}.</strong><span>Transaction: {transaction.hash}</span><span>Application ID: {transaction.applicationId}</span></p>}
        {error && <p aria-live="polite" className="registration-error">{error}</p>}
        <footer className="registration-actions">{step > 0 && !transaction && <Button onClick={() => { setError(''); setStep((current) => current - 1); }} type="button" variant="secondary"><ChevronLeft size={16} /> Back</Button>}<span />{step < 2 ? <Button onClick={next} type="button">Continue <ChevronRight size={16} /></Button> : <Button disabled={Boolean(transaction)} loading={submitting} type="submit">{transaction ? 'Application submitted' : 'Submit application'}</Button>}</footer>
      </Card></form>
    </main>
  </div>;
}
