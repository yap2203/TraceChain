/** Read-only chain verification followed by an atomic root .env update. No wallet/key needed. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, ZeroAddress, getAddress } from 'ethers';
import { parse } from 'dotenv';

class ConfigurationError extends Error {}
const root = new URL('../../../', import.meta.url);
const environmentPath = fileURLToPath(new URL('.env', root));
const addressesPath = fileURLToPath(
  new URL('../ignition/deployments/tracechain-sepolia/deployed_addresses.json', import.meta.url),
);
const journalPath = fileURLToPath(
  new URL('../ignition/deployments/tracechain-sepolia/journal.jsonl', import.meta.url),
);
const contracts = {
  StakeholderRegistry: 'STAKEHOLDER_REGISTRY_ADDRESS',
  CredentialRegistry: 'CREDENTIAL_REGISTRY_ADDRESS',
  EvidenceRegistry: 'EVIDENCE_REGISTRY_ADDRESS',
  IngredientRegistry: 'INGREDIENT_REGISTRY_ADDRESS',
  ProductRegistry: 'PRODUCT_REGISTRY_ADDRESS',
  CustodyTransfer: 'CUSTODY_TRANSFER_ADDRESS',
  SupplyChainOrders: 'SUPPLY_ORDERS_ADDRESS',
} as const;

async function main() {
  const original = await readFile(environmentPath, 'utf8');
  const environment = parse(original);
  const rpc =
    environment.CHAIN_ID === '11155111' ? environment.CHAIN_RPC_URL : environment.SEPOLIA_RPC_URL;
  if (!rpc) throw new ConfigurationError('Configure a Sepolia RPC URL in the root .env first.');
  let deployed: Record<string, string>;
  try {
    deployed = JSON.parse(await readFile(addressesPath, 'utf8'));
  } catch {
    throw new ConfigurationError(
      'No completed Sepolia address file was found. Run npm run deploy:sepolia first.',
    );
  }
  const addresses = {} as Record<keyof typeof contracts, string>;
  for (const name of Object.keys(contracts) as (keyof typeof contracts)[]) {
    try {
      addresses[name] = getAddress(deployed[`TraceChain#${name}`]);
    } catch {
      throw new ConfigurationError(`The Sepolia deployment is missing a valid ${name} address.`);
    }
    if (addresses[name] === ZeroAddress)
      throw new ConfigurationError(`${name} cannot use the zero address.`);
  }
  const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  try {
    if ((await provider.getNetwork()).chainId !== 11155111n)
      throw new ConfigurationError('The RPC is not Ethereum Sepolia (11155111).');
    for (const [name, address] of Object.entries(addresses))
      if ((await provider.getCode(address)) === '0x')
        throw new ConfigurationError(`No Sepolia contract code exists at the ${name} address.`);
    const check = async (
      from: keyof typeof contracts,
      getter: string,
      to: keyof typeof contracts,
    ) => {
      const contract = new Contract(
        addresses[from],
        [`function ${getter}() view returns (address)`],
        provider,
      );
      if (getAddress(await contract[getter]()) !== addresses[to])
        throw new ConfigurationError(
          `The ${from}.${getter} reference does not match this deployment.`,
        );
    };
    const checks = [
      () => check('StakeholderRegistry', 'credentialRegistry', 'CredentialRegistry'),
      () => check('CredentialRegistry', 'stakeholderRegistry', 'StakeholderRegistry'),
      () => check('EvidenceRegistry', 'stakeholders', 'StakeholderRegistry'),
      () => check('EvidenceRegistry', 'credentials', 'CredentialRegistry'),
      () => check('EvidenceRegistry', 'ingredients', 'IngredientRegistry'),
      () => check('IngredientRegistry', 'stakeholders', 'StakeholderRegistry'),
      () => check('IngredientRegistry', 'credentials', 'CredentialRegistry'),
      () => check('IngredientRegistry', 'productRegistry', 'ProductRegistry'),
      () => check('IngredientRegistry', 'supplyOrders', 'SupplyChainOrders'),
      () => check('ProductRegistry', 'stakeholders', 'StakeholderRegistry'),
      () => check('ProductRegistry', 'ingredients', 'IngredientRegistry'),
      () => check('ProductRegistry', 'evidence', 'EvidenceRegistry'),
      () => check('CustodyTransfer', 'stakeholders', 'StakeholderRegistry'),
      () => check('CustodyTransfer', 'products', 'ProductRegistry'),
      () => check('CustodyTransfer', 'supplyOrders', 'SupplyChainOrders'),
      () => check('SupplyChainOrders', 'stakeholders', 'StakeholderRegistry'),
      () => check('SupplyChainOrders', 'ingredients', 'IngredientRegistry'),
      () => check('SupplyChainOrders', 'products', 'ProductRegistry'),
      () => check('SupplyChainOrders', 'evidence', 'EvidenceRegistry'),
      () => check('SupplyChainOrders', 'custody', 'CustodyTransfer'),
    ];
    for (const verify of checks) await verify();
    const registry = new Contract(
      addresses.StakeholderRegistry,
      ['function administrator() view returns (address)'],
      provider,
    );
    const administrator = getAddress(await registry.administrator());
    if (administrator === ZeroAddress)
      throw new ConfigurationError('The deployed registry has no administrator.');
    const journal = (await readFile(journalPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const creation = journal.findLast(
      (entry) =>
        entry.type === 'TRANSACTION_CONFIRM' &&
        entry.futureId === 'TraceChain#StakeholderRegistry' &&
        entry.receipt?.contractAddress?.toLowerCase() ===
          addresses.StakeholderRegistry.toLowerCase(),
    );
    const receipt = creation?.hash ? await provider.getTransactionReceipt(creation.hash) : null;
    if (
      !receipt ||
      receipt.status !== 1 ||
      receipt.contractAddress?.toLowerCase() !== addresses.StakeholderRegistry.toLowerCase()
    )
      throw new ConfigurationError(
        'Cannot verify the registry creation block from the Ignition journal.',
      );
    const updates: Record<string, string> = {
      CHAIN_ID: '11155111',
      CHAIN_NAME: 'Sepolia',
      CHAIN_RPC_URL: rpc,
      CHAIN_CURRENCY_SYMBOL: 'ETH',
      CHAIN_EVENT_START_BLOCK: String(receipt.blockNumber),
      TRACECHAIN_DATA_DIR: '.tracechain/sepolia',
      BOOTSTRAP_ADMIN_WALLET: administrator,
    };
    for (const [name, key] of Object.entries(contracts))
      updates[key] = addresses[name as keyof typeof contracts];
    const seen = new Set<string>();
    const lines = original.split(/\r?\n/).flatMap((line) => {
      const key = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1];
      if (!key || !(key in updates)) return [line];
      if (seen.has(key)) return [];
      seen.add(key);
      return [`${key}=${updates[key]}`];
    });
    for (const [key, value] of Object.entries(updates))
      if (!seen.has(key)) lines.push(`${key}=${value}`);
    if ((await readFile(environmentPath, 'utf8')) !== original)
      throw new ConfigurationError(
        'The .env changed during verification. Retry without editing it concurrently.',
      );
    await writeFile(environmentPath + '.tmp', lines.join('\n'), { mode: 0o600 });
    await rename(environmentPath + '.tmp', environmentPath);
    console.log(
      `Verified Sepolia suite and updated root .env. Administrator: ${administrator}. Restart the API and web app.`,
    );
  } finally {
    provider.destroy();
  }
}
main().catch((error) => {
  console.error(
    'Sepolia configuration was not changed. ' +
      (error instanceof ConfigurationError
        ? error.message
        : 'Deployment verification failed; check the RPC and completed Ignition deployment.'),
  );
  process.exitCode = 1;
});
