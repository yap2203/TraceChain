import { encodeTransferQrPayload } from '@tracechain/shared';
import dotenv from 'dotenv';
import {
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  ZeroHash,
  getAddress,
  id,
  encodeBytes32String,
} from 'ethers';
import { readFileSync } from 'node:fs';
import type { ContractRunner } from 'ethers';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const LOCAL_CHAIN_ID = 31_337;
const supplierRole = 2;
const manufacturerRole = 3;
const distributorRole = 4;

const stakeholderAbi = [
  'function administrator() view returns (address)',
  'function credentialRegistry() view returns (address)',
  'function roleOf(address) view returns (uint8)',
  'function getStakeholder(address) view returns (tuple(uint8 role,uint8 status,bytes32 credentialHash,string credentialCid,uint64 credentialExpiresAt,uint64 updatedAt))',
  'function submitApplication(bytes32,bytes32,string,uint8,bytes32)',
  'function approveApplication(bytes32,bytes32,string,uint64)',
] as const;
const credentialAbi = [
  'function registerCredential(bytes32,bytes32,string,address,uint8,uint64)',
] as const;
const custodyAbi = [
  'function stakeholders() view returns (address)',
  'function products() view returns (address)',
  'function createTransfer(bytes32,bytes32,address,uint256,uint64,bytes32,string)',
  'function getTransfer(bytes32) view returns (tuple(bytes32 productBatchId,address sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid,uint64 dispatchedAt,uint64 expectedAt,uint8 status,uint256 usable,uint256 damaged,uint256 rejected))',
] as const;
const productAbi = [
  'function stakeholders() view returns (address)',
  'function ingredients() view returns (address)',
  'function evidence() view returns (address)',
  'function createProduct(bytes32,bytes32,string,uint256,bytes32,uint64,uint64,bytes32[],uint256[])',
  'function createProductAt(bytes32,bytes32,string,uint256,bytes32,uint64,uint64,bytes32[],uint256[],bytes32)',
] as const;
const ingredientAbi = [
  'function stakeholders() view returns (address)',
  'function credentials() view returns (address)',
  'function registerBatch(bytes32,bytes32,string,bytes32,uint256,bytes32,uint64,uint64)',
  'function supplyOrders() view returns (address)',
] as const;
const evidenceAbi = [
  'function stakeholders() view returns (address)',
  'function credentials() view returns (address)',
  'function requestEvidence(bytes32,address,bytes32,bytes32,bytes32,string,uint64)',
  'function respond(bytes32,bytes32,string,uint64)',
  'function accept(bytes32,bytes32)',
] as const;

