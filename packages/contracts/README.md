# TraceChain smart contracts

This workspace contains the authoritative on-chain rules for TraceChain. It uses Hardhat 3, Solidity 0.8.34, ethers, Mocha, and Hardhat Ignition.

This document describes the contracts as currently implemented. It is also a verification checklist: compare every workflow below with the Solidity source and the integration test in `test/TraceChain.ts` before deploying to a persistent network.

## Security and storage boundary

Ethereum stores public, permanent data. TraceChain therefore records only identifiers, hashes, content references, roles, statuses, timestamps, quantities, and relationships.

Never put any of the following on-chain:

- Wallet private keys or seed phrases.
- Plaintext credentials.
- Plaintext company documents or identity evidence.
- Encryption keys.
- Confidential business records.

Sensitive content must be encrypted before IPFS upload. A CID is an integrity/location reference, not access control. Hashes prove that content has not changed but do not hide predictable plaintext.

## Contract map

| Contract              | Responsibility                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `StakeholderRegistry` | Company applications, wallet roles, stakeholder lifecycle, role changes, wallet recovery, and administrator transfer |
| `CredentialRegistry`  | Credential hash/CID references, type, issuer, subject, expiry, suspension, reactivation, and revocation              |
| `EvidenceRegistry`    | Ingredient-evidence requests, challenge consumption, supplier presentations, and requester acceptance                |
| `IngredientRegistry`  | Supplier ingredient batches, credential references, quantities, lifecycle, and ingredient consumption                |
| `ProductRegistry`     | Manufacturer product batches and immutable product-to-ingredient quantity links                                      |
| `CustodyTransfer`     | Manufacturer/distributor/retailer inventory, intended transfers, receipts, rejection, and discrepancies              |

All role-restricted contracts ask `StakeholderRegistry` for the caller's current authorized role. A role becomes ineffective when the stakeholder or required credential is inactive or expired.

## Deployment and wiring

Deploy the complete suite through `ignition/modules/TraceChain.ts`. The module performs these operations in dependency order:

1. Deploy `StakeholderRegistry(account[0])`.
2. Deploy `CredentialRegistry(stakeholderRegistry)`.
3. Call `StakeholderRegistry.configureCredentialRegistry(credentialRegistry)` once.
4. Deploy `EvidenceRegistry(stakeholderRegistry, credentialRegistry)`.
5. Deploy `IngredientRegistry(stakeholderRegistry, credentialRegistry)`.
6. Deploy `ProductRegistry(stakeholderRegistry, ingredientRegistry, evidenceRegistry)`.
7. Call `IngredientRegistry.configureProductRegistry(productRegistry)` once.
8. Deploy `CustodyTransfer(stakeholderRegistry, productRegistry)`.

The deployer becomes the active `SystemAdmin`. The bootstrap administrator is a special case and has no credential hash in the constructor-created record.

### Local deployment

Terminal 1:

```powershell
cd packages/contracts
npx hardhat node --chain-id 31337
```

Terminal 2:

```powershell
cd packages/contracts
npx hardhat ignition deploy ignition/modules/TraceChain.ts `
  --network localhost `
  --deployment-id tracechain-local `
  --reset
