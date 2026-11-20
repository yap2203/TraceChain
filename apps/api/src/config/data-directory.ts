import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './load-env.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** Use a separate directory per deployment without moving or deleting existing keys/data. */
export function dataDirectory(environment: NodeJS.ProcessEnv = process.env) {
  return resolve(repositoryRoot, environment.TRACECHAIN_DATA_DIR?.trim() || '.tracechain');
}

export function dataFile(relativePath: string) {
  return resolve(dataDirectory(), relativePath);
}
