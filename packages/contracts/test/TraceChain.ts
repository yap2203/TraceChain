import { expect } from 'chai';
import type { BaseContract, ContractRunner } from 'ethers';
import { network } from 'hardhat';

const { ethers, networkHelpers } = await network.create();

function asSigner<T extends BaseContract>(contract: T, signer: ContractRunner): T {
  return contract.connect(signer) as unknown as T;
}

describe('TraceChain integration', function () {
  async function deployFixture() {
    const [admin, supplier, manufacturer, distributor, retailer, stranger] =
      await ethers.getSigners();
    const stakeholders = await ethers.deployContract('StakeholderRegistry', [admin.address]);
    const credentials = await ethers.deployContract('CredentialRegistry', [stakeholders]);
    await stakeholders.configureCredentialRegistry(credentials);
    const evidence = await ethers.deployContract('EvidenceRegistry', [stakeholders, credentials]);
    const ingredients = await ethers.deployContract('IngredientRegistry', [
      stakeholders,
      credentials,
    ]);
    await evidence.getFunction('configureIngredientRegistry')(ingredients);
    const products = await ethers.deployContract('ProductRegistry', [
      stakeholders,
      ingredients,
      evidence,
    ]);
    await ingredients.configureProductRegistry(products);
    const custody = await ethers.deployContract('CustodyTransfer', [stakeholders, products]);
    return {
      admin,
      supplier,
      manufacturer,
      distributor,
      retailer,
      stranger,
      stakeholders,
      credentials,
      evidence,
      ingredients,
      products,
      custody,
    };
  }

  async function onboard(
    system: Awaited<ReturnType<typeof deployFixture>>,
    signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    role: number,
  ) {
    const applicationId = ethers.id(`application:${signer.address}`);
    const credentialHash = ethers.id(`company-credential:${signer.address}`);
    const credentialId = ethers.id(`company-credential-id:${signer.address}`);
    const expiry = BigInt((await networkHelpers.time.latest()) + 86_400);
    await asSigner(system.stakeholders, signer).submitApplication(
      applicationId,
      ethers.id('profile'),
      'encrypted-profile-cid',
      role,
      ethers.ZeroHash,
    );
    await system.stakeholders.approveApplication(
      applicationId,
      credentialHash,
      'encrypted-credential-cid',
      expiry,
    );
    await system.credentials.registerCredential(
      credentialId,
      credentialHash,
      'encrypted-credential-cid',
      signer.address,
      1,
      expiry,
    );
    expect(await system.stakeholders.roleOf(signer.address)).to.equal(BigInt(role));
  }

  async function ingredientFixture() {
    const system = await deployFixture();
    await onboard(system, system.supplier, 2);
    await onboard(system, system.manufacturer, 3);
    await onboard(system, system.distributor, 4);

    const now = await networkHelpers.time.latest();
    const ingredientCredentialId = ethers.id('traceability-ingredient-credential');
    await asSigner(system.credentials, system.supplier).registerCredential(
      ingredientCredentialId,
      ethers.id('traceability-ingredient-jwt'),
      'encrypted-ingredient-cid',
      system.supplier.address,
      2,
      now + 86_400,
    );
    const ingredientId = ethers.id('TRACEABILITY-INGREDIENT');
    await asSigner(system.ingredients, system.supplier).registerBatch(
      ingredientId,
      ethers.id('traceability-ingredient-metadata'),
      'encrypted-ingredient-cid',
      ingredientCredentialId,
      50,
      ethers.id('kg'),
      now,
      now + 3_600,
    );
    const requestId = ethers.id('TRACEABILITY-REQUEST');
    await asSigner(system.evidence, system.manufacturer).requestEvidence(
      requestId,
      system.supplier.address,
      ingredientId,
      ethers.id('traceability-claims'),
      ethers.id('traceability-challenge'),
      'encrypted-request-cid',
      now + 3_600,
    );
    await asSigner(system.evidence, system.supplier).respond(
      requestId,
      ethers.id('traceability-presentation'),
      'encrypted-presentation-cid',
      now + 1_800,
    );
    await asSigner(system.evidence, system.manufacturer).accept(requestId, ingredientCredentialId);

    return { ...system, ingredientCredentialId, ingredientId, now };
  }

  async function fullyConsumedProductFixture() {
    const system = await ingredientFixture();
    const productId = ethers.id('FULLY-CONSUMED-INGREDIENT-PRODUCT');
    await asSigner(system.products, system.manufacturer).createProduct(
      productId,
      ethers.id('fully-consumed-product-metadata'),
      'public-product-cid',
      50,
      ethers.id('units'),
      system.now,
      system.now + 86_400,
      [system.ingredientId],
      [50],
    );
    return { ...system, productId };
  }

  it('denies role access until application approval and credential registration', async function () {
    const system = await networkHelpers.loadFixture(deployFixture);
    await expect(
      asSigner(system.stakeholders, system.stranger).suspendStakeholder(
        system.supplier.address,
        ethers.id('x'),
      ),
    ).to.be.revertedWithCustomError(system.stakeholders, 'Unauthorized');
    await onboard(system, system.supplier, 2);
    await system.stakeholders.suspendStakeholder(system.supplier.address, ethers.id('review'));
    expect(await system.stakeholders.roleOf(system.supplier.address)).to.equal(0n);
    await system.stakeholders.reactivateStakeholder(system.supplier.address);
    expect(await system.stakeholders.roleOf(system.supplier.address)).to.equal(2n);
  });

  it('lets the administrator change operational role permissions on-chain', async function () {
    const system = await networkHelpers.loadFixture(deployFixture);
    await onboard(system, system.supplier, 2);
    const permission = ethers.id('REGISTER_INGREDIENT');
    expect(await system.stakeholders.roleHasPermission(2, permission)).to.equal(true);
    await expect(
      asSigner(system.stakeholders, system.supplier).setRolePermission(2, permission, false),
    ).to.be.revertedWithCustomError(system.stakeholders, 'Unauthorized');
    await system.stakeholders.setRolePermission(2, permission, false);
    expect(await system.stakeholders.roleHasPermission(2, permission)).to.equal(false);
    expect(await system.stakeholders.hasPermission(system.supplier.address, permission)).to.equal(
      false,
    );
  });

  it('keeps a product transferable after consuming the final ingredient unit', async function () {
    const system = await networkHelpers.loadFixture(fullyConsumedProductFixture);

    expect((await system.ingredients.getBatch(system.ingredientId)).availableQuantity).to.equal(0n);
    expect(await system.ingredients.isUsable(system.ingredientId)).to.equal(false);
    expect(
      await system.ingredients.getFunction('isValidTraceabilitySource')(system.ingredientId),
    ).to.equal(true);
    expect(await system.products.isTransferable(system.productId)).to.equal(true);

    const transferId = ethers.id('FULLY-CONSUMED-INGREDIENT-TRANSFER');
    await asSigner(system.custody, system.manufacturer).createTransfer(
      transferId,
      system.productId,
      system.distributor.address,
      20,
      system.now + 3_600,
      ethers.id('fully-consumed-shipment'),
      'encrypted-shipment-cid',
    );
    expect((await system.custody.getTransfer(transferId)).status).to.equal(1n);
    expect(
      (await system.custody.getInventory(system.productId, system.manufacturer.address)).reserved,
    ).to.equal(20n);
  });

  it('rejects product creation when an ingredient quantity is insufficient', async function () {
    const system = await networkHelpers.loadFixture(ingredientFixture);

    await expect(
      asSigner(system.products, system.manufacturer).createProduct(
        ethers.id('INSUFFICIENT-INGREDIENT-PRODUCT'),
        ethers.id('insufficient-product-metadata'),
        'public-product-cid',
        51,
        ethers.id('units'),
        system.now,
        system.now + 86_400,
        [system.ingredientId],
        [51],
      ),
    ).to.be.revertedWithCustomError(system.ingredients, 'InvalidState');
    expect((await system.ingredients.getBatch(system.ingredientId)).availableQuantity).to.equal(
      50n,
    );
  });

  for (const [label, status] of [
    ['suspended', 2],
    ['recalled', 3],
  ] as const) {
    it(`prevents transfer when a linked ingredient is ${label}`, async function () {
      const system = await networkHelpers.loadFixture(fullyConsumedProductFixture);

      await asSigner(system.ingredients, system.supplier).setStatus(
        system.ingredientId,
        status,
        ethers.id(`${label}-ingredient`),
      );

      expect(
        await system.ingredients.getFunction('isValidTraceabilitySource')(system.ingredientId),
      ).to.equal(false);
      expect(await system.products.isTransferable(system.productId)).to.equal(false);
    });
  }

  it('prevents transfer when a linked ingredient has expired', async function () {
    const system = await networkHelpers.loadFixture(fullyConsumedProductFixture);

    await networkHelpers.time.increaseTo(system.now + 3_601);

    expect(
      await system.ingredients.getFunction('isValidTraceabilitySource')(system.ingredientId),
    ).to.equal(false);
    expect(await system.products.isTransferable(system.productId)).to.equal(false);
  });

  it('prevents transfer when a linked Ingredient Credential is invalid', async function () {
    const system = await networkHelpers.loadFixture(fullyConsumedProductFixture);

    await asSigner(system.credentials, system.supplier).suspendCredential(
      system.ingredientCredentialId,
      ethers.id('ingredient-credential-review'),
    );

    expect(
      await system.ingredients.getFunction('isValidTraceabilitySource')(system.ingredientId),
    ).to.equal(false);
    expect(await system.products.isTransferable(system.productId)).to.equal(false);
  });

  it('rejects a valid but unrelated Ingredient Credential during evidence acceptance', async function () {
    const system = await networkHelpers.loadFixture(ingredientFixture);
    const unrelatedCredentialId = ethers.id('unrelated-ingredient-credential');
    await asSigner(system.credentials, system.supplier).registerCredential(
      unrelatedCredentialId,
      ethers.id('unrelated-ingredient-jwt'),
      'encrypted-unrelated-ingredient-cid',
      system.supplier.address,
      2,
      system.now + 86_400,
    );
    const requestId = ethers.id('UNRELATED-CREDENTIAL-REQUEST');
    await asSigner(system.evidence, system.manufacturer).requestEvidence(
      requestId,
      system.supplier.address,
      system.ingredientId,
      ethers.id('claims'),
      ethers.id('unrelated-challenge'),
      'encrypted-request-cid',
      system.now + 3_600,
    );
    await asSigner(system.evidence, system.supplier).respond(
      requestId,
      ethers.id('presentation'),
      'encrypted-presentation-cid',
      system.now + 1_800,
    );

    await expect(
      asSigner(system.evidence, system.manufacturer).accept(requestId, unrelatedCredentialId),
    ).to.be.revertedWithCustomError(system.evidence, 'InvalidState');
  });

  it('records Retailer evidence satisfaction without granting Manufacturer consumption rights', async function () {
    const system = await networkHelpers.loadFixture(ingredientFixture);
    await onboard(system, system.retailer, 5);
    const requestId = ethers.id('RETAILER-EVIDENCE-REQUEST');
    await asSigner(system.evidence, system.retailer).requestEvidence(
      requestId,
      system.supplier.address,
      system.ingredientId,
      ethers.id('retailer-claims'),
      ethers.id('retailer-challenge'),
      'encrypted-retailer-request-cid',
      system.now + 3_600,
    );
    await asSigner(system.evidence, system.supplier).respond(
      requestId,
      ethers.id('retailer-presentation'),
      'encrypted-retailer-presentation-cid',
      system.now + 1_800,
    );
    await asSigner(system.evidence, system.retailer).accept(
      requestId,
      system.ingredientCredentialId,
    );
    expect(
      await system.evidence.acceptedForManufacturer(system.ingredientId, system.retailer),
    ).to.equal(false);
    expect((await system.evidence.getRequest(requestId)).status).to.equal(3n);
  });

  it('reserves split inventory and settles receipt quantities exactly once', async function () {
    const system = await networkHelpers.loadFixture(deployFixture);
    await onboard(system, system.supplier, 2);
    await onboard(system, system.manufacturer, 3);
    await onboard(system, system.distributor, 4);

    const now = await networkHelpers.time.latest();
    const ingredientCredentialId = ethers.id('ingredient-credential');
    await asSigner(system.credentials, system.supplier).registerCredential(
      ingredientCredentialId,
      ethers.id('ingredient-jwt'),
      'encrypted-ingredient-cid',
      system.supplier.address,
      2,
      now + 86_400,
    );
    const ingredientId = ethers.id('ING-001');
    await asSigner(system.ingredients, system.supplier).registerBatch(
      ingredientId,
      ethers.id('ingredient-metadata'),
      'encrypted-ingredient-cid',
      ingredientCredentialId,
      100,
      ethers.id('kg'),
      now,
      now + 86_400,
    );
    const requestId = ethers.id('REQ-001');
    await asSigner(system.evidence, system.manufacturer).requestEvidence(
      requestId,
      system.supplier.address,
      ingredientId,
      ethers.id('claims'),
      ethers.id('challenge'),
      'encrypted-request-cid',
      now + 3_600,
    );
    await asSigner(system.evidence, system.supplier).respond(
      requestId,
      ethers.id('presentation'),
      'encrypted-presentation-cid',
      now + 1_800,
    );
    await asSigner(system.evidence, system.manufacturer).accept(requestId, ingredientCredentialId);
    const productId = ethers.id('PROD-001');
    await asSigner(system.products, system.manufacturer).createProduct(
      productId,
      ethers.id('product-metadata'),
      'public-product-cid',
      50,
      ethers.id('units'),
      now,
      now + 86_400,
      [ingredientId],
      [50],
    );
    const transferId = ethers.id('TRANSFER-001');
    await asSigner(system.custody, system.manufacturer).createTransfer(
      transferId,
      productId,
      system.distributor.address,
      20,
      now + 3_600,
      ethers.id('shipment'),
      'encrypted-shipment-cid',
    );
    expect(
      (await system.custody.getInventory(productId, system.manufacturer.address)).reserved,
    ).to.equal(20n);
    await asSigner(system.custody, system.distributor).confirmReceipt(
      transferId,
      20,
      2,
      1,
      ethers.id('receipt'),
      'encrypted-receipt-cid',
    );
    const receiverInventory = await system.custody.getInventory(
      productId,
      system.distributor.address,
    );
    expect(receiverInventory.available).to.equal(17n);
    expect(receiverInventory.damaged).to.equal(2n);
    expect(receiverInventory.rejected).to.equal(1n);
    await expect(
      asSigner(system.custody, system.distributor).confirmReceipt(
        transferId,
        20,
        0,
        0,
        ethers.id('duplicate'),
        '',
      ),
    ).to.be.revertedWithCustomError(system.custody, 'InvalidState');
  });
});
