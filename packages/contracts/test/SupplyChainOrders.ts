import { expect } from 'chai';
import { network } from 'hardhat';
import type { BaseContract, ContractRunner } from 'ethers';
import { CompanyRole } from '@tracechain/shared';
const { ethers, networkHelpers } = await network.create();
function signed<T extends BaseContract>(contract: T, actor: ContractRunner): T {
  return contract.connect(actor) as unknown as T;
}

describe('Orders, physical ingredient inventory and downstream recall links', function () {
  async function warehouseFixture() {
    const f = await buildFixture(7 * 86400);
    const delivery = await ethers.getContractAt(
      'IngredientDelivery',
      await f.orders.ingredientDelivery(),
    );
    await signed(delivery, f.distributor).registerWarehouse(f.transit, 'Warehouse A');
    const shipmentId = ethers.id('warehouse-placement');
    const road = {
      shipmentId,
      referenceId: f.batchId,
      quantity: 100,
      fromLocation: f.source,
      toLocation: f.transit,
      vehicle: 'VAB 1234',
      occurredAt: await networkHelpers.time.latest(),
      expectedAt: f.expiry - 1,
    };
    await signed(delivery, f.supplier).dispatchToWarehouse(road);
    const shipment = await delivery.getRoadShipment(shipmentId);
    const place = (name: string, quantity: number, expiresAt = f.expiry - 1) =>
      signed(delivery, f.manufacturer).placeCustodyOrder(
        ethers.id(name),
        shipment.positionId,
        quantity,
        f.destination,
        expiresAt,
        ethers.id('details'),
        'encrypted',
      );
    return { ...f, delivery, shipmentId, road, positionId: shipment.positionId, place };
  }
  it('credits warehouse stock only after recipient receipt and rejects forged road metadata', async function () {
    const f = await networkHelpers.loadFixture(warehouseFixture);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(199900n);
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(0n);
    await expect(f.place('before-warehouse-receipt', 1)).to.be.revertedWithCustomError(
      f.delivery,
      'InvalidState',
    );
    await expect(
      signed(f.delivery, f.manufacturer).receiveRoadShipment(
        ethers.id('wrong'),
        f.shipmentId,
        100,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    for (const changes of [
      { vehicle: ' ' },
      { occurredAt: f.expiry },
      { fromLocation: f.destination },
      { toLocation: f.shop },
    ]) {
      await expect(
        signed(f.delivery, f.supplier).dispatchToWarehouse({
          ...f.road,
          shipmentId: ethers.id(JSON.stringify(changes)),
          ...changes,
        }),
      ).to.revert(ethers);
    }
    const receiptId = ethers.id('warehouse-receipt');
    await signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 1);
    await signed(f.delivery, f.distributor).receiveRoadShipment(
      receiptId,
      f.shipmentId,
      100,
      await networkHelpers.time.latest(),
    );
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(100n);
    await expect(
      signed(f.delivery, f.distributor).receiveRoadShipment(
        receiptId,
        f.shipmentId,
        1,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    const record = await f.delivery.getRoadShipment(f.shipmentId);
    expect(record.confirmedBy).to.equal(f.supplier.address);
    expect(record.vehicle).to.equal('VAB 1234');
    expect(record.unit).to.equal(ethers.encodeBytes32String('g'));
    expect(record.recordedAt).to.be.greaterThanOrEqual(record.dispatchedAt);
  });
  async function twoModeFixture() {
    const f = await warehouseFixture();
    await signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 1);
    await signed(f.delivery, f.distributor).receiveRoadShipment(
      ethers.id('intake'),
      f.shipmentId,
      100,
      await networkHelpers.time.latest(),
    );
    const requestId = ethers.id('supplier-selects-fulfilment');
    await signed(f.orders, f.manufacturer).requestIngredientDelivery(
      requestId,
      f.batchId,
      10,
      f.expiry - 1,
      ethers.id('request'),
      'encrypted',
    );
    await signed(f.orders, f.supplier).approveIngredientDelivery(
      requestId,
      ethers.id('approved'),
      'encrypted',
    );
    return { ...f, requestId };
  }
  it('lets the Supplier select sufficient custody after approval, reserve atomically and fulfil exactly once', async function () {
    const f = await networkHelpers.loadFixture(twoModeFixture);
    expect(await f.delivery.fulfilmentPolicy()).to.equal(2n);
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(100n);
    await signed(f.delivery, f.supplier).arrangeFromCustody(
      f.requestId,
      f.positionId,
      f.destination,
    );
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(90n);
    expect((await f.delivery.custodyOrders(f.requestId)).quantity).to.equal(10n);
    expect(await f.delivery.deliveryArranged(f.requestId)).to.equal(true);
    expect((await f.delivery.get(f.requestId)).stage).to.equal(3n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(199900n);
    await expect(
      signed(f.delivery, f.supplier).arrangeFromCustody(f.requestId, f.positionId, f.destination),
    ).to.revert(ethers);
    await expect(
      signed(f.delivery, f.distributor).act(
        2,
        f.distributor.address,
        f.requestId,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        0,
        ethers.ZeroHash,
        ethers.ZeroHash,
        0,
      ),
    ).to.revert(ethers);
    const shipmentId = ethers.id('from-custody');
    await signed(f.delivery, f.distributor).dispatchCustodyOrder({
      shipmentId,
      referenceId: f.requestId,
      quantity: 10,
      fromLocation: f.transit,
      toLocation: f.destination,
      vehicle: 'VAB 1234',
      occurredAt: await networkHelpers.time.latest(),
      expectedAt: f.expiry - 1,
    });
    await signed(f.delivery, f.manufacturer).receiveRoadShipment(
      ethers.id('factory-receipt'),
      shipmentId,
      10,
      await networkHelpers.time.latest(),
    );
    expect(await f.ingredients.manufacturerUsable(f.batchId, f.manufacturer.address)).to.equal(10n);
    expect((await f.delivery.getPosition(f.positionId)).position.quantity).to.equal(90n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(199900n);
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id('bypass'),
        f.requestId,
        1,
        f.destination,
        await networkHelpers.time.latest(),
      ),
    ).to.revert(ethers);
  });
  it('rejects custody shortage, wrong parties/locations and switching after a direct carrier request', async function () {
    const f = await networkHelpers.loadFixture(twoModeFixture);
    await expect(
      signed(f.delivery, f.manufacturer).arrangeFromCustody(
        f.requestId,
        f.positionId,
        f.destination,
      ),
    ).to.revert(ethers);
    await expect(
      signed(f.delivery, f.supplier).arrangeFromCustody(f.requestId, f.positionId, f.source),
    ).to.revert(ethers);
    await f.place('competing-reservation', 95);
    await expect(
      signed(f.delivery, f.supplier).arrangeFromCustody(f.requestId, f.positionId, f.destination),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    expect((await f.delivery.get(f.requestId)).stage).to.equal(1n);
    await signed(f.orders, f.manufacturer).closeOrder(ethers.id('competing-reservation'));
    await signed(f.delivery, f.supplier).act(
      1,
      f.supplier.address,
      f.requestId,
      f.distributor.address,
      ethers.ZeroHash,
      0,
      ethers.ZeroHash,
      ethers.ZeroHash,
      0,
    );
    await expect(
      signed(f.delivery, f.supplier).arrangeFromCustody(f.requestId, f.positionId, f.destination),
    ).to.revert(ethers);
    await signed(f.delivery, f.distributor).act(
      3,
      f.distributor.address,
      f.requestId,
      ethers.ZeroAddress,
      ethers.ZeroHash,
      0,
      ethers.ZeroHash,
      ethers.ZeroHash,
      0,
    );
    await signed(f.delivery, f.supplier).arrangeFromCustody(
      f.requestId,
      f.positionId,
      f.destination,
    );
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(90n);
  });
  it('rejects custody selection after the approval assignment deadline', async function () {
    const f = await networkHelpers.loadFixture(twoModeFixture);
    await networkHelpers.time.increaseTo((await f.delivery.get(f.requestId)).assignmentDeadline);
    await expect(
      signed(f.delivery, f.supplier).arrangeFromCustody(f.requestId, f.positionId, f.destination),
    ).to.revert(ethers);
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(100n);
  });
  it('lets only the Distributor accept or reject custody and restores Supplier stock only after confirmed return', async function () {
    const f = await networkHelpers.loadFixture(warehouseFixture);
    await expect(
      signed(f.delivery, f.distributor).receiveRoadShipment(
        ethers.id('early'),
        f.shipmentId,
        100,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await expect(
      signed(f.delivery, f.supplier).decideWarehouseShipment(f.shipmentId, 1),
    ).to.be.revertedWithCustomError(f.delivery, 'Unauthorized');
    await signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 2);
    expect((await f.delivery.getRoadShipment(f.shipmentId)).status).to.equal(4n);
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(0n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(199900n);
    await expect(
      signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 1),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await expect(
      signed(f.delivery, f.distributor).receiveRoadShipment(
        ethers.id('rejected'),
        f.shipmentId,
        100,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await expect(
      signed(f.delivery, f.manufacturer).confirmRejectedReturn(
        ethers.id('wrong-return'),
        f.shipmentId,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'Unauthorized');
    await signed(f.delivery, f.supplier).confirmRejectedReturn(
      ethers.id('returned'),
      f.shipmentId,
      await networkHelpers.time.latest(),
    );
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(200000n);
    await expect(
      signed(f.delivery, f.supplier).confirmRejectedReturn(
        ethers.id('duplicate-return'),
        f.shipmentId,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
  });
  it('requires a current requested Supplier proof before custody acceptance and receipt', async function () {
    const f = await networkHelpers.loadFixture(warehouseFixture);
    const challenge = ethers.id('custody-proof'),
      until = (await networkHelpers.time.latest()) + 600;
    const proof = (action: number, hash = ethers.ZeroHash) =>
      signed(f.delivery, f.distributor).act(
        action,
        f.distributor.address,
        f.shipmentId,
        ethers.ZeroAddress,
        challenge,
        0,
        hash,
        action === 5 ? ethers.id('vp') : ethers.ZeroHash,
        until,
      );
    await proof(4);
    await expect(
      signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 1),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await expect(proof(5, ethers.id('wrong-company'))).to.be.revertedWithCustomError(
      f.delivery,
      'InvalidState',
    );
    await proof(5, await f.stakeholders.credentialHashOf(f.supplier.address));
    await signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 1);
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(0n);
    await networkHelpers.time.increaseTo(until);
    await expect(
      signed(f.delivery, f.distributor).receiveRoadShipment(
        ethers.id('stale-proof'),
        f.shipmentId,
        100,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
  });
  it('reserves atomically at order placement, prevents overselling and releases rejection and expiry', async function () {
    const f = await networkHelpers.loadFixture(warehouseFixture);
    await signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 1);
    await signed(f.delivery, f.distributor).receiveRoadShipment(
      ethers.id('warehouse-receipt'),
      f.shipmentId,
      100,
      await networkHelpers.time.latest(),
    );
    await f.place('first-custody-order', 60);
    expect((await f.delivery.getPosition(f.positionId)).reserved).to.equal(60n);
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(40n);
    expect((await f.orders.getOrder(ethers.id('first-custody-order'))).buyer).to.equal(
      f.manufacturer.address,
    );
    expect(await f.delivery.pendingBuyer()).to.equal(ethers.ZeroAddress);
    await expect(f.place('oversell', 41)).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await signed(f.orders, f.supplier).decideRequest(
      ethers.id('first-custody-order'),
      2,
      ethers.id('reject'),
      'encrypted',
    );
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(100n);
    const expiry = (await networkHelpers.time.latest()) + 100;
    await f.place('expiring-custody-order', 70, expiry);
    await networkHelpers.time.increaseTo(expiry);
    expect((await f.delivery.getPosition(f.positionId)).reserved).to.equal(0n);
    await f.place('after-expiry', 100);
    expect((await f.delivery.getPosition(f.positionId)).available).to.equal(0n);
  });
  it('requires seller approval, separate Distributor dispatch and Manufacturer receipt without double debiting Supplier', async function () {
    const f = await networkHelpers.loadFixture(warehouseFixture);
    await signed(f.delivery, f.distributor).decideWarehouseShipment(f.shipmentId, 1);
    await signed(f.delivery, f.distributor).receiveRoadShipment(
      ethers.id('warehouse-receipt'),
      f.shipmentId,
      100,
      await networkHelpers.time.latest(),
    );
    await f.place('custody-fulfilment', 60);
    const orderId = ethers.id('custody-fulfilment');
    const dispatch = {
      ...f.road,
      shipmentId: ethers.id('warehouse-to-factory'),
      referenceId: orderId,
      quantity: 60,
      fromLocation: f.transit,
      toLocation: f.destination,
      occurredAt: await networkHelpers.time.latest(),
    };
    await expect(
      signed(f.delivery, f.distributor).dispatchCustodyOrder(dispatch),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await expect(
      signed(f.delivery, f.supplier).arrangeDelivery(orderId),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await signed(f.orders, f.supplier).approveIngredientDelivery(
      orderId,
      ethers.id('approve'),
      'encrypted',
    );
    dispatch.occurredAt = await networkHelpers.time.latest();
    await expect(
      signed(f.delivery, f.distributor).dispatchCustodyOrder(dispatch),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await expect(
      signed(f.delivery, f.distributor).arrangeDelivery(orderId),
    ).to.be.revertedWithCustomError(f.delivery, 'Unauthorized');
    await signed(f.delivery, f.supplier).arrangeDelivery(orderId);
    await expect(
      signed(f.delivery, f.supplier).arrangeDelivery(orderId),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await expect(
      signed(f.delivery, f.distributor).dispatchCustodyOrder(dispatch),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    dispatch.occurredAt = await networkHelpers.time.latest();
    await expect(
      signed(f.delivery, f.supplier).dispatchCustodyOrder(dispatch),
    ).to.be.revertedWithCustomError(f.delivery, 'Unauthorized');
    await signed(f.delivery, f.distributor).dispatchCustodyOrder(dispatch);
    expect((await f.delivery.getPosition(f.positionId)).position.quantity).to.equal(40n);
    expect((await f.delivery.getPosition(f.positionId)).reserved).to.equal(0n);
    expect(await f.ingredients.manufacturerUsable(f.batchId, f.manufacturer.address)).to.equal(0n);
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id('bypass'),
        orderId,
        60,
        f.destination,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await signed(f.delivery, f.manufacturer).receiveRoadShipment(
      ethers.id('partial'),
      dispatch.shipmentId,
      20,
      await networkHelpers.time.latest(),
    );
    expect(await f.ingredients.manufacturerUsable(f.batchId, f.manufacturer.address)).to.equal(20n);
    await signed(f.delivery, f.manufacturer).receiveRoadShipment(
      ethers.id('remaining'),
      dispatch.shipmentId,
      40,
      await networkHelpers.time.latest(),
    );
    expect(await f.ingredients.manufacturerUsable(f.batchId, f.manufacturer.address)).to.equal(60n);
    expect((await f.orders.getOrder(orderId)).status).to.equal(3n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(199900n);
    expect((await f.delivery.getRoadShipment(dispatch.shipmentId)).status).to.equal(3n);
  });
  it('tracks product road stock by location and restores it after cancellation and rejection', async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const { productId } = await produced(f);
    const send = async (name: string, quantity: number) => {
      const id = ethers.id(name);
      await signed(f.custody, f.manufacturer).createRoadTransfer(
        id,
        productId,
        f.distributor.address,
        quantity,
        f.expiry - 1,
        ethers.id('details'),
        'encrypted',
        f.destination,
        f.transit,
        await networkHelpers.time.latest(),
        'VAB 1234',
      );
      return id;
    };
    const first = await send('cancel-road', 20);
    expect(
      await f.custody.locationStock(productId, f.manufacturer.address, f.destination),
    ).to.equal(40n);
    await signed(f.custody, f.manufacturer).cancel(first, ethers.id('cancel'));
    expect(
      await f.custody.locationStock(productId, f.manufacturer.address, f.destination),
    ).to.equal(60n);
    const second = await send('reject-road', 20);
    await signed(f.custody, f.distributor).reject(second, ethers.id('reject'));
    expect(
      await f.custody.locationStock(productId, f.manufacturer.address, f.destination),
    ).to.equal(60n);
    const third = await send('receive-road', 20);
    await signed(f.custody, f.distributor).confirmReceiptWithMissing(
      third,
      20,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
      ethers.id('receipt'),
      'encrypted',
    );
    expect(await f.custody.locationStock(productId, f.distributor.address, f.transit)).to.equal(
      20n,
    );
    await signed(f.custody, f.distributor).createRoadTransfer(
      ethers.id('onward'),
      productId,
      f.retailer.address,
      10,
      f.expiry - 1,
      ethers.id('details'),
      'encrypted',
      f.transit,
      f.shop,
      await networkHelpers.time.latest(),
      'ABC 456',
    );
    expect(await f.custody.locationStock(productId, f.distributor.address, f.transit)).to.equal(
      10n,
    );
  });
  async function deliveryFixture() {
    const f = await buildFixture(7 * 86400);
    const delivery = await ethers.getContractAt(
      'IngredientDelivery',
      await f.orders.ingredientDelivery(),
    );
    const deliveryOrder = ethers.id('distributor-ingredient-order');
    await signed(f.orders, f.manufacturer).requestIngredientDelivery(
      deliveryOrder,
      f.batchId,
      10,
      f.expiry - 1,
      ethers.id('request'),
      'encrypted',
    );
    await signed(f.orders, f.supplier).approveIngredientDelivery(
      deliveryOrder,
      ethers.id('approved'),
      'encrypted',
    );
    const act = (
      actor: typeof f.supplier,
      action: number,
      fields: {
        distributor?: string;
        challenge?: string;
        at?: number;
        credentialHash?: string;
        presentationHash?: string;
        until?: number;
      } = {},
    ) =>
      signed(delivery, actor).act(
        action,
        actor.address,
        deliveryOrder,
        fields.distributor ?? ethers.ZeroAddress,
        fields.challenge ?? ethers.ZeroHash,
        fields.at ?? 0,
        fields.credentialHash ?? ethers.ZeroHash,
        fields.presentationHash ?? ethers.ZeroHash,
        fields.until ?? 0,
      );
    return { ...f, delivery, deliveryOrder, act };
  }
  it('keeps Orders and its delivery module deployable under the actual Ethereum size limit', async function () {
    const f = await networkHelpers.loadFixture(deliveryFixture);
    for (const contract of [
      f.orders,
      f.delivery,
      f.custody,
      await ethers.getContractAt('ProductDelivery', await f.custody.productDelivery()),
    ]) {
      expect(
        ((await ethers.provider.getCode(await contract.getAddress())).length - 2) / 2,
      ).to.be.at.most(24576);
    }
    expect(await f.delivery.orders()).to.equal(await f.orders.getAddress());
    expect((await f.delivery.get(f.deliveryOrder)).assignmentDeadline).to.equal(
      BigInt(await networkHelpers.time.latest()) + 48n * 3600n,
    );
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(200000n);
  });
  it('requires the assigned Distributor pickup and credits only Manufacturer-confirmed quantities without double debits', async function () {
    const f = await networkHelpers.loadFixture(deliveryFixture);
    const receive = (name: string, quantity: number) =>
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id(name),
        f.deliveryOrder,
        quantity,
        f.destination,
        Math.floor(Date.now() / 1000),
      );
    await expect(receive('too-early', 10)).to.be.revertedWithCustomError(f.orders, 'InvalidState');
    await f.act(f.supplier, 1, { distributor: f.distributor.address });
    await expect(f.act(f.stranger, 2)).to.be.revertedWithCustomError(f.delivery, 'Unauthorized');
    await expect(
      signed(f.delivery, f.stranger).act(
        2,
        f.distributor.address,
        f.deliveryOrder,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        0,
        ethers.ZeroHash,
        ethers.ZeroHash,
        0,
      ),
    ).to.be.revertedWithCustomError(f.delivery, 'Unauthorized');
    await f.act(f.distributor, 2);
    await f.act(f.distributor, 6, { at: await networkHelpers.time.latest() });
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(199990n);
    expect(await f.ingredients.manufacturerUsable(f.batchId, f.manufacturer.address)).to.equal(0n);
    await expect(
      f.act(f.distributor, 6, { at: await networkHelpers.time.latest() }),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    for (const [receipt, quantity] of [
      ['part-one', 4],
      ['part-two', 6],
    ] as const) {
      await signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id(receipt),
        f.deliveryOrder,
        quantity,
        f.destination,
        await networkHelpers.time.latest(),
      );
    }
    expect((await f.delivery.get(f.deliveryOrder)).stage).to.equal(5n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(199990n);
    expect(await f.ingredients.manufacturerUsable(f.batchId, f.manufacturer.address)).to.equal(10n);
    await expect(receive('duplicate', 1)).to.be.revertedWithCustomError(f.orders, 'InvalidState');
  });
  it('cancels at the 48-hour assignment boundary without requiring a timer transaction', async function () {
    const f = await networkHelpers.loadFixture(deliveryFixture);
    const deadline = (await f.delivery.get(f.deliveryOrder)).assignmentDeadline;
    await networkHelpers.time.increaseTo(deadline);
    expect((await f.delivery.get(f.deliveryOrder)).stage).to.equal(6n);
    await expect(
      f.act(f.supplier, 1, { distributor: f.distributor.address }),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await f.act(f.stranger, 7);
    expect((await f.orders.getOrder(f.deliveryOrder)).status).to.equal(3n);
    expect((await f.ingredients.getBatch(f.batchId)).availableQuantity).to.equal(200000n);
  });
  it('preserves the original assignment deadline after a Distributor declines', async function () {
    const f = await networkHelpers.loadFixture(deliveryFixture);
    const deadline = (await f.delivery.get(f.deliveryOrder)).assignmentDeadline;
    await f.act(f.supplier, 1, { distributor: f.distributor.address });
    await f.act(f.distributor, 3);
    expect((await f.delivery.get(f.deliveryOrder)).stage).to.equal(1n);
    expect((await f.delivery.get(f.deliveryOrder)).assignmentDeadline).to.equal(deadline);
  });
  it('caps assignment at request expiry and cannot bypass delivery with the older decision entry point', async function () {
    const f = await networkHelpers.loadFixture(deliveryFixture),
      order = ethers.id('short-delivery-request');
    const expiry = (await networkHelpers.time.latest()) + 600;
    await signed(f.orders, f.manufacturer).requestIngredientDelivery(
      order,
      f.batchId,
      10,
      expiry,
      ethers.id('details'),
      'encrypted',
    );
    await signed(f.orders, f.supplier).decideRequest(order, 1, ethers.id('approved'), 'encrypted');
    expect((await f.delivery.get(order)).assignmentDeadline).to.equal(BigInt(expiry));
    expect((await f.delivery.get(order)).stage).to.equal(1n);
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id('bypass'),
        order,
        10,
        f.destination,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidState');
  });
  it('blocks pickup when requested company evidence expires even after a prior verification attestation', async function () {
    const f = await networkHelpers.loadFixture(deliveryFixture);
    await f.act(f.supplier, 1, { distributor: f.distributor.address });
    await f.act(f.distributor, 2);
    const proof = {
      challenge: ethers.id('expiring-proof'),
      until: (await networkHelpers.time.latest()) + 60,
      credentialHash: await f.stakeholders.credentialHashOf(f.supplier.address),
      presentationHash: ethers.id('verified'),
    };
    await f.act(f.distributor, 4, proof);
    await f.act(f.distributor, 5, proof);
    await networkHelpers.time.increaseTo(proof.until);
    await expect(
      f.act(f.distributor, 6, { at: await networkHelpers.time.latest() }),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
  });
  it('requires requested Supplier proof before pickup and rejects wrong hashes, proof replay and revoked carriers', async function () {
    const f = await networkHelpers.loadFixture(deliveryFixture);
    await f.act(f.supplier, 1, { distributor: f.distributor.address });
    await f.act(f.distributor, 2);
    const challenge = ethers.id('delivery-proof'),
      until = (await networkHelpers.time.latest()) + 600;
    await f.act(f.distributor, 4, { challenge, until });
    await expect(
      f.act(f.distributor, 6, { at: await networkHelpers.time.latest() }),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    const proof = {
      challenge,
      until,
      presentationHash: ethers.id('holder-signed-proof'),
      credentialHash: await f.stakeholders.credentialHashOf(f.supplier.address),
    };
    await expect(
      f.act(f.distributor, 5, { ...proof, credentialHash: ethers.id('wrong-company') }),
    ).to.be.revertedWithCustomError(f.delivery, 'InvalidState');
    await f.act(f.distributor, 5, proof);
    await expect(f.act(f.distributor, 5, proof)).to.be.revertedWithCustomError(
      f.delivery,
      'InvalidState',
    );
    await f.stakeholders.suspendStakeholder(f.distributor.address, ethers.id('suspended'));
    await expect(
      f.act(f.distributor, 6, { at: await networkHelpers.time.latest() }),
    ).to.be.revertedWithCustomError(f.delivery, 'Unauthorized');
  });
  it('prepares an actual receipt after the latest block using pending state without mining or rewriting its time', async function () {
    const f = await networkHelpers.loadFixture(fixture),
      order = ethers.id('idle-chain-approved-order');
    await signed(f.orders, f.manufacturer).requestInterest(
      order,
      1,
      f.batchId,
      10,
      f.expiry - 1,
      ethers.id('details'),
      'encrypted',
    );
    await signed(f.orders, f.supplier).decideRequest(order, 1, ethers.id('approved'), 'encrypted');
    const latest = await networkHelpers.time.latest(),
      receiptTime = latest + 60;
    await networkHelpers.time.setNextBlockTimestamp(receiptTime);
    const receiptId = ethers.id('idle-chain-receipt');
    const args: [string, string, string, string, number] = [
      receiptId,
      order,
      '10',
      f.destination,
      receiptTime,
    ];
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt.staticCall(...args, {
        blockTag: 'latest',
      }),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidInput');
    const { EthersOrdersGateway } = await import(
      new URL('../../../apps/api/src/modules/orders/orders.gateway.ts', import.meta.url).href
    );
    const gateway = new EthersOrdersGateway(
      31337,
      await f.orders.getAddress(),
      'http://127.0.0.1:1',
      {
        ingredients: await f.ingredients.getAddress(),
        products: await f.products.getAddress(),
        custody: await f.custody.getAddress(),
        evidence: await f.evidence.getAddress(),
        stakeholders: await f.stakeholders.getAddress(),
        credentials: await f.credentials.getAddress(),
      },
    );
    Object.defineProperty(gateway, 'provider', { value: ethers.provider });
    const prepared = await gateway.prepare(
      f.manufacturer.address,
      'orders',
      'confirmApprovedIngredientReceipt',
      args,
    );
    const decoded = f.orders.interface.decodeFunctionData(
      'confirmApprovedIngredientReceipt',
      prepared.data,
    );
    expect(decoded[4]).to.equal(BigInt(receiptTime));
    expect(await networkHelpers.time.latest()).to.equal(latest);
    expect(await f.orders.approvedReceivedQuantity(order)).to.equal(0n);
    expect(await f.ingredients.manufacturerUsable(f.batchId, f.manufacturer.address)).to.equal(0n);
  });
  it('produces from confirmed received stock without any ingredient evidence request', async function () {
    const f = await networkHelpers.loadFixture(fixture),
      batch = ethers.id('no-evidence-batch'),
      order = ethers.id('no-evidence-order');
    await signed(f.ingredients, f.supplier).registerBatch(
      batch,
      ethers.id('metadata'),
      'encrypted',
      f.credentialId,
      10,
      ethers.encodeBytes32String('kg'),
      f.time,
      f.expiry,
    );
    expect(await f.evidence.acceptedForManufacturer(batch, f.manufacturer.address)).to.equal(false);
    const create = (product: string, quantity: number) =>
      signed(f.products, f.manufacturer).createProductAt(
        ethers.id(product),
        ethers.id('meta'),
        'encrypted',
        5,
        ethers.encodeBytes32String('each'),
        f.time,
        f.expiry,
        [batch],
        [quantity],
        f.destination,
      );
    await expect(create('before-receipt', 2)).to.be.revertedWithCustomError(
      f.ingredients,
      'InvalidState',
    );
    await signed(f.orders, f.manufacturer).requestInterest(
      order,
      1,
      batch,
      10,
      f.expiry - 1,
      ethers.id('details'),
      'encrypted',
    );
    await signed(f.orders, f.supplier).decideRequest(order, 1, ethers.id('approved'), 'encrypted');
    await expect(create('approved-only', 2)).to.be.revertedWithCustomError(
      f.ingredients,
      'InvalidState',
    );
    await signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
      ethers.id('physical-receipt'),
      order,
      10,
      f.destination,
      await networkHelpers.time.latest(),
    );
    await create('without-evidence', 2);
    expect(
      (await f.ingredients.getReceivedStock(batch, f.manufacturer.address, f.destination)).usable,
    ).to.equal(8n);
    expect(await f.evidence.acceptedForManufacturer(batch, f.manufacturer.address)).to.equal(false);
    await expect(create('excess-no-evidence', 9)).to.be.revertedWithCustomError(
      f.ingredients,
      'InvalidState',
    );
    await signed(f.ingredients, f.supplier).setStatus(batch, 3, ethers.id('recall'));
    await expect(create('recalled-no-evidence', 1)).to.be.revertedWithCustomError(
      f.products,
      'InvalidState',
    );
  });
  it('credits only Manufacturer-confirmed approved receipts and consumes multiple ingredients atomically', async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const second = ethers.id('second-received-ingredient');
    await signed(f.ingredients, f.supplier).registerBatch(
      second,
      ethers.id('second-meta'),
      'encrypted',
      f.credentialId,
      3000,
      ethers.encodeBytes32String('ml'),
      f.time,
      f.expiry,
    );
    const proof = ethers.id('second-evidence');
    await signed(f.evidence, f.manufacturer).requestEvidence(
      proof,
      f.supplier.address,
      second,
      ethers.id('claims'),
      ethers.id('challenge-2'),
      'encrypted',
      f.expiry - 1,
    );
    await signed(f.evidence, f.supplier).respond(
      proof,
      ethers.id('vp-2'),
      'encrypted',
      f.expiry - 1,
    );
    await signed(f.evidence, f.manufacturer).accept(proof, f.credentialId);
    const firstOrder = ethers.id('approved-first'),
      secondOrder = ethers.id('approved-second');
    for (const [order, batch, quantity] of [
      [firstOrder, f.batchId, 5000],
      [secondOrder, second, 3000],
    ] as const) {
      await signed(f.orders, f.manufacturer).requestInterest(
        order,
        1,
        batch,
        quantity,
        f.expiry - 1,
        ethers.id('private'),
        'encrypted',
      );
      const before = (await f.ingredients.getBatch(batch)).availableQuantity;
      await signed(f.orders, f.supplier).decideRequest(
        order,
        1,
        ethers.id('approved'),
        'encrypted',
      );
      expect(await f.ingredients.manufacturerUsable(batch, f.manufacturer.address)).to.equal(0n);
      expect((await f.ingredients.getBatch(batch)).availableQuantity).to.equal(before);
      const receipt = ethers.id(`receipt:${order}`);
      await expect(
        signed(f.orders, f.supplier).confirmApprovedIngredientReceipt(
          receipt,
          order,
          quantity,
          f.destination,
          await networkHelpers.time.latest(),
        ),
      ).to.be.revertedWithCustomError(f.orders, 'Unauthorized');
      await signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        receipt,
        order,
        quantity,
        f.destination,
        await networkHelpers.time.latest(),
      );
      expect((await f.ingredients.getBatch(batch)).availableQuantity).to.equal(
        before - BigInt(quantity),
      );
      expect(await f.ingredients.manufacturerUsable(batch, f.manufacturer.address)).to.equal(
        BigInt(quantity),
      );
      await expect(
        signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
          receipt,
          order,
          quantity,
          f.destination,
          await networkHelpers.time.latest(),
        ),
      ).to.be.revertedWithCustomError(f.orders, 'InvalidState');
    }
    const product = ethers.id('mixed-product');
    await signed(f.products, f.manufacturer).createProductAt(
      product,
      ethers.id('product-meta'),
      'encrypted',
      50,
      ethers.encodeBytes32String('each'),
      await networkHelpers.time.latest(),
      f.expiry,
      [f.batchId, second],
      [1250, 500],
      f.destination,
    );
    expect((await f.products.getIngredientLinks(product)).length).to.equal(2);
    expect(
      (await f.ingredients.getReceivedStock(f.batchId, f.manufacturer.address, f.destination))
        .usable,
    ).to.equal(3750n);
    expect(
      (await f.ingredients.getReceivedStock(second, f.manufacturer.address, f.destination)).usable,
    ).to.equal(2500n);
    await expect(
      signed(f.products, f.manufacturer).createProductAt(
        ethers.id('overspend'),
        ethers.id('meta'),
        'encrypted',
        1,
        ethers.encodeBytes32String('each'),
        await networkHelpers.time.latest(),
        f.expiry,
        [f.batchId, second],
        [1, 2501],
        f.destination,
      ),
    ).to.be.revertedWithCustomError(f.ingredients, 'InvalidState');
    expect(
      (await f.ingredients.getReceivedStock(f.batchId, f.manufacturer.address, f.destination))
        .usable,
    ).to.equal(3750n);
  });
  it('rejects unapproved, excessive, wrong-location and repeated receipt credit', async function () {
    const f = await networkHelpers.loadFixture(fixture),
      order = ethers.id('partial-approved');
    await signed(f.orders, f.manufacturer).requestInterest(
      order,
      1,
      f.batchId,
      10,
      f.expiry - 1,
      ethers.id('details'),
      'encrypted',
    );
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id('r0'),
        order,
        1,
        f.destination,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidState');
    await signed(f.orders, f.supplier).decideRequest(order, 1, ethers.id('approved'), 'encrypted');
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id('r1'),
        order,
        11,
        f.destination,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidInput');
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        ethers.id('r2'),
        order,
        1,
        f.source,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidInput');
    const first = ethers.id('first-receipt');
    await signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
      first,
      order,
      4,
      f.destination,
      await networkHelpers.time.latest(),
    );
    await expect(
      signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
        first,
        order,
        4,
        f.destination,
        await networkHelpers.time.latest(),
      ),
    ).to.be.revertedWithCustomError(f.orders, 'InvalidInput');
    expect(await f.orders.approvedReceivedQuantity(order)).to.equal(4n);
    await signed(f.orders, f.manufacturer).confirmApprovedIngredientReceipt(
      ethers.id('second-receipt'),
      order,
      6,
      f.destination,
      await networkHelpers.time.latest(),
    );
    expect(await f.orders.approvedReceivedQuantity(order)).to.equal(10n);
    expect((await f.orders.getOrder(order)).status).to.equal(3n);
  });
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
    return buildFixture(86400);
  }
  async function productDeliveryFixture() {
    const f = await fixture();
    const { productId } = await produced(f);
    const delivery = await ethers.getContractAt(
      'ProductDelivery',
      await f.custody.productDelivery(),
    );
    const orderId = ethers.id('retailer-product-delivery');
    await signed(f.orders, f.retailer).requestInterest(
      orderId,
      2,
      productId,
      10,
      f.expiry - 1,
      ethers.id('request'),
      'encrypted',
    );
    await signed(f.orders, f.manufacturer).decideRequest(
      orderId,
      1,
      ethers.id('approved'),
      'encrypted',
    );
    const transport = async (name: string) => ({
      transferId: ethers.id(name),
      occurredAt: await networkHelpers.time.latest(),
      expectedAt: f.expiry - 1,
      vehicle: 'VAB 1234',
      detailsHash: ethers.id('road'),
      cid: '',
    });
    return { ...f, productId, delivery, orderId, transport };
  }
  it('fulfils a Retailer request via accepted direct Distributor pickup without creating Distributor custody', async function () {
    const f = await networkHelpers.loadFixture(productDeliveryFixture);
    await signed(f.delivery, f.manufacturer).select(
      f.orderId,
      1,
      f.distributor.address,
      f.destination,
      f.shop,
    );
    await expect(signed(f.delivery, f.stranger).respond(f.orderId, true)).to.revert(ethers);
    await signed(f.delivery, f.distributor).respond(f.orderId, false);
    expect((await f.delivery.get(f.orderId)).stage).to.equal(1n);
    await signed(f.delivery, f.manufacturer).select(
      f.orderId,
      1,
      f.distributor.address,
      f.destination,
      f.shop,
    );
    await expect(
      signed(f.delivery, f.distributor).dispatch(f.orderId, await f.transport('before-accept')),
    ).to.revert(ethers);
    await signed(f.delivery, f.distributor).respond(f.orderId, true);
    const t = await f.transport('direct-product-shipment');
    await signed(f.delivery, f.distributor).dispatch(f.orderId, t);
    expect((await f.custody.getInventory(f.productId, f.manufacturer.address)).available).to.equal(
      50n,
    );
    expect((await f.custody.getInventory(f.productId, f.distributor.address)).available).to.equal(
      0n,
    );
    expect(await f.custody.productDeliveryCarrier(t.transferId)).to.equal(f.distributor.address);
    const { EthersOrdersGateway } = await import(
      new URL('../../../apps/api/src/modules/orders/orders.gateway.ts', import.meta.url).href
    );
    const { OrdersService } = await import(
      new URL('../../../apps/api/src/modules/orders/orders.service.ts', import.meta.url).href
    );
    const gateway = new EthersOrdersGateway(
      31337,
      await f.orders.getAddress(),
      'http://127.0.0.1:1',
      {
        ingredients: await f.ingredients.getAddress(),
        products: await f.products.getAddress(),
        custody: await f.custody.getAddress(),
        evidence: await f.evidence.getAddress(),
        stakeholders: await f.stakeholders.getAddress(),
        credentials: await f.credentials.getAddress(),
      },
    );
    Object.defineProperty(gateway, 'provider', { value: ethers.provider });
    const service = new OrdersService(
      {
        getSession: async () => ({
          authenticated: true,
          authorizationReady: true,
          address: f.distributor.address,
          role: CompanyRole.DISTRIBUTOR,
        }),
      } as any,
      gateway,
      {
        decrypt: async () => {
          throw new Error('No private payload is configured.');
        },
      } as any,
      { findPrivate: async () => undefined } as any,
    );
    const state = await service.state('carrier');
    expect(state.productDeliverySupported).to.equal(true);
    expect(state.orders.find((o: any) => o.orderId === f.orderId)?.productDelivery.stage).to.equal(
      '4',
    );
    expect(
      state.logistics?.shipments.find((s: any) => s.shipmentId === t.transferId)?.carrier,
    ).to.equal(f.distributor.address);
    await expect(
      signed(f.custody, f.stranger).confirmReceiptWithMissing(
        t.transferId,
        10,
        0,
        0,
        0,
        await networkHelpers.time.latest(),
        ethers.id('receipt'),
        '',
      ),
    ).to.revert(ethers);
    await signed(f.custody, f.retailer).confirmReceiptWithMissing(
      t.transferId,
      10,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
      ethers.id('receipt'),
      '',
    );
    expect((await f.delivery.get(f.orderId)).stage).to.equal(5n);
    expect((await f.custody.getInventory(f.productId, f.retailer.address)).available).to.equal(10n);
    await expect(
      signed(f.delivery, f.distributor).dispatch(f.orderId, await f.transport('again')),
    ).to.revert(ethers);
  });
  it('reserves received product custody at Manufacturer selection and settles Retailer receipt without double deduction', async function () {
    const f = await networkHelpers.loadFixture(productDeliveryFixture);
    const intake = ethers.id('product-custody');
    await signed(f.custody, f.manufacturer).createRoadTransfer(
      intake,
      f.productId,
      f.distributor.address,
      20,
      f.expiry - 1,
      ethers.id('intake'),
      '',
      f.destination,
      f.transit,
      await networkHelpers.time.latest(),
      'VAB 1234',
    );
    await expect(
      signed(f.delivery, f.manufacturer).select(
        f.orderId,
        2,
        f.distributor.address,
        f.transit,
        f.shop,
      ),
    ).to.revert(ethers);
    await signed(f.custody, f.distributor).confirmReceiptWithMissing(
      intake,
      20,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
      ethers.id('intake-receipt'),
      '',
    );
    await signed(f.delivery, f.manufacturer).select(
      f.orderId,
      2,
      f.distributor.address,
      f.transit,
      f.shop,
    );
    expect((await f.custody.getInventory(f.productId, f.distributor.address)).available).to.equal(
      10n,
    );
    expect(await f.custody.locationStock(f.productId, f.distributor.address, f.transit)).to.equal(
      10n,
    );
    await expect(
      signed(f.delivery, f.manufacturer).select(
        f.orderId,
        1,
        f.distributor.address,
        f.destination,
        f.shop,
      ),
    ).to.revert(ethers);
    const t = await f.transport('warehouse-product-shipment');
    await signed(f.delivery, f.distributor).dispatch(f.orderId, t);
    await signed(f.custody, f.retailer).confirmReceiptWithMissing(
      t.transferId,
      10,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
      ethers.id('retail-receipt'),
      '',
    );
    expect((await f.custody.getInventory(f.productId, f.manufacturer.address)).available).to.equal(
      40n,
    );
    expect((await f.custody.getInventory(f.productId, f.distributor.address)).available).to.equal(
      10n,
    );
    expect((await f.custody.getInventory(f.productId, f.retailer.address)).available).to.equal(10n);
  });
  it('blocks product route substitution and expired requested Manufacturer proof', async function () {
    const f = await networkHelpers.loadFixture(productDeliveryFixture);
    await expect(
      signed(f.delivery, f.stranger).select(
        f.orderId,
        1,
        f.distributor.address,
        f.destination,
        f.shop,
      ),
    ).to.revert(ethers);
    await expect(
      signed(f.delivery, f.manufacturer).select(
        f.orderId,
        1,
        f.distributor.address,
        f.transit,
        f.shop,
      ),
    ).to.revert(ethers);
    await signed(f.delivery, f.manufacturer).select(
      f.orderId,
      1,
      f.distributor.address,
      f.destination,
      f.shop,
    );
    await signed(f.delivery, f.distributor).respond(f.orderId, true);
    const challenge = ethers.id('manufacturer-proof');
    const until = (await networkHelpers.time.latest()) + 60;
    await signed(f.delivery, f.distributor).act(
      4,
      f.distributor.address,
      f.orderId,
      ethers.ZeroAddress,
      challenge,
      0,
      ethers.ZeroHash,
      ethers.ZeroHash,
      until,
    );
    await expect(
      signed(f.delivery, f.distributor).dispatch(f.orderId, await f.transport('unverified')),
    ).to.revert(ethers);
    const hash = (await f.stakeholders.getStakeholder(f.manufacturer.address)).credentialHash;
    await signed(f.delivery, f.distributor).act(
      5,
      f.distributor.address,
      f.orderId,
      ethers.ZeroAddress,
      challenge,
      0,
      hash,
      ethers.id('proof'),
      until,
    );
    await networkHelpers.time.increaseTo(until);
    await expect(
      signed(f.delivery, f.distributor).dispatch(f.orderId, await f.transport('expired-proof')),
    ).to.revert(ethers);
  });
  it('releases a cancelled product custody reservation exactly once and rejects expired direct assignment', async function () {
    const f = await networkHelpers.loadFixture(productDeliveryFixture);
    const intake = ethers.id('reserved-products');
    await signed(f.custody, f.manufacturer).createRoadTransfer(
      intake,
      f.productId,
      f.distributor.address,
      20,
      f.expiry - 1,
      ethers.id('intake'),
      '',
      f.destination,
      f.transit,
      await networkHelpers.time.latest(),
      'VAB 1234',
    );
    await signed(f.custody, f.distributor).confirmReceiptWithMissing(
      intake,
      20,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
      ethers.id('receipt'),
      '',
    );
    await signed(f.delivery, f.manufacturer).select(
      f.orderId,
      2,
      f.distributor.address,
      f.transit,
      f.shop,
    );
    await signed(f.delivery, f.manufacturer).close(f.orderId);
    expect((await f.custody.getInventory(f.productId, f.distributor.address)).available).to.equal(
      20n,
    );
    expect(await f.custody.locationStock(f.productId, f.distributor.address, f.transit)).to.equal(
      20n,
    );
    await expect(signed(f.delivery, f.manufacturer).close(f.orderId)).to.revert(ethers);
    await expect(
      signed(f.delivery, f.distributor).dispatch(f.orderId, await f.transport('cancelled')),
    ).to.revert(ethers);
  });
  it('blocks expired product dispatch and lets a participant release its expired custody reservation once', async function () {
    const f = await networkHelpers.loadFixture(productDeliveryFixture);
    const intake = ethers.id('expiring-product-custody');
    await signed(f.custody, f.manufacturer).createRoadTransfer(
      intake,
      f.productId,
      f.distributor.address,
      20,
      f.expiry - 1,
      ethers.id('intake'),
      '',
      f.destination,
      f.transit,
      await networkHelpers.time.latest(),
      'VAB 1234',
    );
    await signed(f.custody, f.distributor).confirmReceiptWithMissing(
      intake,
      20,
      0,
      0,
      0,
      await networkHelpers.time.latest(),
      ethers.id('receipt'),
      '',
    );
    await signed(f.delivery, f.manufacturer).select(
      f.orderId,
      2,
      f.distributor.address,
      f.transit,
      f.shop,
    );
    await networkHelpers.time.increaseTo(f.expiry - 1);
    expect((await f.delivery.get(f.orderId)).stage).to.equal(6n);
    await expect(
      signed(f.delivery, f.distributor).dispatch(f.orderId, await f.transport('expired')),
    ).to.revert(ethers);
    await signed(f.delivery, f.retailer).close(f.orderId);
    expect((await f.custody.getInventory(f.productId, f.distributor.address)).available).to.equal(
      20n,
    );
    await expect(signed(f.delivery, f.retailer).close(f.orderId)).to.revert(ethers);
  });
  async function buildFixture(lifetime: number) {
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
    const expiry = time + lifetime;
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