async function main() {
  const chainId = requiredInteger('CHAIN_ID');
  if (chainId !== LOCAL_CHAIN_ID) {
    throw new Error('Development custody-transfer seeding is permitted only on chain ID 31337.');
  }

  const provider = new JsonRpcProvider(required('CHAIN_RPC_URL'), chainId, {
    staticNetwork: true,
  });
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== LOCAL_CHAIN_ID) {
    throw new Error(`The configured RPC is on chain ${network.chainId}, not Hardhat chain 31337.`);
  }

  const stakeholderAddress = address('STAKEHOLDER_REGISTRY_ADDRESS');
  const credentialAddress = address('CREDENTIAL_REGISTRY_ADDRESS');
  const custodyAddress = address('CUSTODY_TRANSFER_ADDRESS');
  const distributor = address('DEV_DISTRIBUTOR_WALLET');
  await requireContracts(provider, [stakeholderAddress, credentialAddress, custodyAddress]);

  const unlockedAccounts = ((await provider.send('eth_accounts', [])) as string[]).map(getAddress);
  const unlocked = new Set(unlockedAccounts.map((account) => account.toLowerCase()));
  if (!unlocked.has(distributor.toLowerCase())) {
    throw new Error(
      'DEV_DISTRIBUTOR_WALLET must be an unlocked account exposed by the Hardhat RPC.',
    );
  }

  const stakeholders = new Contract(stakeholderAddress, stakeholderAbi, provider);
  const credentials = new Contract(credentialAddress, credentialAbi, provider);
  const custody = new Contract(custodyAddress, custodyAbi, provider);
  const administrator = getAddress(await stakeholders.administrator());
  if (!unlocked.has(administrator.toLowerCase())) {
    throw new Error('The deployed System Admin must be an unlocked Hardhat account.');
  }
  if (Number(await stakeholders.roleOf(distributor)) !== distributorRole) {
    throw new Error(
      'DEV_DISTRIBUTOR_WALLET must already have active on-chain Distributor authorization and a matching Company Role Credential.',
    );
  }

  const productAddress = getAddress(await custody.products());
  const product = new Contract(productAddress, productAbi, provider);
  const ingredientAddress = getAddress(await product.ingredients());
  const evidenceAddress = getAddress(await product.evidence());
  await requireContracts(provider, [productAddress, ingredientAddress, evidenceAddress]);
  const ingredients = new Contract(ingredientAddress, ingredientAbi, provider);
  const evidence = new Contract(evidenceAddress, evidenceAbi, provider);
  await verifyDeploymentLinks({
    credentialAddress,
    custody,
    evidence,
    ingredients,
    product,
    stakeholderAddress,
    stakeholders,
  });

  const run = `${Date.now()}:${await provider.getBlockNumber()}`;
  const excluded = new Set([administrator.toLowerCase(), distributor.toLowerCase()]);
  const supplier = await findOrCreateActor({
    administrator,
    credentials,
    excluded,
    provider,
    role: supplierRole,
    run,
    stakeholders,
    unlockedAccounts,
  });
  excluded.add(supplier.toLowerCase());
  const manufacturer = await findOrCreateActor({
    administrator,
    credentials,
    excluded,
    provider,
    role: manufacturerRole,
    run,
    stakeholders,
    unlockedAccounts,
  });

  const latest = await provider.getBlock('latest');
  if (!latest) throw new Error('The latest Hardhat block could not be read.');
  const now = latest.timestamp;
  const supplierSigner = await provider.getSigner(supplier);
  const manufacturerSigner = await provider.getSigner(manufacturer);
  const ingredientCredentialId = id(`tracechain:dev:ingredient-credential:${run}`);
  const ingredientBatchId = id(`tracechain:dev:ingredient-batch:${run}`);
  const evidenceRequestId = id(`tracechain:dev:evidence-request:${run}`);
  const productBatchId = id(`tracechain:dev:product-batch:${run}`);
  const transferId = id(`tracechain:dev:custody-transfer:${run}`);

  await wait(
    connected(credentials, supplierSigner).registerCredential(
      ingredientCredentialId,
      id(`tracechain:dev:ingredient-credential-hash:${run}`),
      'local-dev://ingredient-credential',
      supplier,
      2,
      now + 86_400,
    ),
  );
  await wait(
    connected(ingredients, supplierSigner).registerBatch(
      ingredientBatchId,
      id(`tracechain:dev:ingredient-metadata:${run}`),
      'local-dev://ingredient-batch',
      ingredientCredentialId,
      100, // Change from 50
      encodeBytes32String('g'),
      now,
      now + 86_400,
    ),
  );
  await wait(
    connected(evidence, manufacturerSigner).requestEvidence(
      evidenceRequestId,
      supplier,
      ingredientBatchId,
      id(`tracechain:dev:claims:${run}`),
      id(`tracechain:dev:challenge:${run}`),
      'local-dev://evidence-request',
      now + 3_600,
    ),
  );
  await wait(
    connected(evidence, supplierSigner).respond(
      evidenceRequestId,
      id(`tracechain:dev:presentation:${run}`),
      'local-dev://evidence-presentation',
      now + 1_800,
    ),
  );
  await wait(
    connected(evidence, manufacturerSigner).accept(evidenceRequestId, ingredientCredentialId),
  );
  let supplyOrdersAddress = ZeroAddress;
  try {
    supplyOrdersAddress = getAddress(await ingredients.supplyOrders());
  } catch (error) {
    if (
      (error as { code?: string; data?: string }).code !== 'CALL_EXCEPTION' ||
      (error as { data?: string }).data !== '0x'
    )
      throw error;
  }
  const productionLocation = id(`tracechain:dev:production-location:${run}`);
  if (supplyOrdersAddress !== ZeroAddress) {
    const artifact = JSON.parse(
      readFileSync(
        new URL(
          '../artifacts/contracts/traceability/SupplyChainOrders.sol/SupplyChainOrders.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const orders = new Contract(supplyOrdersAddress, artifact.abi, provider);
    const sourceLocation = id(`tracechain:dev:source-location:${run}`),
      itemId = id(`tracechain:dev:item:${run}`),
      orderId = id(`tracechain:dev:order:${run}`),
      deliveryId = id(`tracechain:dev:ingredient-delivery:${run}`);
    await wait(
      connected(orders, supplierSigner).registerLocation(
        sourceLocation,
        id('local-dev:source-location'),
      ),
    );
    await wait(
      connected(orders, manufacturerSigner).registerLocation(
        productionLocation,
        id('local-dev:production-location'),
      ),
    );
    await wait(
      connected(orders, supplierSigner).listItem(
        itemId,
        'Local custody-test ingredient',
        1,
        ingredientBatchId,
        id('local-dev:item'),
      ),
    );
    await wait(
      connected(orders, manufacturerSigner).requestOrder(
        orderId,
        itemId,
        50,
        encodeBytes32String('g'),
        productionLocation,
        now + 3600,
        false,
        id('local-dev:order'),
        'local-dev://order',
      ),
    );
    await wait(
      connected(orders, supplierSigner).propose(orderId, ingredientBatchId, sourceLocation),
    );
    await wait(connected(orders, supplierSigner).allocate(orderId, 50));
    const dispatched = (await provider.getBlock('latest'))!.timestamp;
    await wait(
      connected(orders, supplierSigner).dispatch(
        orderId,
        deliveryId,
        50,
        dispatched,
        ZeroAddress,
        ZeroHash,
        now + 3600,
        id('local-dev:delivery'),
        'local-dev://delivery',
      ),
    );
    await wait(
      connected(orders, manufacturerSigner).receiveIngredient(
        deliveryId,
        50,
        0,
        0,
        0,
        (await provider.getBlock('latest'))!.timestamp,
      ),
    );
  }
  const productMethod = supplyOrdersAddress === ZeroAddress ? 'createProduct' : 'createProductAt';
  await wait(
    connected(product, manufacturerSigner).getFunction(productMethod)(
      productBatchId,
      id(`tracechain:dev:product-metadata:${run}`),
      'local-dev://product',
      50,
      encodeBytes32String('each'),
      now,
      now + 86_400,
      [ingredientBatchId],
      [50],
      ...(supplyOrdersAddress === ZeroAddress ? [] : [productionLocation]),
    ),
  );
  await wait(
    connected(custody, manufacturerSigner).createTransfer(
      transferId,
      productBatchId,
      distributor,
      20,
      now + 3_600,
      id(`tracechain:dev:shipment:${run}`),
      'local-dev://shipment',
    ),
  );

  const transfer = await custody.getTransfer(transferId);
  if (Number(transfer.status) !== 1 || getAddress(transfer.recipient) !== distributor) {
    throw new Error('The seeded transfer did not reach AwaitingReceipt for the Distributor.');
  }
  const qrPayload = encodeTransferQrPayload({
    chainId,
    custodyTransferAddress: custodyAddress,
    publicAppUrl: required('VITE_PUBLIC_APP_URL'),
    transferId: transferId as `0x${string}`,
    version: 1,
  });

  console.log(`Transfer ID: ${transferId}`);
  console.log(`Distributor: ${distributor}`);
  console.log(`QR payload: ${qrPayload}`);
}

interface ActorInput {
  administrator: string;
  credentials: Contract;
  excluded: Set<string>;
  provider: JsonRpcProvider;
  role: number;
  run: string;
  stakeholders: Contract;
  unlockedAccounts: string[];
}

async function findOrCreateActor(input: ActorInput) {
  for (const account of input.unlockedAccounts) {
    if (
      !input.excluded.has(account.toLowerCase()) &&
      Number(await input.stakeholders.roleOf(account)) === input.role
    ) {
      return account;
    }
  }

  for (const account of input.unlockedAccounts) {
    if (input.excluded.has(account.toLowerCase())) continue;
    const stakeholder = await input.stakeholders.getStakeholder(account);
    if (Number(stakeholder.status) !== 0) continue;

    const signer = await input.provider.getSigner(account);
    const adminSigner = await input.provider.getSigner(input.administrator);
    const applicationId = id(`tracechain:dev:application:${input.role}:${account}:${input.run}`);
    const credentialHash = id(
      `tracechain:dev:company-credential-hash:${input.role}:${account}:${input.run}`,
    );
    const credentialId = id(
      `tracechain:dev:company-credential-id:${input.role}:${account}:${input.run}`,
    );
    const latest = await input.provider.getBlock('latest');
    if (!latest) throw new Error('The latest Hardhat block could not be read.');
    const expiry = latest.timestamp + 86_400;
    await wait(
      connected(input.stakeholders, signer).submitApplication(
        applicationId,
        id(`tracechain:dev:profile:${account}:${input.run}`),
        'local-dev://company-profile',
        input.role,
        ZeroHash,
      ),
    );
    await wait(
      connected(input.stakeholders, adminSigner).approveApplication(
        applicationId,
        credentialHash,
        'local-dev://company-role-credential',
        expiry,
      ),
    );
    await wait(
      connected(input.credentials, adminSigner).registerCredential(
        credentialId,
        credentialHash,
        'local-dev://company-role-credential',
        account,
        1,
        expiry,
      ),
    );
    if (Number(await input.stakeholders.roleOf(account)) !== input.role) {
      throw new Error(`The development role ${input.role} could not be activated.`);
    }
    return account;
  }
  throw new Error(`No unused unlocked Hardhat account is available for role ${input.role}.`);
}

async function verifyDeploymentLinks(input: {
  credentialAddress: string;
  custody: Contract;
  evidence: Contract;
  ingredients: Contract;
  product: Contract;
  stakeholderAddress: string;
  stakeholders: Contract;
}) {
  const expectedStakeholders = input.stakeholderAddress.toLowerCase();
  const links = [
    await input.custody.stakeholders(),
    await input.product.stakeholders(),
    await input.ingredients.stakeholders(),
    await input.evidence.stakeholders(),
  ].map((value) => getAddress(value).toLowerCase());
  if (links.some((value) => value !== expectedStakeholders)) {
    throw new Error(
      'The configured contracts do not belong to the same StakeholderRegistry deployment.',
    );
  }
  const credentialLinks = [
    await input.stakeholders.credentialRegistry(),
    await input.ingredients.credentials(),
    await input.evidence.credentials(),
  ].map((value) => getAddress(value).toLowerCase());
  if (credentialLinks.some((value) => value !== input.credentialAddress.toLowerCase())) {
    throw new Error(
      'The configured contracts do not belong to the same CredentialRegistry deployment.',
    );
  }
}

async function requireContracts(provider: JsonRpcProvider, addresses: string[]) {
  for (const contractAddress of addresses) {
    if ((await provider.getCode(contractAddress)) === '0x') {
      throw new Error(`No contract is deployed at configured address ${contractAddress}.`);
    }
  }
}

async function wait(transaction: Promise<{ wait(): Promise<unknown> }>) {
  await (await transaction).wait();
}

function connected(contract: Contract, runner: ContractRunner) {
  return contract.connect(runner) as Contract;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in the root .env file.`);
  return value;
}

function requiredInteger(name: string) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}

function address(name: string) {
  const value = getAddress(required(name));
  if (value === ZeroAddress) throw new Error(`${name} cannot be the zero address.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'The development transfer could not be seeded.',
  );
  process.exitCode = 1;
});
