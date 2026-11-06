import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const repositoryEnvironmentPath = fileURLToPath(new URL('../../../../.env', import.meta.url));

config({ path: resolve(repositoryEnvironmentPath), override: false, quiet: true });
