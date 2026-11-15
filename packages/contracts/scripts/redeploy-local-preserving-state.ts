/** Local development migration only. No private keys, IPFS uploads or state-patching RPCs. */
import { Contract, ContractFactory, JsonRpcProvider, type TransactionResponse } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = new URL('../../../', import.meta.url);
const envPath = fileURLToPath(new URL('.env', root));
const originalEnv = readFileSync(envPath, 'utf8');
const env = dotenv.parse(originalEnv);
const url = new URL(env.CHAIN_RPC_URL);
if (env.CHAIN_ID !== '31337' || !['127.0.0.1', 'localhost'].includes(url.hostname))
  throw new Error('This migration is restricted to an existing loopback chain 31337.');
const provider = new JsonRpcProvider(env.CHAIN_RPC_URL, 31337, {
  staticNetwork: true,
  cacheTimeout: -1,
});
if (
  BigInt(await provider.send('eth_chainId', [])) !== 31337n ||
  !String(await provider.send('web3_clientVersion', [])).startsWith('HardhatNetwork/')
)
  throw new Error('An existing local Hardhat chain is required. No network reset is performed.');

const modules = {
  StakeholderRegistry: ['access', 'STAKEHOLDER_REGISTRY_ADDRESS'],
  CredentialRegistry: ['credentials', 'CREDENTIAL_REGISTRY_ADDRESS'],
  EvidenceRegistry: ['traceability', 'EVIDENCE_REGISTRY_ADDRESS'],
  IngredientRegistry: ['traceability', 'INGREDIENT_REGISTRY_ADDRESS'],
  ProductRegistry: ['traceability', 'PRODUCT_REGISTRY_ADDRESS'],
  CustodyTransfer: ['traceability', 'CUSTODY_TRANSFER_ADDRESS'],
  SupplyChainOrders: ['traceability', 'SUPPLY_ORDERS_ADDRESS'],
  IngredientDelivery: ['traceability', ''],
} as const;
type Name = keyof typeof modules;
const names = Object.keys(modules) as Name[];
const artifact = (name: Name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../artifacts/contracts/${modules[name][0]}/${name}.sol/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
const old = {} as Record<Name, Contract>;
const beforeAddresses = {} as Record<Name, string>;
for (const name of names.filter((n) => n !== 'IngredientDelivery')) {
  const address = env[modules[name][1]];
  if (!address || (await provider.getCode(address)) === '0x')
    throw new Error(`Missing deployed ${name}.`);
  beforeAddresses[name] = address;
  old[name] = new Contract(address, artifact(name).abi, provider);
}
beforeAddresses.IngredientDelivery = await old.SupplyChainOrders.ingredientDelivery();
old.IngredientDelivery = new Contract(
  beforeAddresses.IngredientDelivery,
  artifact('IngredientDelivery').abi,
  provider,
);
const administrator: string = await old.StakeholderRegistry.administrator();
const unlocked = new Set(
  ((await provider.send('eth_accounts', [])) as string[]).map((a) => a.toLowerCase()),
);
if (!unlocked.has(administrator.toLowerCase()))
  throw new Error('The existing Admin is not a local unlocked account.');
const endBlock = await provider.getBlockNumber();
const logs = await provider.getLogs({
  address: Object.values(beforeAddresses),
  fromBlock: 0,
  toBlock: endBlock,
});
const addressName = new Map(names.map((n) => [beforeAddresses[n].toLowerCase(), n]));
const txs = new Map<string, TransactionResponse>();
for (const log of logs)
  if (!txs.has(log.transactionHash)) {
    const tx = await provider.getTransaction(log.transactionHash);
    if (tx?.to && addressName.has(tx.to.toLowerCase())) txs.set(tx.hash, tx);
  }
const allowed: Partial<Record<Name, string[]>> = {
  StakeholderRegistry: ['submitApplication', 'approveApplication'],
  CredentialRegistry: ['registerCredential'],
  IngredientRegistry: ['registerBatch'],
  SupplyChainOrders: ['registerLocation', 'requestIngredientDelivery', 'approveIngredientDelivery'],
  IngredientDelivery: [
    'registerWarehouse',
    'dispatchToWarehouse',
    'decideWarehouseShipment',
    'receiveRoadShipmentWithVehicle',
  ],
};
type Replay = { module: Name; transaction: TransactionResponse; method: string };
const replay: Replay[] = [];
const skippedProofs: string[] = [];
for (const tx of [...txs.values()].sort(
  (a, b) => a.blockNumber! - b.blockNumber! || a.index - b.index,
)) {
  const name = addressName.get(tx.to!.toLowerCase())!;
  const decoded = old[name].interface.parseTransaction({ data: tx.data });
  if (!decoded) throw new Error('An original transaction cannot be decoded.');
  if (decoded.name.startsWith('configure')) continue; // Fresh suite is wired separately.
  if (
    name === 'IngredientDelivery' &&
    decoded.name === 'act' &&
    [4, 5].includes(Number(decoded.args[0]))
  ) {
    const shipment = await old.IngredientDelivery.getRoadShipment(decoded.args[2]);
    if (Number(shipment.leg) !== 1 || Number(shipment.status) !== 3)
      throw new Error('An unfinished delivery proof needs an explicit migration plan.');
    skippedProofs.push(tx.hash); // Historical proof stays on old chain records, never fabricated anew.
    continue;
  }
  if (
    !allowed[name]?.includes(decoded.name) ||
    !unlocked.has(tx.from.toLowerCase()) ||
    tx.value !== 0n
  )
    throw new Error(
      `Unsupported source activity ${name}.${decoded.name}; migration stopped before writes.`,
    );
  replay.push({ module: name, transaction: tx, method: decoded.name });
}

type Check = { module: Name; method: string; args: unknown[]; omit: string[]; expected?: unknown };
const checks: Check[] = [];
const add = (module: Name, method: string, args: unknown[], omit: string[] = []) =>
  checks.push({ module, method, args, omit });
add('StakeholderRegistry', 'administrator', []);
const parties = new Set([administrator]);
for (const entry of replay) {
  const d = old[entry.module].interface.parseTransaction({ data: entry.transaction.data })!;
  if (entry.method === 'submitApplication') {
    parties.add(entry.transaction.from);
    add('StakeholderRegistry', 'getApplication', [d.args[0]], ['submittedAt', 'updatedAt']);
  }
  if (entry.method === 'registerCredential')
    add('CredentialRegistry', 'getCredential', [d.args[0]], ['issuedAt', 'updatedAt']);
  if (entry.method === 'registerBatch') add('IngredientRegistry', 'getBatch', [d.args[0]]);
  if (entry.method === 'registerLocation') add('SupplyChainOrders', 'locationOwner', [d.args[0]]);
  if (entry.method === 'registerWarehouse') add('IngredientDelivery', 'warehouses', [d.args[0]]);
  if (entry.method === 'requestIngredientDelivery') {
    add('SupplyChainOrders', 'getOrder', [d.args[0]]);
    add('SupplyChainOrders', 'requestDecision', [d.args[0]], ['recordedAt']);
    add('SupplyChainOrders', 'requestedBatch', [d.args[0]]);
  }
}
for (const wallet of parties) add('StakeholderRegistry', 'getStakeholder', [wallet], ['updatedAt']);
for (const event of await old.IngredientDelivery.queryFilter(
  old.IngredientDelivery.filters.CustodyPositionCreated(),
  0,
  endBlock,
)) {
  const positionId = old.IngredientDelivery.interface.parseLog(event)!.args[0];
  add('IngredientDelivery', 'getPosition', [positionId]);
}
for (const event of await old.IngredientDelivery.queryFilter(
  old.IngredientDelivery.filters.RoadShipmentDispatched(),
  0,
  endBlock,
)) {
  const shipmentId = old.IngredientDelivery.interface.parseLog(event)!.args[0];
  add('IngredientDelivery', 'getRoadShipment', [shipmentId], ['recordedAt']);
}
function normalize(value: any, omit: string[]): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value.toObject === 'function') {
    try {
      return normalize(value.toObject(true), omit);
    } catch {
      return Array.from(value, (v) => normalize(v, omit));
    }
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v, omit));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !omit.includes(k))
        .map(([k, v]) => [k, normalize(v, omit)]),
    );
  return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value;
}
for (const check of checks)
  check.expected = normalize(
    await old[check.module].getFunction(check.method)(...check.args),
    check.omit,
  );
