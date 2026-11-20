import { CountryField } from './CountryField';
import { BackNavigation } from '../../components/ui/BackNavigation';
import { RequiredLabel } from '../../components/ui/RequiredLabel';
import { RegistrationCountrySelect } from './RegistrationCountrySelect';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input/max';
import flags from 'react-phone-number-input/flags';
import 'react-phone-number-input/style.css';
import { companyApplicationContentAuthorizationMessage } from '@tracechain/shared';
import { BrowserProvider, ZeroHash, hexlify, id, isAddress, randomBytes } from 'ethers';
import {
  Building2,
  Mail,
  UserRound,
  Wallet,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  ImageUp,
  Eye,
  Link2,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { notify, readableError } from '../../components/ui/feedback';

import { Brand } from '../../components/brand/Brand';
import { Button, Card, Input, Modal, Select, StatusBadge } from '../../components/ui';
import { chainConfig, targetChainId } from '../../config/chain';
import {
  getApplicationManifestConfiguration,
  prepareApplicationManifest,
  prepareCompanyApplication,
  sendPreparedTransaction,
  type PreparedApplicationManifest,
} from '../blockchain/blockchain.api';
import { imageFilePayload } from '../orders/orders.api';
import { textError, uploadError } from '../validation/form-validation';

const roleOptions = [
  { label: 'Select a company role', value: '' },
  { label: 'Supplier', value: 'SUPPLIER' },
  { label: 'Manufacturer', value: 'MANUFACTURER' },
  { label: 'Distributor', value: 'DISTRIBUTOR' },
  { label: 'Retailer', value: 'RETAILER' },
] as const;
const steps = [
  'Company details',
  'Contact & representative',
  'Wallet & identity',
  'Supporting documents',
  'Review & submit',
] as const;
const stepDescriptions = [
  'Enter your legal company details and requested role.',
  'Add company contact details and your authorised representative.',
  'Connect the wallet that will represent your company.',
] as const;
const acceptedFiles = '.pdf,.jpg,.jpeg,.png';
const documentLabels: Record<string, string> = {
  registrationProof: 'Company registration proof',
  businessProof: 'Business licence / role proof',
  authorisationProof: 'Representative authorisation',
  certifications: 'Optional certifications',
};
const requiredDocumentNames = ['registrationProof', 'businessProof', 'authorisationProof'] as const;
const roleValues: Record<string, number> = {
  SUPPLIER: 2,
  MANUFACTURER: 3,
  DISTRIBUTOR: 4,
  RETAILER: 5,
};

interface RegistrationData {
  address: string;
  companyDid: string;
  companyEmail: string;
  companyName: string;
  contactNumber: string;
  declaration: boolean;
  registrationNumber: string;
  registrationCountry: string;
  representativeName: string;
  representativePosition: string;
  requestedRole: string;
  wallet: string;
}
const initialData: RegistrationData = {
  address: '',
  companyDid: '',
  companyEmail: '',
  companyName: '',
  contactNumber: '',
  declaration: false,
  registrationNumber: '',
  registrationCountry: '',
  representativeName: '',
  representativePosition: '',
  requestedRole: '',
  wallet: '',
};

function DocumentUpload({
  error,
  label,
  name,
  onChange,
  required = false,
  value,
}: {
  error?: string;
  label: string;
  name: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  value?: File;
}) {
  const helpId = `${name}-upload-help`;
  const errorId = `${name}-upload-error`;
  return (
    <label
      className={`document-upload${value ? ' document-upload--selected' : ''}${error ? ' document-upload--invalid' : ''}`}
    >
      <input
        accept={acceptedFiles}
        aria-describedby={error ? `${helpId} ${errorId}` : value ? undefined : helpId}
        aria-invalid={Boolean(error)}
        name={name}
        onChange={onChange}
        required={required}
        type="file"
      />
      <span className="document-upload__icon" aria-hidden="true">
        {error ? <CircleAlert /> : value ? <FileCheck2 /> : <UploadCloud />}
      </span>
      <span className="document-upload__content">
        <strong>
          <RequiredLabel label={label} required={required} />
        </strong>
        {value ? (
          <>
            <span className="document-upload__status">File selected</span>
            <small className="document-upload__filename" title={value.name}>
              {value.name}
            </small>
            <span className="document-upload__action">Change file</span>
          </>
        ) : (
          <small id={helpId}>PDF, JPG or PNG · maximum 10 MB</small>
        )}
        {error && (
          <small className="document-upload__error" id={errorId} role="alert">
            {error}
          </small>
        )}
      </span>
    </label>
  );
}

export function RegisterCompanyPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(0);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeading.current?.focus({ preventScroll: true });
    stepHeading.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [step]);
  const [data, setData] = useState(initialData);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneError = phoneTouched
    ? !data.contactNumber
      ? 'Contact number is required.'
      : !isValidPhoneNumber(data.contactNumber)
        ? 'Enter a valid phone number for the selected country.'
        : ''
    : '';
  const [documents, setDocuments] = useState<Record<string, File>>({});
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<File>();
  const [logoPreview, setLogoPreview] = useState('');
  const [previewDocument, setPreviewDocument] = useState<{ file: File; url: string }>();
  useEffect(
    () => () => {
      if (previewDocument) URL.revokeObjectURL(previewDocument.url);
    },
    [previewDocument],
  );
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const connectionPending = useRef(false);
  const [walletFeedback, setWalletFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState('');
  const [transaction, setTransaction] = useState<{
    applicationId: string;
    hash: string;
    status: 'pending' | 'confirmed';
  }>();
  const applicationOperation = useRef<
    | {
        applicationId: string;
        submissionTime: string;
      }
    | undefined
  >(undefined);
  const preparedManifest = useRef<PreparedApplicationManifest | undefined>(undefined);
  const requiredDocumentCount = requiredDocumentNames.filter((name) => documents[name]).length;
  useEffect(() => {
    if (error) notify(error, 'error');
  }, [error]);
  useEffect(() => {
    if (!logo) {
      setLogoPreview('');
      return;
    }
    const preview = URL.createObjectURL(logo);
    setLogoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [logo]);
  const update = (field: keyof RegistrationData, value: string | boolean) => {
    setData((current) => ({ ...current, [field]: value }));
    applicationOperation.current = undefined;
    preparedManifest.current = undefined;
    setError('');
  };
  const informationError = (currentStep?: number) => {
    const fieldsByStep = [
      ['companyName', 'registrationNumber', 'address'],
      ['companyEmail', 'contactNumber', 'representativeName', 'representativePosition'],
      [],
    ];
    for (const [field, label, maximum] of [
      ['companyName', 'Registered company name', 200],
      ['registrationNumber', 'Registration number', 120],
      ['companyEmail', 'Company email', 254],
      ['contactNumber', 'Contact number', 40],
      ['address', 'Business address', 1000],
      ['representativeName', 'Authorised representative', 160],
      ['representativePosition', 'Representative position', 120],
    ] as const) {
      if (currentStep !== undefined && !fieldsByStep[currentStep]?.includes(field)) continue;
      const error = textError(data[field], label, maximum);
      if (error) return error;
    }
    if (
      (currentStep === undefined || currentStep === 1) &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.companyEmail.trim())
    )
      return 'Enter a valid company email address.';
    if ((currentStep === undefined || currentStep === 1) && !isValidPhoneNumber(data.contactNumber))
      return 'Enter a valid contact number for the selected country.';
    if (
      (currentStep === undefined || currentStep === 0) &&
      !Object.hasOwn(roleValues, data.requestedRole)
    )
      return 'Select a supported supply-chain role.';
    if ((currentStep === undefined || currentStep === 2) && !isAddress(data.wallet))
      return 'Connect a valid company wallet.';
    if (
      (currentStep === undefined || currentStep === 2) &&
      data.companyDid &&
      (data.companyDid.length > 512 ||
        !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(data.companyDid.trim()))
    )
      return 'Enter a valid company DID or leave it empty.';
    return '';
  };
  const documentError = () =>
    !requiredDocumentNames.every((name) => documents[name])
      ? 'Upload all three required supporting documents.'
      : (Object.values(documents)
          .map((file) =>
            uploadError(file, 10 * 1024 * 1024, /\.(pdf|jpe?g|png)$/i, [
              'application/pdf',
              'image/jpeg',
              'image/png',
            ]),
          )
          .find(Boolean) ?? '');

  const connectWallet = async () => {
    if (connectionPending.current || submitting || transaction) return;
    if (!window.ethereum) {
      setError('MetaMask was not detected. Install or enable it before continuing.');
      return;
    }
    connectionPending.current = true;
    setConnecting(true);
    setError('');
    setWalletFeedback('Open MetaMask and choose the account for this company.');
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send('wallet_requestPermissions', [{ eth_accounts: {} }]);
      const accounts = await provider.send('eth_accounts', []);
      const account = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof account !== 'string' || !isAddress(account))
        throw new Error('No account was selected. Open MetaMask and select a company account.');
      update('wallet', account);
      setWalletFeedback('Wallet connected. Check the address before continuing.');
      notify('Company wallet connected successfully.', 'success');
    } catch (cause) {
      const error = cause as { code?: number | string; info?: { error?: { code?: number } } };
      const code = error?.info?.error?.code ?? error?.code;
      setWalletFeedback('');
      setError(
        code === 4001 || code === 'ACTION_REJECTED'
          ? 'Account selection was cancelled. Your connected wallet has not changed.'
          : code === -32002
            ? 'MetaMask already has a pending request. Open MetaMask to finish or cancel it, then retry.'
            : readableError(cause, 'The wallet could not connect. Open MetaMask and try again.'),
      );
    } finally {
      connectionPending.current = false;
      setConnecting(false);
    }
  };

  const goToStep = (target: number) => {
    if (connecting || submitting || transaction) return;
    for (let index = 0; index < target; index++) {
      const invalid = index < 3 ? informationError(index) : documentError();
      if (target > step && invalid) {
        setStep(index);
        setError(invalid);
        return;
      }
    }
    setError('');
    if (target === steps.length - 1 && target !== step)
      setData((current) => ({ ...current, declaration: false }));
    setStep(target);
  };
  const next = () => goToStep(Math.min(step + 1, steps.length - 1));

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const invalid = uploadError(file, 10 * 1024 * 1024, /\.(pdf|jpe?g|png)$/i, [
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]);
    if (invalid) {
      const name = event.target.name;
      event.target.value = '';
      setDocuments((current) => {
        const updated = { ...current };
        delete updated[name];
        return updated;
      });
      setDocumentErrors((current) => ({ ...current, [name]: invalid }));
      setError('');
      return;
    }
    const name = event.target.name;
    setDocuments((current) => ({ ...current, [name]: file }));
    applicationOperation.current = undefined;
    preparedManifest.current = undefined;
    setData((current) => ({ ...current, declaration: false }));
    setDocumentErrors((current) => {
      const updated = { ...current };
      delete updated[name];
      return updated;
    });
    setError('');
  };

  const selectLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const invalid = uploadError(file, 2 * 1024 * 1024, /\.(png|jpe?g|webp)$/i, [
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);
    if (invalid) {
      event.target.value = '';
      setLogo(undefined);
      setError(invalid);
      return;
    }
    setLogo(file);
    applicationOperation.current = undefined;
    preparedManifest.current = undefined;
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || transaction) return;
    if (step !== steps.length - 1) {
      next();
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter?.getAttribute('data-registration-submit') !== 'true') return;
    const invalid = informationError() || documentError();
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!data.declaration) {
      setError('Confirm the declaration before submitting.');
      return;
    }
    if (!window.ethereum) {
      setError('MetaMask is required to submit the application.');
      return;
    }
    setSubmitting(true);
    setError('');
    let broadcastTransaction: { applicationId: string; hash: string } | undefined;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== targetChainId)
        throw new Error(`Switch MetaMask to ${chainConfig.name} before submitting.`);
      const signer = await provider.getSigner();
      if ((await signer.getAddress()).toLowerCase() !== data.wallet.toLowerCase())
        throw new Error(
          'The active MetaMask account does not match the connected application wallet.',
        );
      applicationOperation.current ??= createApplicationOperation(data.wallet);
      const { applicationId, submissionTime } = applicationOperation.current;
      const documentPayloads = await Promise.all(
        Object.entries(documents).map(async ([kind, file]) => ({
          kind,
          fileName: file.name,
          mimeType: file.type,
          ...(await readFilePayload(file)),
        })),
      );
      const logoPayload = logo ? await imageFilePayload(logo) : undefined;
      let manifest = preparedManifest.current;
      if (!manifest) {
        setSubmissionStage('Preparing encrypted application content...');
        const configuration = await getApplicationManifestConfiguration();
        if (BigInt(configuration.chainId) !== targetChainId)
          throw new Error('The application storage service targets a different chain.');
        const descriptors = documentPayloads.map((file) => ({
          contentHash: file.contentHash,
          fileName: file.fileName,
          kind: file.kind,
          mimeType: file.mimeType,
          size: file.size,
        }));
        const logoDescriptor = logoPayload
          ? {
              contentHash: await hashBase64File(logoPayload.data, logoPayload.fileName),
              fileName: logoPayload.fileName,
              kind: 'companyLogo',
              mimeType: logoPayload.mimeType,
              size: base64ByteLength(logoPayload.data, logoPayload.fileName),
            }
          : undefined;
        const contentAuthorization = {
          applicationId,
          applicantWallet: data.wallet,
          businessAddress: data.address.trim(),
          chainId: configuration.chainId,
          ...(data.companyDid.trim() ? { companyDid: data.companyDid.trim() } : {}),
          companyEmail: data.companyEmail.trim(),
          companyName: data.companyName.trim(),
          companyRegistrationNumber: data.registrationNumber.trim(),
          contactNumber: data.contactNumber,
          declarationAcceptedAt: submissionTime,
          declarationVersion: configuration.declarationVersion,
          documents: descriptors,
          ...(logoDescriptor ? { logo: logoDescriptor } : {}),
          previousApplicationId: ZeroHash,
          registryAddress: configuration.registryAddress,
          ...(data.registrationCountry ? { registrationCountry: data.registrationCountry } : {}),
          representativeName: data.representativeName.trim(),
          representativePosition: data.representativePosition.trim(),
          requestedRole: roleValues[data.requestedRole],
          submissionTime,
        };
        setSubmissionStage('Confirm application content in MetaMask...');
        const contentAuthorizationSignature = await signer.signMessage(
          companyApplicationContentAuthorizationMessage(contentAuthorization),
        );
        setSubmissionStage('Encrypting and uploading application content...');
        manifest = await prepareApplicationManifest({
          applicationId,
          applicantWallet: data.wallet,
          businessAddress: data.address.trim(),
          ...(data.companyDid.trim() ? { companyDid: data.companyDid.trim() } : {}),
          companyEmail: data.companyEmail.trim(),
          companyName: data.companyName.trim(),
          companyRegistrationNumber: data.registrationNumber.trim(),
          contactNumber: data.contactNumber,
          contentAuthorizationSignature,
          declarationAcceptedAt: submissionTime,
          declarationVersion: configuration.declarationVersion,
          documents: documentPayloads.map(({ contentHash: _hash, size: _size, ...file }) => file),
          ...(logoPayload ? { logo: logoPayload } : {}),
          previousApplicationId: ZeroHash,
          ...(data.registrationCountry ? { registrationCountry: data.registrationCountry } : {}),
          representativeName: data.representativeName.trim(),
          representativePosition: data.representativePosition.trim(),
          requestedRole: roleValues[data.requestedRole],
          submissionTime,
        });
        preparedManifest.current = manifest;
      }
      setSubmissionStage('Confirm the on-chain application reference in MetaMask...');
      const applicantSignature = await signer.signMessage(manifest.bindingMessage);
      const prepared = await prepareCompanyApplication({
        applicationId: manifest.applicationId,
        applicantWallet: manifest.applicantWallet,
        applicantSignature,
        companyName: manifest.companyName,
        companyRegistrationNumber: manifest.companyRegistrationNumber,
        ...(manifest.registrationCountry
          ? { registrationCountry: manifest.registrationCountry }
          : {}),
        encryptedProfileCid: manifest.encryptedProfileCid,
        previousApplicationId: manifest.previousApplicationId,
        profileHash: manifest.profileHash,
        requestedRole: manifest.requestedRole,
      });
      if (BigInt(prepared.chainId) !== targetChainId)
        throw new Error('The API transaction targets a different chain.');
      setSubmissionStage('Submit the application transaction in MetaMask...');
      const pending = await sendPreparedTransaction(signer, prepared);
      broadcastTransaction = { applicationId, hash: pending.hash };
      setTransaction({ ...broadcastTransaction, status: 'pending' });
      setSubmissionStage('Waiting for blockchain confirmation...');
      const receipt = await pending.wait();
      if (!receipt || receipt.status !== 1)
        throw new Error('The application transaction was not confirmed successfully.');
      setTransaction({ applicationId, hash: receipt.hash, status: 'confirmed' });
      notify(
        'Application submitted successfully. Sign in to check its approval status.',
        'success',
      );
      navigate('/login', { replace: true });
    } catch (cause) {
      setError(
        broadcastTransaction
          ? 'The transaction was submitted, but TraceChain could not confirm the registry readback. Do not submit it again. Sign in with this wallet to check the application status.'
          : readableError(cause, 'The application could not be submitted. Please try again.'),
      );
    } finally {
      setSubmitting(false);
      setSubmissionStage('');
    }
  };

  return (
    <div className="public-form-page registration-page">
      <header className="public-form-header">
        <Link to="/login">
          <Brand />
        </Link>
      </header>
      <main className="registration-content">
        <BackNavigation to="/login">Return to sign in</BackNavigation>
        <section className="registration-heading">
          <StatusBadge tone="info">Company onboarding</StatusBadge>
          <h1>Register your company</h1>
          <p>
            Apply to join the TraceChain network and receive a verified Company Role Credential.
          </p>
        </section>
        <nav aria-label="Registration progress" className="registration-progress">
          {steps.map((label, index) => (
            <button
              type="button"
              aria-label={`Step ${index + 1}: ${label}`}
              onClick={() => goToStep(index)}
              disabled={connecting || submitting || Boolean(transaction)}
              className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}
              aria-current={index === step ? 'step' : undefined}
              key={label}
            >
              <span className="registration-progress__number" aria-hidden="true">
                {index < step ? <Check /> : index + 1}
              </span>
              <span className="registration-progress__label">
                <strong>{label}</strong>
              </span>
            </button>
          ))}
        </nav>
        <p className="registration-step-count" role="status">
          Step {step + 1} of {steps.length}
        </p>
        <form onSubmit={submit}>
          <Card className="registration-card">
            {step < 3 && (
              <section className="registration-step">
                <header>
                  <h2 ref={stepHeading} tabIndex={-1}>
                    {steps[step]}
                  </h2>
                  <p>{stepDescriptions[step as 0 | 1 | 2]}</p>
                </header>
                <div className="registration-categories">
                  {step === 0 && (
                    <>
                      <fieldset className="registration-category">
                        <legend>
                          <Building2 size={18} aria-hidden="true" /> Company details
                        </legend>
                        <div className="registration-form">
                          <Input
                            className="registration-field--wide"
                            label="Registered company name *"
                            required
                            maxLength={200}
                            onChange={(e) => update('companyName', e.target.value)}
                            value={data.companyName}
                          />
                          <Input
                            label="Registration number *"
                            required
                            maxLength={120}
                            onChange={(e) => update('registrationNumber', e.target.value)}
                            value={data.registrationNumber}
                          />
                          <Select
                            label="Requested supply-chain role *"
                            required
                            onChange={(e) => update('requestedRole', e.target.value)}
                            options={roleOptions}
                            value={data.requestedRole}
                          />
                          <CountryField
                            label="Company registration country (Admin will verify)"
                            value={data.registrationCountry}
                            onChange={(country) => update('registrationCountry', country)}
                          />
                          <label className="field registration-field--wide">
                            <span className="field__label">
                              <RequiredLabel label="Business address" required />
                            </span>
                            <textarea
                              className="field__control"
                              required
                              maxLength={1000}
                              onChange={(e) => update('address', e.target.value)}
                              rows={3}
                              value={data.address}
                            />
                          </label>
                          <div className="registration-logo-field">
                            <span className="field__label">Company logo (optional)</span>
                            <div className="registration-logo-field__content">
                              <div
                                className="registration-logo-preview"
                                aria-label="Company logo preview"
                              >
                                {logoPreview ? (
                                  <img src={logoPreview} alt="Selected company logo preview" />
                                ) : (
                                  <span>{companyInitials(data.companyName)}</span>
                                )}
                              </div>
                              <div>
                                <p>PNG, JPEG or WebP · maximum 2 MB</p>
                                <div className="registration-logo-field__actions">
                                  <label className="ui-button ui-button--secondary ui-button--small">
                                    <ImageUp size={15} /> {logo ? 'Replace logo' : 'Choose logo'}
                                    <input
                                      aria-label="Choose company logo"
                                      type="file"
                                      accept="image/png,image/jpeg,image/webp"
                                      onChange={selectLogo}
                                    />
                                  </label>
                                  {logo && (
                                    <button
                                      className="ui-button ui-button--ghost ui-button--small"
                                      type="button"
                                      onClick={() => setLogo(undefined)}
                                    >
                                      <Trash2 size={15} /> Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            <small>
                              Presentation only. It remains private until this application is
                              approved.
                            </small>
                          </div>
                        </div>
                      </fieldset>
                    </>
                  )}
                  {step === 1 && (
                    <>
                      <fieldset className="registration-category">
                        <legend>
                          <Mail size={18} aria-hidden="true" /> Contact details
                        </legend>
                        <div className="registration-form">
                          <Input
                            label="Company email *"
                            required
                            maxLength={254}
                            onChange={(e) => update('companyEmail', e.target.value)}
                            type="email"
                            value={data.companyEmail}
                          />
                          <div className="field">
                            <label className="field__label" htmlFor="registration-contact-number">
                              <RequiredLabel label="Contact number" required />
                            </label>
                            <PhoneInput
                              id="registration-contact-number"
                              defaultCountry="MY"
                              countrySelectComponent={RegistrationCountrySelect}
                              international
                              countryCallingCodeEditable={false}
                              focusInputOnCountrySelection={false}
                              flags={flags}
                              value={data.contactNumber || undefined}
                              onChange={(value) => update('contactNumber', value ?? '')}
                              onBlur={(event) => {
                                if (
                                  event.target instanceof HTMLInputElement &&
                                  event.target.type === 'tel'
                                )
                                  setPhoneTouched(true);
                              }}
                              required
                              autoComplete="tel"
                              placeholder="Enter contact number"
                              className="field__control gap-3 focus-within:border-ui-primary focus-within:ring-2 focus-within:ring-ui-primary/10"
                              numberInputProps={{
                                className:
                                  'min-w-0 flex-1 border-0 bg-transparent p-0 text-inherit shadow-none outline-none',
                                maxLength: 40,
                                'aria-invalid': Boolean(phoneError),
                                'aria-describedby': 'registration-phone-help',
                              }}
                              countrySelectProps={{ 'aria-label': 'Contact number country' }}
                            />
                            <span
                              id="registration-phone-help"
                              className={
                                phoneError
                                  ? 'field__message field__message--error'
                                  : 'field__message'
                              }
                              role={phoneError ? 'alert' : undefined}
                            >
                              {phoneError ||
                                'Select your country and enter the company contact number.'}
                            </span>
                          </div>
                        </div>
                      </fieldset>
                      <fieldset className="registration-category">
                        <legend>
                          <UserRound size={18} aria-hidden="true" /> Authorised representative
                        </legend>
                        <div className="registration-form">
                          <Input
                            label="Authorised representative *"
                            required
                            maxLength={160}
                            onChange={(e) => update('representativeName', e.target.value)}
                            value={data.representativeName}
                          />
                          <Input
                            label="Representative position *"
                            required
                            maxLength={120}
                            onChange={(e) => update('representativePosition', e.target.value)}
                            value={data.representativePosition}
                          />
                        </div>
                      </fieldset>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <fieldset className="registration-category">
                        <legend>
                          <Wallet size={18} aria-hidden="true" /> Wallet & digital identity
                        </legend>
                        <div className="registration-form">
                          <div className="wallet-field">
                            <span className="field__label">
                              <RequiredLabel label="Connected wallet" required />
                            </span>
                            <div>
                              <code>{data.wallet || 'No wallet connected'}</code>
                              <Button
                                loading={connecting}
                                leadingIcon={<Link2 size={15} aria-hidden="true" />}
                                disabled={connecting || submitting || Boolean(transaction)}
                                onClick={connectWallet}
                                size="small"
                                type="button"
                                variant="secondary"
                              >
                                {connecting
                                  ? 'Choose in MetaMask?'
                                  : data.wallet
                                    ? 'Change account'
                                    : 'Connect MetaMask'}
                              </Button>
                            </div>
                            <small>The wallet will own and sign this company application.</small>
                            {walletFeedback && (
                              <small role="status" aria-live="polite">
                                {walletFeedback}
                              </small>
                            )}
                          </div>
                          <Input
                            className="registration-field--wide"
                            hint="Optional — add this if your organisation already has a DID."
                            label="Company DID"
                            maxLength={512}
                            onChange={(e) => update('companyDid', e.target.value)}
                            value={data.companyDid}
                          />
                        </div>
                      </fieldset>
                    </>
                  )}
                </div>
              </section>
            )}
            {step === 3 && (
              <section className="registration-step">
                <header>
                  <h2 ref={stepHeading} tabIndex={-1}>
                    Supporting documents
                  </h2>
                  <p>
                    Documents are prepared for encrypted off-chain storage; only integrity
                    references belong on-chain.
                  </p>
                </header>
                <p className="document-progress" aria-live="polite">
                  <strong>{requiredDocumentCount} of 3 required documents selected</strong>
                </p>
                <div className="document-grid">
                  <DocumentUpload
                    error={documentErrors.registrationProof}
                    label="Company registration proof"
                    name="registrationProof"
                    onChange={selectFile}
                    required
                    value={documents.registrationProof}
                  />
                  <DocumentUpload
                    error={documentErrors.businessProof}
                    label="Business licence / role proof"
                    name="businessProof"
                    onChange={selectFile}
                    required
                    value={documents.businessProof}
                  />
                  <DocumentUpload
                    error={documentErrors.authorisationProof}
                    label="Representative authorisation"
                    name="authorisationProof"
                    onChange={selectFile}
                    required
                    value={documents.authorisationProof}
                  />
                  <DocumentUpload
                    error={documentErrors.certifications}
                    label="Optional certifications"
                    name="certifications"
                    onChange={selectFile}
                    value={documents.certifications}
                  />
                </div>
                <aside className="registration-security-note">
                  <FileCheck2 />
                  <p>
                    <strong>Your documents remain private.</strong>
                    <span>
                      They must be encrypted before IPFS upload and are reviewed only by the Product
                      Traceability Authority.
                    </span>
                  </p>
                </aside>
              </section>
            )}
            {step === 4 && (
              <section className="registration-step">
                <header>
                  <h2 ref={stepHeading} tabIndex={-1}>
                    Review your application
                  </h2>
                  <p>
                    Confirm that the organisation, requested role, wallet, and documents are
                    correct.
                  </p>
                </header>
                <dl className="registration-review">
                  <div>
                    <dt>Company</dt>
                    <dd>{data.companyName}</dd>
                  </div>
                  <div>
                    <dt>Registration no.</dt>
                    <dd>{data.registrationNumber}</dd>
                  </div>
                  <div>
                    <dt>Requested role</dt>
                    <dd>
                      {roleOptions.find((option) => option.value === data.requestedRole)?.label}
                    </dd>
                  </div>
                  <div>
                    <dt>Business email</dt>
                    <dd>{data.companyEmail}</dd>
                  </div>
                  <div className="registration-review--wide">
                    <dt>Connected wallet</dt>
                    <dd>
                      <code>{data.wallet}</code>
                    </dd>
                  </div>
                  <div className="registration-review--wide">
                    <dt>Documents</dt>
                    <dd>{Object.keys(documents).length} file(s) selected</dd>
                  </div>
                  <div className="registration-review--wide registration-review-logo">
                    <dt>Company logo</dt>
                    <dd>
                      <span className="registration-logo-preview registration-logo-preview--review">
                        {logoPreview ? (
                          <img src={logoPreview} alt="Company logo selected for submission" />
                        ) : (
                          <span>{companyInitials(data.companyName)}</span>
                        )}
                      </span>
                      {logo ? logo.name : 'No logo selected'}
                    </dd>
                  </div>
                </dl>
                <section
                  className="registration-review-documents"
                  aria-label="Supporting document review"
                >
                  <h3>Supporting documents</h3>
                  <p>
                    Preview your selected files before submitting. Nothing is uploaded until you
                    select Submit application.
                  </p>
                  {Object.entries(documents).map(([kind, file]) => (
                    <div key={kind} className="registration-review-document">
                      <FileCheck2 size={20} aria-hidden="true" />
                      <div>
                        <strong>{documentLabels[kind]}</strong>
                        <span>
                          {file.name} - {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <Button
                        size="small"
                        variant="secondary"
                        leadingIcon={<Eye size={16} aria-hidden="true" />}
                        aria-label={'Preview ' + file.name}
                        onClick={() => {
                          try {
                            setPreviewDocument({ file, url: URL.createObjectURL(file) });
                          } catch {
                            setError('This document could not be opened for preview.');
                          }
                        }}
                      >
                        Preview
                      </Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="small" onClick={() => goToStep(3)}>
                    Change documents
                  </Button>
                </section>
                <label className="registration-declaration">
                  <input
                    checked={data.declaration}
                    onChange={(e) => update('declaration', e.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I confirm that I am authorised to submit this application and that the
                    information provided is accurate.
                  </span>
                </label>
              </section>
            )}
            {transaction && (
              <p aria-live="polite" className="registration-success">
                <strong>
                  {transaction.status === 'confirmed'
                    ? `Application submitted on ${chainConfig.name}.`
                    : 'Application transaction submitted; confirmation is still being checked.'}
                </strong>
                <span>Transaction: {transaction.hash}</span>
                <span>Application ID: {transaction.applicationId}</span>
              </p>
            )}
            {error && (
              <p aria-live="polite" className="registration-error">
                {error}
              </p>
            )}
            {submitting && submissionStage && (
              <p aria-live="polite" className="registration-status">
                {submissionStage}
              </p>
            )}
            <footer className="registration-actions">
              {step > 0 && !transaction && (
                <Button
                  onClick={() => goToStep(step - 1)}
                  disabled={connecting || submitting}
                  leadingIcon={<ChevronLeft size={16} aria-hidden="true" />}
                  type="button"
                  variant="secondary"
                >
                  Back
                </Button>
              )}
              <span />
              {step < steps.length - 1 ? (
                <Button
                  key="continue-registration"
                  onClick={next}
                  type="button"
                  disabled={connecting || submitting}
                  trailingIcon={<ChevronRight size={16} aria-hidden="true" />}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  key="submit-registration"
                  data-registration-submit="true"
                  disabled={!data.declaration || Boolean(transaction)}
                  loading={submitting}
                  type="submit"
                >
                  {transaction ? 'Application submitted' : 'Submit application'}
                </Button>
              )}
            </footer>
          </Card>
        </form>
        <Modal
          isOpen={Boolean(previewDocument)}
          onClose={() => setPreviewDocument(undefined)}
          title="Document preview"
          footer={
            previewDocument ? (
              <a
                href={previewDocument.url}
                download={previewDocument.file.name}
                className="ui-button ui-button--secondary ui-button--small"
              >
                Download selected file
              </a>
            ) : undefined
          }
        >
          {previewDocument && (
            <>
              <p className="registration-preview-filename">{previewDocument.file.name}</p>
              {previewDocument.file.type.startsWith('image/') ? (
                <div className="document-preview-media">
                  <img
                    className="registration-document-image"
                    src={previewDocument.url}
                    alt={'Selected document: ' + previewDocument.file.name}
                  />
                </div>
              ) : (
                <>
                  <iframe
                    className="registration-document-pdf"
                    sandbox=""
                    src={previewDocument.url}
                    title="Selected PDF document"
                  />
                  <p>
                    If PDF preview is blocked by your browser, download the selected file to review
                    it.
                  </p>
                </>
              )}
            </>
          )}
        </Modal>
      </main>
    </div>
  );
}

function readFilePayload(file: File) {
  return new Promise<{ contentHash: string; data: string; size: number }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('The document could not be read.'));
        return;
      }
      try {
        const bytes = new Uint8Array(reader.result);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        resolve({ contentHash: await sha256Bytes(bytes), data: btoa(binary), size: bytes.length });
      } catch {
        reject(new Error('The document could not be fingerprinted. Select it again.'));
      }
    };
    reader.onerror = () => reject(new Error('The document could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

function createApplicationOperation(wallet: string) {
  try {
    return {
      applicationId: id(`tracechain-application:${wallet}:${hexlify(randomBytes(16))}`),
      submissionTime: new Date().toISOString(),
    };
  } catch {
    throw new Error('The browser could not create a secure application identifier. Please retry.');
  }
}

async function hashBase64File(data: string, fileName: string) {
  try {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return await sha256Bytes(bytes);
  } catch {
    throw new Error(`The selected file ${fileName} could not be fingerprinted. Select it again.`);
  }
}

async function sha256Bytes(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error('Secure browser hashing is unavailable.');
  const input = new Uint8Array(bytes.length);
  input.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input.buffer));
  return `0x${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function base64ByteLength(data: string, fileName: string) {
  try {
    return atob(data).length;
  } catch {
    throw new Error(`The selected file ${fileName} could not be read. Select it again.`);
  }
}

function companyInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'CO'
  );
}
