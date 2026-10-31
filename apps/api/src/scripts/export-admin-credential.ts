import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { CompanyRole } from '@tracechain/shared';
import {
  createTraceChainAgent,
  findStoredCompanyRoleCredential,
  type CompanyRoleCredential,
} from '@tracechain/ssi';
import 'dotenv/config';

import { loadSsiBootstrapEnvironment } from '../config/ssi-env.js';

const environment = loadSsiBootstrapEnvironment();
const agent = await createTraceChainAgent(environment.config);

const authority = await agent.didManagerGetByAlias({ alias: environment.authorityDidAlias });
const match = await findStoredCompanyRoleCredential(agent, {
  authorityDid: authority.did,
  companyId: 'TRACECHAIN_AUTHORITY',
  role: CompanyRole.SYSTEM_ADMIN,
  walletAddress: environment.adminWalletAddress,
});
if (!match) {
  throw new Error(
    'No active, cryptographically verified bootstrap System Admin credential exists.',
  );
}

const outputPath = resolve(
  environment.storageDirectory,
  '../holder/admin-company-role-credential.json',
);
await mkdir(dirname(outputPath), { recursive: true });
await writeCredentialWithoutOverwritingAnother(outputPath, match.credential);

console.log('Development holder credential exported.');
console.log(`Path: ${outputPath}`);
console.log(`Credential ID: ${match.credential.id}`);
console.log(`Role: ${match.credential.credentialSubject.role}`);
console.log(`Wallet: ${match.credential.credentialSubject.walletAddress}`);

async function writeCredentialWithoutOverwritingAnother(
  outputPath: string,
  credential: CompanyRoleCredential,
) {
  try {
    const file = await open(outputPath, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(credential, null, 2)}\n`, 'utf8');
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;

    const existing = JSON.parse(await readFile(outputPath, 'utf8')) as { id?: unknown };
    if (existing.id !== credential.id) {
      throw new Error(`Refusing to overwrite a different credential at ${outputPath}.`);
    }
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