```

Addresses are written to `ignition/deployments/tracechain-local/deployed_addresses.json`. The local chain is erased when the node stops. Hardhat development keys are public test keys; never fund or reuse them on Sepolia or mainnet.

After copying the deployed addresses into the ignored root `.env`, set
`DEV_DISTRIBUTOR_WALLET` to an unlocked Hardhat account that has already completed normal
Distributor onboarding and credential registration. From the repository root, create one real
pending transfer with:

```powershell
npm run dev:seed-custody-transfer
```

The command reuses this deployment, refuses non-31337 networks, creates the minimum Supplier and
Manufacturer test records with unlocked development accounts, and prints the transfer ID plus its
canonical QR payload. It does not deploy contracts, handle private keys, or fabricate the
Distributor's off-chain credential.

### Tests

```powershell
npx hardhat test test/TraceChain.ts
npm run typecheck
```

The Solidity compiler uses the optimizer with 200 runs and `viaIR: true` in both build profiles.

## Numeric enum values

Frontend/API calls must use the exact Solidity enum numbers.

### Stakeholder roles

| Value | Role         |
| ----: | ------------ |
|     0 | None         |
|     1 | SystemAdmin  |
|     2 | Supplier     |
|     3 | Manufacturer |
|     4 | Distributor  |
|     5 | Retailer     |

### Stakeholder lifecycle

| Value | Status    |
| ----: | --------- |
|     0 | None      |
|     1 | Active    |
|     2 | Suspended |
|     3 | Revoked   |

### Application status

| Value | Status                     |
| ----: | -------------------------- |
|     0 | None                       |
|     1 | Pending                    |
|     2 | AdditionalEvidenceRequired |
|     3 | Approved                   |
|     4 | Rejected                   |
|     5 | Withdrawn                  |

### Credential type and status

Credential types are `None=0`, `CompanyRole=1`, `Ingredient=2`, and `EvidencePresentation=3`.

Credential statuses are `None=0`, `Active=1`, `Suspended=2`, and `Revoked=3`.

## End-to-end process

`StakeholderRegistry` stores configurable operational permissions for Supplier, Manufacturer, Distributor, and Retailer roles. Only the System Admin can grant or remove them. Updates emit `RolePermissionChanged` and take effect immediately in credential, evidence, ingredient, product, and custody operations. System Admin authority and valid Manufacturer-to-Distributor-to-Retailer custody routes remain structural constraints.

This permission registry changes contract bytecode, so existing local or Sepolia deployments must be redeployed before the Access Control matrix can read or update permissions.

### 1. Company application

Actor: an unregistered wallet requesting Supplier, Manufacturer, Distributor, or Retailer.

1. Encrypt the company profile and supporting documents off-chain.
2. Generate a unique `applicationId` (`bytes32`).
3. Calculate `profileHash` over the canonical profile content.
4. Upload encrypted content and obtain `encryptedProfileCid`.
5. Call:

```solidity
submitApplication(
  applicationId,
  profileHash,
  encryptedProfileCid,
  requestedRole,
  bytes32(0)
)
```

Requirements:

- IDs and profile hash must be nonzero.
- Requested role must be 2 through 5.
- The application ID must be unused.
- An active stakeholder cannot submit another application.
- For resubmission after rejection, `previousApplicationId` must belong to the same wallet and be `Rejected`.

Possible transitions:

```text
Pending ──> AdditionalEvidenceRequired ──> Pending
   │                                           │
   ├──> Approved                               ├──> Approved
   ├──> Rejected                               ├──> Rejected
   └──> Withdrawn                              └──> Withdrawn
