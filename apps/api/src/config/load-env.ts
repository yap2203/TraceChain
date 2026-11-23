import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const repositoryEnvironmentPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
const backendEnvironmentPath = fileURLToPath(new URL('../../.env.runtime', import.meta.url));

// Process/secret-manager variables take precedence. This ignored API-only file is used by offline recovery.
config({ path: backendEnvironmentPath, override: false, quiet: true });
config({ path: resolve(repositoryEnvironmentPath), override: false, quiet: true });