console.log(
  JSON.stringify(
    {
      chainId: 31337,
      sourceBlock: endBlock,
      administrator,
      companies: parties.size,
      ingredientChecks: checks.filter((c) => c.method === 'getBatch').length,
      custodyPositions: checks.filter((c) => c.method === 'getPosition').length,
      transactions: replay.length,
      historicalProofsNotReattested: skippedProofs.length,
      stateChecks: checks.length,
      apply: process.env.TRACECHAIN_REDEPLOY_APPLY === '1',
    },
    null,
    2,
  ),
);
if (process.env.TRACECHAIN_REDEPLOY_APPLY !== '1') process.exit(0);
if ((await provider.getBlockNumber()) !== endBlock)
  throw new Error('Source chain changed during preparation. Retry with the app idle.');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = new URL(`.tracechain/migrations/${stamp}/`, root);
mkdirSync(backupDirectory, { recursive: true });
const manifestPath = new URL('manifest.json', backupDirectory);
const manifest: any = {
  chainId: 31337,
  sourceBlock: endBlock,
  beforeAddresses,
  administrator,
  snapshots: checks,
  historicalProofsNotReattested: skippedProofs,
  status: 'PREPARED',
  afterAddresses: {},
};
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
save();
const signer = await provider.getSigner(administrator);
const current = {} as Record<Name, Contract>;
const addresses = {} as Record<Name, string>;
async function deploy(name: Name, args: unknown[]) {
  const a = artifact(name);
  const deployed = await new ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
  await deployed.waitForDeployment();
  addresses[name] = await deployed.getAddress();
  current[name] = new Contract(addresses[name], a.abi, signer);
  manifest.afterAddresses = { ...addresses };
  save();
  console.log(`Deployed ${name}: ${addresses[name]}`);
}
async function wire(name: Name, method: string, target: string) {
  await (await current[name].getFunction(method)(target)).wait();
}
try {
  await deploy('StakeholderRegistry', [administrator]);
  await deploy('CredentialRegistry', [addresses.StakeholderRegistry]);
  await wire('StakeholderRegistry', 'configureCredentialRegistry', addresses.CredentialRegistry);
  await deploy('EvidenceRegistry', [addresses.StakeholderRegistry, addresses.CredentialRegistry]);
  await deploy('IngredientRegistry', [addresses.StakeholderRegistry, addresses.CredentialRegistry]);
  await wire('EvidenceRegistry', 'configureIngredientRegistry', addresses.IngredientRegistry);
  await deploy('ProductRegistry', [
    addresses.StakeholderRegistry,
    addresses.IngredientRegistry,
    addresses.EvidenceRegistry,
  ]);
  await wire('IngredientRegistry', 'configureProductRegistry', addresses.ProductRegistry);
  await deploy('CustodyTransfer', [addresses.StakeholderRegistry, addresses.ProductRegistry]);
  await deploy('SupplyChainOrders', [
    addresses.StakeholderRegistry,
    addresses.IngredientRegistry,
    addresses.ProductRegistry,
    addresses.EvidenceRegistry,
    addresses.CustodyTransfer,
  ]);
  await wire('IngredientRegistry', 'configureSupplyOrders', addresses.SupplyChainOrders);
  await wire('CustodyTransfer', 'configureSupplyOrders', addresses.SupplyChainOrders);
  addresses.IngredientDelivery = await current.SupplyChainOrders.ingredientDelivery();
  current.IngredientDelivery = new Contract(
    addresses.IngredientDelivery,
    artifact('IngredientDelivery').abi,
    signer,
  );
  if ((await current.IngredientDelivery.fulfilmentPolicy()) !== 2n)
    throw new Error('Wrong delivery build.');
  for (const entry of replay) {
    const actor = await provider.getSigner(entry.transaction.from);
    const tx = await actor.sendTransaction({
      to: addresses[entry.module],
      data: entry.transaction.data,
      value: 0,
    });
    await tx.wait();
    console.log(`Restored ${entry.module}.${entry.method}`);
  }
  for (const check of checks) {
    const result = normalize(
      await current[check.module].getFunction(check.method)(...check.args),
      check.omit,
    );
    if (JSON.stringify(result) !== JSON.stringify(check.expected))
      throw new Error(`State mismatch: ${check.module}.${check.method}`);
  }
  for (const wallet of parties) {
    const r = await current.StakeholderRegistry.getStakeholder(wallet);
    if (!(await current.StakeholderRegistry.isAuthorized(wallet, r.role)))
      throw new Error('A restored account is not authorized.');
  }
  if (readFileSync(envPath, 'utf8') !== originalEnv)
    throw new Error('The environment changed concurrently; no environment update performed.');
  let updated = originalEnv;
  for (const name of names.filter((n) => n !== 'IngredientDelivery')) {
    const key = modules[name][1];
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (!pattern.test(updated)) throw new Error(`Environment key ${key} is missing.`);
    updated = updated.replace(pattern, `${key}=${addresses[name]}`);
  }
  manifest.status = 'VERIFIED';
  manifest.afterAddresses = addresses;
  save();
  writeFileSync(envPath, updated);
  manifest.status = 'ENV_UPDATED';
  save();
  console.log(
    `Verified ${checks.length} state comparisons and ${parties.size} authorized accounts. Root environment updated.`,
  );
  console.log(
    'Old deployments, encrypted records and credentials remain intact. Restart the API/web processes.',
  );
} catch (error) {
  manifest.status = 'FAILED';
  save();
  // Old contracts are never modified. Do not reset/revert a shared running chain on failure.
  console.error(
    'Migration stopped. Old contracts remain intact. Check the local manifest; no secret details are logged.',
  );
  console.error(
    error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'Migration failure',
  );
  process.exitCode = 1;
}