```

The administrator may request additional evidence with a nonzero request hash and optional encrypted request CID. Only the applicant may resubmit evidence or withdraw.

Applications are enumerable through `applicationCount()` and paginated `getApplicationIds(offset, limit)`.

### 2. Approval and Company Role Credential registration

Actor: System Admin.

The off-chain authority must first issue and cryptographically verify a Company Role Credential. Then execute the on-chain operations in this order:

1. Call `StakeholderRegistry.approveApplication(applicationId, credentialHash, encryptedCredentialCid, expiresAt)`.
2. Call `CredentialRegistry.registerCredential(credentialId, credentialHash, encryptedCredentialCid, applicantWallet, CompanyRole, expiresAt)`.

Approval creates an active stakeholder, but a non-admin wallet does not receive an effective role from `roleOf()` until the matching Company Role Credential is registered and valid.

Verification path used by `StakeholderRegistry.roleOf(wallet)`:

1. Stakeholder status is `Active`.
2. Stakeholder credential has not expired.
3. Credential hash maps to a credential ID.
4. Credential subject equals the wallet.
5. Credential type is `CompanyRole`.
6. `CredentialRegistry.isCredentialValid` returns true.

The bootstrap administrator bypasses credential lookup only when `wallet == administrator` and its stakeholder record is active.

### 3. Credential lifecycle

Issuers:

- Only System Admin can register Company Role Credentials.
- Only an authorized Supplier can register Ingredient or Evidence Presentation credentials.

Management:

- System Admin can manage every credential.
- A Supplier issuer can manage its non-company credentials.
- An admin-suspended credential can only be reactivated by an authorized admin.
- Revocation is terminal in the current implementation.
- Expired credentials fail `isCredentialValid`; `effectiveStatus` reports an expired active credential as `Revoked` without mutating storage.

Company Role Credential validity also requires the subject stakeholder to remain active and its current stakeholder credential hash to equal the credential record hash.

### 4. Stakeholder suspension, revocation, role change, and wallet recovery

System Admin can:

- Suspend an active non-admin stakeholder.
- Reactivate a suspended stakeholder only while its credential reference is unexpired.
- Revoke a non-admin stakeholder. Revocation clears its role and is terminal.
- Replace a non-admin wallet after independent recovery checks.
- Update a stakeholder credential reference.

Role changes use a reviewed request:

1. Active non-admin stakeholder calls `submitRoleChange` with requested role and encrypted evidence reference.
2. Admin either calls `rejectRoleChange` with a reason hash or `approveRoleChange` with a replacement credential reference.
3. After approval, register the matching replacement Company Role Credential in `CredentialRegistry` before expecting the new role to authorize calls.

Wallet replacement revokes the old wallet record and creates an active record for the new wallet. The matching new credential must also be registered in `CredentialRegistry`.

Administrator transfer is two-step:

1. Current admin calls `beginAdministratorTransfer(newWallet)`.
2. The proposed wallet calls `acceptAdministratorTransfer()`.

The current admin may cancel before acceptance. Acceptance revokes the previous admin record and creates the new bootstrap-style admin record.

### 5. Ingredient Credential and batch registration

Actors: authorized Supplier and System Admin/Supplier credential issuer.

1. Issue an Ingredient Credential off-chain.
2. Supplier calls `CredentialRegistry.registerCredential` with type `Ingredient` and subject equal to the Supplier wallet.
3. Supplier calls `IngredientRegistry.registerBatch` with:
   - Unique batch ID.
   - Metadata hash and encrypted CID.
   - Active Ingredient Credential ID.
   - Positive quantity and nonzero unit.
   - Production time not in the future.
   - Expiry time in the future.

Registration sets `availableQuantity = totalQuantity` and status `Active`.

A batch is usable only while:

- Status is Active.
- Batch is unexpired.
- Available quantity is greater than zero.
- Supplier remains authorized as Supplier.
- Ingredient Credential remains valid.

Only the configured `ProductRegistry` can consume quantity. The Supplier or System Admin can suspend or recall a batch; recall is terminal.

### 6. Ingredient evidence exchange

Requester: authorized Manufacturer or Retailer. Responder: the selected authorized Supplier.

1. Requester creates a unique challenge off-chain.
2. Requester calls `requestEvidence` with request ID, Supplier, ingredient batch ID, claims hash, challenge hash, encrypted request CID, and future due time.
3. Supplier builds a selective presentation bound to the challenge.
4. Before the due time, Supplier calls `respond` with presentation hash, encrypted presentation CID, and future expiry.
5. The challenge is permanently marked consumed.
6. Requester verifies the presentation off-chain.
7. Requester calls `accept(requestId, ingredientCredentialId)` while the presentation and credential are valid.

Acceptance records `acceptedForManufacturer[ingredientBatchId][requester] = true`. Either participant may close an open request as Declined, Rejected, or Cancelled.

### 7. Product creation

Actor: authorized Manufacturer.

The Manufacturer calls `ProductRegistry.createProduct` with product metadata, quantity, unit, production/expiry times, ingredient batch IDs, and quantities.

For every ingredient link:

- Ingredient must be usable.
- Evidence must have been accepted for this Manufacturer and ingredient batch.
- Quantity must be positive and available.
- `IngredientRegistry.consumeIngredient` reduces available ingredient quantity.
- The product-to-ingredient link is permanently appended.

Product status starts Active. The Manufacturer or System Admin can suspend or recall it; recall is terminal.

A product is transferable only while the product is active and unexpired, the Manufacturer remains authorized, and every linked ingredient remains usable.

### 8. Custody transfer and inventory

Allowed routes are fixed:

```text
Manufacturer (3) ──> Distributor (4) ──> Retailer (5)
```

No other sender/recipient role combination is accepted.

On the first transfer for a product batch, the contract initializes the Manufacturer's available inventory to the product's total quantity.

Creating a transfer:

1. Sender calls `createTransfer` with unique transfer ID, product batch ID, intended recipient, quantity, expected time, shipment hash, and shipment CID.
2. Product must be transferable.
3. Sender must have enough available inventory.
4. Quantity moves from sender `available` to sender `reserved`.
5. Transfer status becomes `AwaitingReceipt`.

While awaiting receipt:

- Sender may cancel; reserved quantity returns to available.
- Intended recipient may reject; reserved quantity returns to sender available.
- Intended recipient may report a discrepancy when actual quantity differs from expected.

Only System Admin resolves a discrepancy:

- Reject actual quantity: release reservation and cancel transfer.
- Accept actual quantity: adjust sender available/reserved, update transfer quantity, and return to `AwaitingReceipt`.

Receipt confirmation:

1. Only the exact intended recipient can call `confirmReceipt`.
2. Recipient must still have a nonzero authorized role.
3. `totalReceived` must equal transfer quantity.
4. `damaged + rejected <= totalReceived`.
5. Receipt hash must be nonzero.
6. Sender reservation is removed.
7. Recipient inventory is divided into `available`, `damaged`, and `rejected`.
8. Transfer status becomes `Received`; it cannot be confirmed twice.

## State that is not enumerable

Applications and role-change request IDs have paginated enumeration. The current contracts do not maintain enumerable ID arrays for credentials, ingredients, products, evidence requests, or custody transfers. Consumers must know their IDs or index emitted events. A production UI normally needs an event indexer or additional paginated registries.

## Events and audit trail

Every authoritative write emits an event. Important event groups are:

- Application submission and status changes.
- Stakeholder registration, status, role, credential reference, wallet replacement, and admin transfer.
- Credential registration, status, and CID reference changes.
- Evidence request, response, and final status.
- Ingredient registration, consumption, and lifecycle.
- Product creation, ingredient links, and lifecycle.
- Inventory initialization, transfer creation/status, receipt, and discrepancy.

Events are public and should be indexed by transaction hash, block number, log index, and contract address.

## Verification checklist and known limitations

Review these points before Sepolia deployment:

- **Approval is a two-transaction workflow.** If application approval succeeds but credential registration fails, the stakeholder exists but has no effective role until registration is completed.
- **Role change and wallet replacement also require subsequent credential registration.** The registry reference alone does not create a CredentialRegistry record.
- **Evidence acceptance does not prove that the supplied credential ID belongs to the requested ingredient batch or Supplier.** It only checks that the credential is currently valid. Add an explicit batch/credential binding before treating this as production-grade evidence authorization.
- **Full ingredient consumption affects product transferability.** `IngredientRegistry.isUsable` requires `availableQuantity > 0`, while `ProductRegistry.isTransferable` rechecks every linked ingredient. Consuming the final available unit can therefore make a newly created product non-transferable. This rule should be changed or explicitly confirmed.
- **Product creation loops over caller-provided ingredient arrays without a maximum count.** Transaction gas bounds the call, but an explicit maximum would make behavior predictable.
- **Evidence, ingredient, product, and transfer records are not enumerable on-chain.** Event indexing is required for complete lists.
- **No upgrade mechanism exists.** Contracts are immutable deployments; fixes require redeployment and migration unless an upgrade policy is intentionally introduced.
- **Reason hashes do not reveal reasons.** The corresponding plaintext must be retained securely off-chain if reviewers need it later.
- **CID strings are public.** They must reference encrypted content when confidentiality is required.
- **Administrator is a single wallet.** There is no multisignature or timelock in the current implementation.
- **Contract custody is not legal ownership.** The records describe TraceChain custody state only.

## Source layout

```text
contracts/
  access/StakeholderRegistry.sol
  credentials/CredentialRegistry.sol
  traceability/EvidenceRegistry.sol
  traceability/IngredientRegistry.sol
  traceability/ProductRegistry.sol
  traceability/CustodyTransfer.sol
  interfaces/
ignition/modules/TraceChain.ts
test/TraceChain.ts
hardhat.config.ts
```

Generated artifacts, compiler build information, caches, and Ignition journals are not contract source and should not be reviewed as the primary implementation.
