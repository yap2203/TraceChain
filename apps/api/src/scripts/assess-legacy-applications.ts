import { readFile } from 'node:fs/promises';

import { id } from 'ethers';

import { env } from '../config/env.js';
import { loadBlockchainEnvironment } from '../config/blockchain-env.js';
import { dataFile } from '../config/data-directory.js';
import { BlockchainGatewayService } from '../modules/blockchain/blockchain-gateway.service.js';

type JsonRecords = Record<string, unknown>;

const chain = loadBlockchainEnvironment();
const gateway = new BlockchainGatewayService(
  env.CHAIN_ID,
  chain.CHAIN_RPC_URL,
  chain.STAKEHOLDER_REGISTRY_ADDRESS,
  chain.CREDENTIAL_REGISTRY_ADDRESS,
  chain.INGREDIENT_REGISTRY_ADDRESS,
  chain.PRODUCT_REGISTRY_ADDRESS,
  chain.CUSTODY_TRANSFER_ADDRESS,
  chain.EVIDENCE_REGISTRY_ADDRESS,
);

const [applications, metadata, documents, workflow] = await Promise.all([
  gateway.listApplications(),
  readRecords(dataFile('applications/company-metadata.json')),
  readRecords(dataFile('applications/documents.encrypted.json')),
  readRecords(dataFile('issuance/production-flow.json')),
]);

const products = isRecords(workflow.products) ? workflow.products : {};
const legacy = applications.filter((application) =>
  application.encryptedProfileCid.startsWith('local://'),
);

console.log(
  JSON.stringify(
    {
      chainId: env.CHAIN_ID,
      stakeholderRegistry: chain.STAKEHOLDER_REGISTRY_ADDRESS,
      legacyApplications: legacy.map((application) => {
        const key = application.id.toLowerCase();
        const hasMetadata = Boolean(metadata[key]);
        const hasDocuments = Boolean(documents[key]);
        const logoKey = id(`pending-company-logo:${key}`).toLowerCase();
        const hasLogo = Boolean(products[logoKey]);
        return {
          applicationId: shorten(application.id),
          status: application.status,
          recoverableSources: {
            documents: hasDocuments,
            logo: hasLogo,
            profileMetadata: hasMetadata,
          },
          missingManifestFields: hasMetadata
            ? ['companyEmail', 'contactNumber', 'representativeName', 'representativePosition']
            : [
                'businessAddress',
                'companyEmail',
                'companyName',
                'companyRegistrationNumber',
                'contactNumber',
                'representativeName',
                'representativePosition',
              ],
          migrationPath: migrationPath(application.status),
        };
      }),
      note: 'Read-only assessment. No application, attachment, credential or chain record was changed.',
    },
    null,
    2,
  ),
);

function migrationPath(status: string) {
  if (status === 'additional evidence required')
    return 'Applicant may submit a newly signed manifest through the existing evidence-resubmission path.';
  if (status === 'pending')
    return 'No direct applicant update is currently permitted. An Administrator must first request additional evidence; the applicant must then sign and resubmit.';
  return 'The current contract does not permit rewriting this historical application state. Preserve it; use a new signed application or a future contract migration design.';
}

async function readRecords(path: string): Promise<JsonRecords> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isRecords(parsed) ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function isRecords(value: unknown): value is JsonRecords {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shorten(value: string) {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}
