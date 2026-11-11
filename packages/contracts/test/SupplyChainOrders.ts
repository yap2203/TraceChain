import { expect } from 'chai';
import { network } from 'hardhat';
import type { BaseContract, ContractRunner } from 'ethers';
import { CompanyRole } from '@tracechain/shared';
const { ethers, networkHelpers } = await network.create();
function signed<T extends BaseContract>(contract: T, actor: ContractRunner): T {
  return contract.connect(actor) as unknown as T;
}

describe('Orders, physical ingredient inventory and downstream recall links', function () {
  it('allows Supplier listing edits and reversible archive without altering signed claims or history', async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const before = await f.ingredients.getBatch(f.batchId);
    await expect(
      signed(f.ingredients, f.manufacturer).updateListing(
        f.batchId,
        ethers.ZeroHash,
        ethers.id('edit'),
        'encrypted',
      ),
    ).to.be.revertedWithCustomError(f.ingredients, 'Unauthorized');
    await signed(f.ingredients, f.supplier).updateListing(
      f.batchId,
      ethers.ZeroHash,
      ethers.id('edit'),
      'encrypted-listing',
    );
    await expect(
      signed(f.ingredients, f.supplier).updateListing(
        f.batchId,
        ethers.ZeroHash,
        ethers.id('stale'),
        'encrypted',
      ),
    ).to.be.revertedWithCustomError(f.ingredients, 'InvalidInput');
    expect((await f.ingredients.getListing(f.batchId)).metadataHash).to.equal(ethers.id('edit'));
    const after = await f.ingredients.getBatch(f.batchId);
    expect(after.credentialId).to.equal(before.credentialId);
    expect(after.metadataHash).to.equal(before.metadataHash);
    expect(after.totalQuantity).to.equal(before.totalQuantity);
    await signed(f.ingredients, f.supplier).setArchived(f.batchId, true);
    expect(await f.ingredients.isValidTraceabilitySource(f.batchId)).to.equal(true);
    await expect(
      signed(f.orders, f.manufacturer).requestInterest(
        ethers.id('archived-interest'),
        1,
        f.batchId,
        10,
        f.expiry - 1,
        ethers.id('details'),
        'encrypted',
      ),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidState');
    await signed(f.ingredients, f.supplier).setArchived(f.batchId, false);
    await signed(f.orders, f.manufacturer).requestInterest(
      ethers.id('restored-interest'),
      1,
      f.batchId,
      10,
      f.expiry - 1,
      ethers.id('details'),
      'encrypted',
    );
  });
  it('records Supplier approve/reject decisions once without reserving or transferring stock', async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const request = ethers.id('decision-approved'),
      rejected = ethers.id('decision-rejected');
    for (const key of [request, rejected])
      await signed(f.orders, f.manufacturer).requestInterest(
        key,
        1,
        f.batchId,
        12,
        f.expiry - 1,
        ethers.id('details'),
        'encrypted',
      );
    const stock = (await f.ingredients.getBatch(f.batchId)).availableQuantity;
    await expect(
      signed(f.orders, f.stranger).decideRequest(request, 1, ethers.id('reason'), 'encrypted'),
    ).to.be.revertedWithCustomError(f.orders, 'Unauthorized');
    await signed(f.orders, f.supplier).decideRequest(
      request,
      1,
      ethers.id('reason'),
      'encrypted-reason',
    );
    expect((await f.orders.requestDecision(request)).status).to.equal(1n);
    await expect(
      signed(f.orders, f.supplier).decideRequest(request, 2, ethers.id('reason'), 'encrypted'),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidState');
    await signed(f.orders, f.supplier).decideRequest(
      rejected,
      2,
      ethers.id('rejection'),
      'encrypted',
    );
    expect((await f.orders.getOrder(rejected)).status).to.equal(3n);
    expect((await f.orders.requestDecision(rejected)).status).to.equal(2n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(stock);
    expect((await f.orders.getOrder(request)).allocated).to.equal(0n);
  });
  it('records request-only interest without locations or stock changes and permits company identity evidence', async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const request = ethers.id('interest-only');
    const before = (await f.ingredients.getBatch(f.batchId)).availableQuantity;
    await signed(f.orders, f.manufacturer).requestInterest(
      request,
      1,
      f.batchId,
      12,
      f.expiry - 1,
      ethers.id('request-details'),
      'encrypted',
    );
    expect(await f.orders.requestOnly(request)).to.equal(true);
    const record = await f.orders.getOrder(request);
    expect(record.receivingLocation).to.equal(ethers.ZeroHash);
    expect(record.allocated).to.equal(0n);
    expect(record.dispatched).to.equal(0n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(before);
    await expect(
      signed(f.orders, f.supplier).propose(request, f.batchId, f.source),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidState');
    await expect(signed(f.orders, f.supplier).allocate(request, 12)).to.be.revertedWithCustomError(
      f.orders,
      'InvalidState',
    );
    await expect(
      signed(f.orders, f.supplier).dispatch(
        request,
        ethers.id('no-dispatch'),
        12,
        f.time,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        f.expiry,
        ethers.id('details'),
        'encrypted',
      ),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidState');
    await signed(f.orders, f.supplier).requestIdentity(
      request,
      ethers.id('challenge'),
      ethers.id('purpose'),
      ethers.id('claims'),
      f.expiry - 2,
      false,
    );
    const hash = await f.stakeholders.credentialHashOf(f.manufacturer.address);
    await signed(f.orders, f.supplier).attestIdentity(
      request,
      ethers.id('challenge'),
      hash,
      ethers.id('verified-proof'),
      f.expiry - 3,
    );
    expect((await f.orders.getOrder(request)).identityCredentialHash).to.equal(hash);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(before);
  });
  it('requests a registered ingredient without a seller catalogue transaction', async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const fresh = ethers.id('automatically-discovered-batch');
    await signed(f.ingredients, f.supplier).registerBatch(
      fresh,
      ethers.id('metadata'),
      'encrypted',
      f.credentialId,
      500,
      ethers.encodeBytes32String('g'),
      f.time,
      f.expiry,
    );
    expect(await f.orders.batchItem(fresh)).to.equal(ethers.ZeroHash);
    const request = ethers.id('direct-batch-request');
    await signed(f.orders, f.manufacturer).requestBatch(
      request,
      1,
      fresh,
      100,
      f.destination,
      f.expiry - 1,
      false,
      ethers.id('request-details'),
      'encrypted',
    );
    const itemId = await f.orders.batchItem(fresh);
    expect(itemId).to.equal(
      ethers.solidityPackedKeccak256(['string', 'uint8', 'bytes32'], ['registered:', 1, fresh]),
    );
    expect((await f.orders.getOrder(request)).seller).to.equal(f.supplier.address);
    expect((await f.orders.getItem(itemId)).unit).to.equal(ethers.encodeBytes32String('g'));
    await expect(
      signed(f.orders, f.retailer).requestBatch(
        ethers.id('wrong-role-request'),
        1,
        fresh,
        100,
        f.shop,
        f.expiry - 1,
        false,
        ethers.id('details'),
        'encrypted',
      ),
    ).to.be.revert(ethers);
    await signed(f.orders, f.supplier).propose(request, fresh, f.source);
    await signed(f.orders, f.supplier).allocate(request, 100);
    expect((await f.ingredients.getBatch(fresh)).availableQuantity).to.equal(400n);
  });
  async function fixture() {
    const [admin, supplier, manufacturer, distributor, retailer, stranger] =
      await ethers.getSigners();
    const stakeholders = await ethers.deployContract('StakeholderRegistry', [admin.address]);
    const credentials = await ethers.deployContract('CredentialRegistry', [stakeholders]);
    await stakeholders.configureCredentialRegistry(credentials);
    const ingredients = await ethers.deployContract('IngredientRegistry', [
      stakeholders,
      credentials,
    ]);
    const evidence = await ethers.deployContract('EvidenceRegistry', [stakeholders, credentials]);
    await evidence.configureIngredientRegistry(ingredients);
    const products = await ethers.deployContract('ProductRegistry', [
      stakeholders,
      ingredients,
      evidence,
    ]);
    await ingredients.configureProductRegistry(products);
    const custody = await ethers.deployContract('CustodyTransfer', [stakeholders, products]);
    const orders = await ethers.deployContract('SupplyChainOrders', [
      stakeholders,
      ingredients,
      products,
      evidence,
      custody,
    ]);
    await ingredients.configureSupplyOrders(orders);
    await custody.configureSupplyOrders(orders);
    const time = await networkHelpers.time.latest();
    const expiry = time + 86400;
    for (const [actor, role] of [
      [supplier, 2],
      [manufacturer, 3],
      [distributor, 4],
      [retailer, 5],
    ] as const) {
      const hash = ethers.id(`company:${actor.address}`);
      const app = ethers.id(`app:${actor.address}`);
      await signed(stakeholders, actor).submitApplication(
        app,
        ethers.id('profile'),
        'encrypted',
        role,
        ethers.ZeroHash,
      );
      await stakeholders.approveApplication(app, hash, 'encrypted', expiry);
      await credentials.registerCredential(
        ethers.id(`credential:${actor.address}`),
        hash,
        'encrypted',
        actor.address,
        1,
        expiry,
      );
    }
    const source = ethers.id('source-location'),
      destination = ethers.id('production-location'),
      transit = ethers.id('distributor-location'),
      shop = ethers.id('retailer-location');
    for (const [actor, location] of [
      [supplier, source],
      [manufacturer, destination],
      [distributor, transit],
      [retailer, shop],
    ] as const)
      await signed(orders, actor).registerLocation(location, ethers.id('encrypted-location-label'));
    const batchId = ethers.id('ingredient-grams'),
      credentialId = ethers.id('ingredient-credential'),
      itemId = ethers.id('ingredient-item');
    await signed(credentials, supplier).registerCredential(
      credentialId,
      ethers.id('signed-vc'),
      'encrypted-vc',
      supplier.address,
      2,
      expiry,
    );
    await signed(ingredients, supplier).registerBatch(
      batchId,
      ethers.id('metadata'),
      'encrypted',
      credentialId,
      200000,
      ethers.encodeBytes32String('g'),
      time,
      expiry,
    );
    await signed(orders, supplier).listItem(
      itemId,
      'Ingredient',
      1,
      batchId,
      ethers.id('metadata'),
    );
    const orderId = ethers.id('100-kg-request');
    await signed(orders, manufacturer).requestOrder(
      orderId,
      itemId,
      100000,
      ethers.encodeBytes32String('g'),
      destination,
      expiry - 1,
      true,
      ethers.id('private-order'),
      'encrypted',
    );
    await signed(orders, supplier).propose(orderId, batchId, source);
    const evidenceId = ethers.id('exact-batch-evidence');
    await signed(evidence, manufacturer).requestEvidence(
      evidenceId,
      supplier.address,
      batchId,
      ethers.id('claims'),
      ethers.id('fresh-challenge'),
      'encrypted',
      expiry - 1,
    );
    await signed(orders, manufacturer).bindEvidenceRequest(orderId, evidenceId);
    await signed(orders, manufacturer).bindEvidenceRequest(orderId, evidenceId); // exact retry is a no-op
    await signed(evidence, supplier).respond(
      evidenceId,
      ethers.id('verified-vp'),
      'encrypted',
      expiry - 1,
    );
    await signed(evidence, manufacturer).accept(evidenceId, credentialId);
    await signed(orders, manufacturer).linkEvidence(orderId, evidenceId);
    return {
      admin,
      supplier,
      manufacturer,
      distributor,
      retailer,
      stranger,
      stakeholders,
      credentials,
      ingredients,
      evidence,
      products,
      custody,
      orders,
      source,
      destination,
      transit,
      shop,
      batchId,
      credentialId,
      itemId,
      orderId,
      evidenceId,
      time,
      expiry,
    };
  }
  async function dispatch(
    system: Awaited<ReturnType<typeof fixture>>,
    quantity = 100000,
    name = 'shipment',
  ) {
    const shipmentId = ethers.id(name);
    await signed(system.orders, system.supplier).dispatch(
      system.orderId,
      shipmentId,
      quantity,
      await networkHelpers.time.latest(),
      ethers.ZeroAddress,
      ethers.ZeroHash,
      system.expiry - 1,
      ethers.id('shipment'),
      'encrypted',
    );
    return shipmentId;
  }
  for (const unit of ['kg', 'litre', 'unit']) {
    it(`preserves ${unit} quantities through listing, ordering, dispatch and receipt`, async function () {
      const system = await networkHelpers.loadFixture(fixture);
      const batchId = ethers.id(`registered-batch:${unit}`),
        itemId = ethers.id(`registered-item:${unit}`),
        orderId = ethers.id(`registered-order:${unit}`),
        shipmentId = ethers.id(`registered-shipment:${unit}`);
      const encodedUnit = ethers.encodeBytes32String(unit);
      await signed(system.ingredients, system.supplier).registerBatch(
        batchId,
        ethers.id('metadata'),
        'encrypted',
        system.credentialId,
        200000,
        encodedUnit,
        system.time,
        system.expiry,
      );
      await signed(system.orders, system.supplier).listItem(
        itemId,
        'Registered unit item',
        1,
        batchId,
        ethers.id('metadata'),
      );
      expect((await system.orders.getItem(itemId)).unit).to.equal(encodedUnit);
      await expect(
        signed(system.orders, system.manufacturer).requestOrder(
          orderId,
          itemId,
          100000,
          ethers.encodeBytes32String('g'),
          system.destination,
          system.expiry - 1,
          false,
          ethers.id('details'),
          'encrypted',
        ),
      ).to.be.revertedWithCustomError(system.orders, 'InvalidInput');
      await signed(system.orders, system.manufacturer).requestOrder(
        orderId,
        itemId,
        100000,
        encodedUnit,
        system.destination,
        system.expiry - 1,
        false,
        ethers.id('details'),
        'encrypted',
      );
      await signed(system.orders, system.supplier).propose(orderId, batchId, system.source);
      await signed(system.orders, system.supplier).allocate(orderId, 100000);
      await signed(system.orders, system.supplier).dispatch(
        orderId,
        shipmentId,
        100000,
        await networkHelpers.time.latest(),
        ethers.ZeroAddress,
        ethers.ZeroHash,
        system.expiry - 1,
        ethers.id('shipment'),
        'encrypted',
      );
      await signed(system.orders, system.manufacturer).receiveIngredient(
        shipmentId,
        95000,
        3000,
        0,
        2000,
        await networkHelpers.time.latest(),
      );
      expect((await system.orders.getOrder(orderId)).requested).to.equal(100000n);
      expect((await system.ingredients.getBatch(batchId)).availableQuantity).to.equal(100000n);
      expect(
        await system.ingredients.manufacturerUsable(batchId, system.manufacturer.address),
      ).to.equal(95000n);
    });
  }
  async function received(system: Awaited<ReturnType<typeof fixture>>) {
    await signed(system.orders, system.supplier).allocate(system.orderId, 100000);
    const shipmentId = await dispatch(system);
    await signed(system.orders, system.manufacturer).receiveIngredient(
      shipmentId,
      95000,
      3000,
      0,
      2000,
      await networkHelpers.time.latest(),
    );
    return shipmentId;
  }
  async function produced(system: Awaited<ReturnType<typeof fixture>>) {
    const shipmentId = await received(system);
    const productId = ethers.id('finished-product');
    await signed(system.products, system.manufacturer).createProductAt(
      productId,
      ethers.id('product-metadata'),
      'encrypted',
      60,
      ethers.encodeBytes32String('each'),
      await networkHelpers.time.latest(),
      system.expiry - 1,
      [system.batchId],
      [60000],
      system.destination,
    );
    return { shipmentId, productId };
  }
  it('keeps usable stock zero after evidence acceptance and enforces the 100/95/60/35 kg workflow', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    expect(
      await system.ingredients.manufacturerUsable(system.batchId, system.manufacturer.address),
    ).to.equal(0n);
    await produced(system);
    const stock = await system.ingredients.getReceivedStock(
      system.batchId,
      system.manufacturer.address,
      system.destination,
    );
    expect(stock.usable).to.equal(35000n);
    expect(stock.damaged).to.equal(3000n);
    expect(stock.missing).to.equal(2000n);
    expect(stock.consumed).to.equal(60000n);
    expect((await system.ingredients.getBatch(system.batchId)).availableQuantity).to.equal(100000n);
  });
  it('rejects competing reservations and releases only undispatched stock on cancellation', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    await signed(system.orders, system.supplier).allocate(system.orderId, 100000);
    const competing = ethers.id('competing');
    await signed(system.orders, system.manufacturer).requestOrder(
      competing,
      system.itemId,
      150000,
      ethers.encodeBytes32String('g'),
      system.destination,
      system.expiry - 1,
      false,
      ethers.id('order'),
      'encrypted',
    );
    await signed(system.orders, system.supplier).propose(competing, system.batchId, system.source);
    await expect(
      signed(system.orders, system.supplier).allocate(competing, 150000),
    ).to.be.revertedWithCustomError(system.ingredients, 'InvalidState');
    const shipmentId = await dispatch(system, 40000);
    await signed(system.orders, system.manufacturer).closeOrder(system.orderId);
    expect((await system.ingredients.getBatch(system.batchId)).availableQuantity).to.equal(160000n);
    await signed(system.orders, system.manufacturer).receiveIngredient(
      shipmentId,
      40000,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
    );
    expect(
      await system.ingredients.manufacturerUsable(system.batchId, system.manufacturer.address),
    ).to.equal(40000n);
  });
  it('rejects duplicate and unbalanced receipts, unauthorized participants, and production above accepted stock', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    await signed(system.orders, system.supplier).allocate(system.orderId, 100000);
    const shipmentId = await dispatch(system);
    await expect(
      signed(system.orders, system.stranger).receiveIngredient(
        shipmentId,
        100000,
        0,
        0,
        0,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(system.orders, 'Unauthorized');
    await expect(
      signed(system.orders, system.manufacturer).receiveIngredient(
        shipmentId,
        95000,
        3000,
        0,
        3000,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(system.orders, 'InvalidState');
    await signed(system.orders, system.manufacturer).receiveIngredient(
      shipmentId,
      95000,
      3000,
      0,
      2000,
      await networkHelpers.time.latest(),
    );
    await expect(
      signed(system.orders, system.manufacturer).receiveIngredient(
        shipmentId,
        95000,
        3000,
        0,
        2000,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(system.orders, 'InvalidState');
    await expect(
      signed(system.products, system.manufacturer).createProductAt(
        ethers.id('too-much'),
        ethers.id('meta'),
        'encrypted',
        1,
        ethers.encodeBytes32String('each'),
        await networkHelpers.time.latest(),
        system.expiry - 1,
        [system.batchId],
        [95001],
        system.destination,
      ),
    ).to.be.revertedWithCustomError(system.ingredients, 'InvalidState');
  });
  it('requires fresh evidence after replacing a proposal and blocks dispatch while mandatory identity is pending', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    await signed(system.orders, system.supplier).propose(
      system.orderId,
      system.batchId,
      system.source,
    );
    await signed(system.orders, system.supplier).allocate(system.orderId, 100000);
    await expect(
      signed(system.orders, system.supplier).dispatch(
        system.orderId,
        ethers.id('blocked'),
        100000,
        system.time,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        system.expiry - 1,
        ethers.id('shipment'),
        'encrypted',
      ),
    ).to.be.revertedWithCustomError(system.orders, 'InvalidState');
    await expect(
      signed(system.orders, system.manufacturer).linkEvidence(system.orderId, system.evidenceId),
    ).to.be.revertedWithCustomError(system.orders, 'InvalidState');
    const replacementProof = ethers.id('replacement-proposal-proof');
    await signed(system.evidence, system.manufacturer).requestEvidence(
      replacementProof,
      system.supplier.address,
      system.batchId,
      ethers.id('claims'),
      ethers.id('replacement-challenge'),
      'encrypted',
      system.expiry - 1,
    );
    await signed(system.orders, system.manufacturer).bindEvidenceRequest(
      system.orderId,
      replacementProof,
    );
    await signed(system.evidence, system.supplier).respond(
      replacementProof,
      ethers.id('new-vp'),
      'encrypted',
      system.expiry - 1,
    );
    await signed(system.evidence, system.manufacturer).accept(
      replacementProof,
      system.credentialId,
    );
    await signed(system.orders, system.manufacturer).linkEvidence(system.orderId, replacementProof);
    await signed(system.orders, system.supplier).requestIdentity(
      system.orderId,
      ethers.id('nonce'),
      ethers.id('purpose'),
      ethers.id('claims'),
      system.expiry - 1,
      true,
    );
    await expect(
      signed(system.orders, system.supplier).dispatch(
        system.orderId,
        ethers.id('blocked'),
        100000,
        system.time,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        system.expiry - 1,
        ethers.id('shipment'),
        'encrypted',
      ),
    ).to.be.revertedWithCustomError(system.orders, 'InvalidState');
  });
  it('expires allocations safely and never credits usable stock on dispatch', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    await signed(system.orders, system.supplier).allocate(system.orderId, 100000);
    await networkHelpers.time.increaseTo(system.expiry);
    await system.orders.closeOrder(system.orderId);
    expect((await system.ingredients.getBatch(system.batchId)).availableQuantity).to.equal(200000n);
    expect(
      await system.ingredients.manufacturerUsable(system.batchId, system.manufacturer.address),
    ).to.equal(0n);
  });
  it('fulfils remaining quantities from a replacement batch only after fresh exact-batch evidence', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    await signed(system.orders, system.supplier).allocate(system.orderId, 100000);
    const first = await dispatch(system, 40000, 'partial-first-batch');
    const secondBatch = ethers.id('second-ingredient-batch'),
      freshProof = ethers.id('second-batch-proof');
    await signed(system.ingredients, system.supplier).registerBatch(
      secondBatch,
      ethers.id('metadata'),
      'encrypted',
      system.credentialId,
      100000,
      ethers.encodeBytes32String('g'),
      system.time,
      system.expiry,
    );
    await signed(system.orders, system.supplier).listItem(
      system.itemId,
      'Ingredient',
      1,
      secondBatch,
      ethers.id('metadata'),
    );
    await signed(system.evidence, system.manufacturer).requestEvidence(
      freshProof,
      system.supplier.address,
      secondBatch,
      ethers.id('claims'),
      ethers.id('second-batch-fresh-challenge'),
      'encrypted',
      system.expiry - 1,
    );
    await expect(
      signed(system.orders, system.manufacturer).bindEvidenceRequest(system.orderId, freshProof),
    ).to.be.revertedWithCustomError(system.orders, 'InvalidState');
    await signed(system.orders, system.supplier).propose(
      system.orderId,
      secondBatch,
      system.source,
    );
    expect((await system.ingredients.getBatch(system.batchId)).availableQuantity).to.equal(160000n);
    await signed(system.orders, system.supplier).allocate(system.orderId, 60000);
    await signed(system.orders, system.manufacturer).bindEvidenceRequest(
      system.orderId,
      freshProof,
    );
    await signed(system.evidence, system.supplier).respond(
      freshProof,
      ethers.id('signed-second-proof'),
      'encrypted',
      system.expiry - 1,
    );
    await signed(system.evidence, system.manufacturer).accept(freshProof, system.credentialId);
    await signed(system.orders, system.manufacturer).linkEvidence(system.orderId, freshProof);
    const second = await dispatch(system, 60000, 'partial-second-batch');
    await signed(system.orders, system.manufacturer).receiveIngredient(
      first,
      40000,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
    );
    await signed(system.orders, system.manufacturer).receiveIngredient(
      second,
      60000,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
    );
    expect((await system.orders.getShipment(first)).batchId).to.equal(system.batchId);
    expect((await system.orders.getShipment(second)).batchId).to.equal(secondBatch);
    expect((await system.orders.getOrder(system.orderId)).dispatched).to.equal(100000n);
    expect(
      await system.ingredients.manufacturerUsable(secondBatch, system.manufacturer.address),
    ).to.equal(60000n);
  });
  it('preserves product links through distributor and retailer shipments without a direct manufacturer-retailer route', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    const { productId } = await produced(system);
    const finishedItem = ethers.id('finished-item'),
      orderId = ethers.id('retail-order'),
      firstLeg = ethers.id('first-leg');
    expect(await system.orders.batchItem(productId)).to.equal(ethers.ZeroHash);
    await signed(system.orders, system.retailer).requestBatch(
      orderId,
      2,
      productId,
      60,
      system.shop,
      system.expiry - 1,
      false,
      ethers.id('private'),
      'encrypted',
    );
    await signed(system.orders, system.manufacturer).propose(
      orderId,
      productId,
      system.destination,
    );
    await signed(system.orders, system.manufacturer).allocate(orderId, 60);
    await expect(
      signed(system.custody, system.manufacturer).createTransfer(
        ethers.id('steal-reserved'),
        productId,
        system.distributor.address,
        1,
        system.expiry - 1,
        ethers.id('shipment'),
        'encrypted',
      ),
    ).to.be.revertedWithCustomError(system.custody, 'InsufficientInventory');
    await signed(system.orders, system.manufacturer).dispatch(
      orderId,
      firstLeg,
      60,
      await networkHelpers.time.latest(),
      system.distributor.address,
      system.transit,
      system.expiry - 1,
      ethers.id('shipment'),
      'encrypted',
    );
    await signed(system.custody, system.distributor).confirmReceiptWithMissing(
      firstLeg,
      60,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
      ethers.id('receipt'),
      'encrypted',
    );
    const secondLeg = ethers.id('second-leg');
    await signed(system.custody, system.distributor).forwardOrderAt(
      firstLeg,
      secondLeg,
      60,
      system.expiry - 1,
      ethers.id('shipment'),
      'encrypted',
      system.transit,
      system.shop,
      await networkHelpers.time.latest(),
    );
    await signed(system.custody, system.retailer).confirmReceiptWithMissing(
      secondLeg,
      59,
      0,
      0,
      1,
      await networkHelpers.time.latest(),
      ethers.id('receipt'),
      'encrypted',
    );
    expect(
      (await system.custody.getInventory(productId, system.retailer.address)).available,
    ).to.equal(59n);
    expect(await system.custody.missingQuantity(secondLeg)).to.equal(1n);
    expect(await system.custody.transferOrder(secondLeg)).to.equal(orderId);
    expect((await system.products.getIngredientLinks(productId))[0].batchId).to.equal(
      system.batchId,
    );
    await signed(system.ingredients, system.supplier).setStatus(
      system.batchId,
      3,
      ethers.id('recall'),
    );
    expect(await system.products.isTransferable(productId)).to.equal(false);
    // Exercise actual API ABI loading, event decoding, access filtering and recall traversal
    // against the same isolated Hardhat ledger (no HTTP node or developer .env involved).
    // Load across the workspace boundary only for this integration test, without
    // including the API source tree in the contracts package's TypeScript program.
    const { EthersOrdersGateway } = await import(
      new URL('../../../apps/api/src/modules/orders/orders.gateway.ts', import.meta.url).href
    );
    const { OrdersService } = await import(
      new URL('../../../apps/api/src/modules/orders/orders.service.ts', import.meta.url).href
    );
    const gateway = new EthersOrdersGateway(
      31337,
      await system.orders.getAddress(),
      'http://127.0.0.1:1',
      {
        ingredients: await system.ingredients.getAddress(),
        products: await system.products.getAddress(),
        custody: await system.custody.getAddress(),
        evidence: await system.evidence.getAddress(),
        stakeholders: await system.stakeholders.getAddress(),
      },
    );
    Object.defineProperty(gateway, 'provider', { value: ethers.provider });
    const service = new OrdersService(
      {
        getSession: async () => ({
          authenticated: true,
          authorizationReady: true,
          address: system.supplier.address,
          role: CompanyRole.SUPPLIER,
        }),
      } as any,
      gateway,
      {
        decrypt: async () => {
          throw new Error('No private content is configured in this isolated integration test.');
        },
      } as any,
      { findPrivate: async () => undefined } as any,
    );
    const traced = (await service.recall('supplier', system.batchId)) as {
      products: Array<{ productBatchId: string }>;
      transfers: Array<{ transferId: string; recipient: string }>;
    };
    expect(traced.products.map((product) => product.productBatchId)).to.include(productId);
    expect(traced.transfers.map((transfer) => transfer.transferId)).to.include(secondLeg);
    expect(
      traced.transfers.find((transfer) => transfer.transferId === secondLeg)?.recipient,
    ).to.equal(system.retailer.address);
    expect(traced.transfers.every((transfer) => !('shipmentCid' in transfer))).to.equal(true);
  });
  it('appends corrections after consumption without rewriting the original receipt or consumed quantity', async function () {
    const system = await networkHelpers.loadFixture(fixture);
    const { shipmentId } = await produced(system);
    const correctionId = ethers.id('correction');
    await expect(
      system.orders.appendCorrection(
        correctionId,
        shipmentId,
        ethers.id('reason'),
        ethers.id('corrected-values'),
        await networkHelpers.time.latest(),
        true,
        34000,
      ),
    ).to.emit(system.orders, 'CorrectionAppended');
    expect(
      (
        await system.ingredients.getReceivedStock(
          system.batchId,
          system.manufacturer.address,
          system.destination,
        )
      ).usable,
    ).to.equal(34000n);
    expect((await system.orders.getShipment(shipmentId)).accepted).to.equal(95000n);
    expect(
      (
        await system.ingredients.getReceivedStock(
          system.batchId,
          system.manufacturer.address,
          system.destination,
        )
      ).consumed,
    ).to.equal(60000n);
    await expect(
      system.orders.appendCorrection(
        correctionId,
        shipmentId,
        ethers.id('reason'),
        ethers.id('values'),
        await networkHelpers.time.latest(),
        true,
        33000,
      ),
    ).to.be.revertedWithCustomError(system.orders, 'InvalidInput');
  });
});
