import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/load-env.js';
import { dataDirectory } from '../config/data-directory.js';
import { restoreAdminMaterial } from './restore-admin-material.js';

async function main() {
  const argument = (name: string) =>
    process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
  const bundle = argument('bundle'),
    metadata = argument('metadata');
  if (!bundle || !metadata || !process.env.TRACECHAIN_AUTHORITY_DID_ALIAS)
    throw new Error(
      'Supply --bundle=<encrypted-file> and --metadata=<matching-public-data.json>, and configure TRACECHAIN_AUTHORITY_DID_ALIAS. Default is read-only; add --restore to back up and restore files.',
    );
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      'Run offline recovery in an interactive operator terminal. Passwords are never accepted as arguments or environment variables.',
    );
  stdout.write('Encrypted Admin bundle password (input hidden): ');
  const terminal = createInterface({ input: stdin, output: undefined, terminal: true });
  let password: string;
  try {
    password = await terminal.question('');
    stdout.write('\n');
  } finally {
    terminal.close();
  }
  const result = await restoreAdminMaterial({
    bundlePath: resolve(fileURLToPath(new URL('../../../../', import.meta.url)), bundle),
    metadataPath: resolve(fileURLToPath(new URL('../../../../', import.meta.url)), metadata),
    password,
    dataDirectory: dataDirectory(),
    backendEnvironmentPath: fileURLToPath(new URL('../../.env.runtime', import.meta.url)),
    authorityAlias: process.env.TRACECHAIN_AUTHORITY_DID_ALIAS,
    restore: process.argv.includes('--restore'),
  });
  // Counts/paths only: no credential, password, key, DID or private metadata is logged.
  stdout.write(JSON.stringify(result, null, 2) + '\n');
  stdout.write(
    result.restored
      ? 'Original files and the encrypted bundle are preserved in the backup directory. Protect apps/api/.env.runtime and restart the API.\n'
      : 'Read-only comparison complete. Added/changed encrypted entries indicate differences, not proof of chronology. Use a trusted current bundle and matching metadata.\n',
  );
}
main().catch(() => {
  console.error(
    'Offline recovery failed. Check the bundle password, matching DID/key metadata, original environment keys and filesystem permissions. No issuer identity was generated. If a write was interrupted, use the preserved recovery backup before restarting.',
  );
  process.exitCode = 1;
});
