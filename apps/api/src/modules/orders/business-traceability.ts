import type { ChainRecord, OrdersGateway } from './orders.gateway.js';

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const unique = (values: string[]) => [
  ...new Set(values.filter(Boolean).map((value) => value.toLowerCase())),
];
export interface TraceStage {
  id: string;
  title: string;
  state: 'recorded' | 'in-progress' | 'not-recorded';
  records: ChainRecord[];
}

/** Public chain facts only. Never include encrypted payloads, notes, locations or private inventory. */
export async function readBusinessTraceability(
  gateway: OrdersGateway,
  state: ChainRecord,
  selection: { kind?: string; batchId?: string },
  names: (
    wallets: string[],
  ) => Promise<Map<string, string | { companyName: string; logoPath?: string }>>,
) {
  const shipments: ChainRecord[] = [
    ...(state.logistics?.shipments ?? []),
    ...(state.shipments ?? []),
  ];
  const roots = state.catalogue.flatMap((item: ChainRecord) =>
    item.batches.flatMap((batchId: string) => {
      const own = same(item.seller, state.actor);
      const participant =
        state.orders.some(
          (order: ChainRecord) =>
            same(order.itemId, item.itemId) &&
            [
              order.requestedBatch,
              order.proposedBatch,
              order.custodyOrder?.batchId,
              ...(item.batches.length === 1 ? item.batches : []),
            ].some((id) => same(id, batchId)),
        ) ||
        shipments.some((shipment) => same(shipment.batchId ?? shipment.productBatchId, batchId));
      const allowed =
        state.role === 'SUPPLIER'
          ? own && Number(item.kind) === 1
          : state.role === 'RETAILER'
            ? Number(item.kind) === 2 && participant
            : own || participant;
      return allowed
        ? [
            {
              batchId,
              category: item.batchSummaries?.[batchId]?.category ?? item.category,
              imagePath: item.batchSummaries?.[batchId]?.imagePath ?? item.imagePath,
              kind: Number(item.kind) === 1 ? 'ingredient' : 'product',
              name: item.batchSummaries?.[batchId]?.name ?? item.name ?? 'Registered batch',
              reference:
                item.batchSummaries?.[batchId]?.batchReference ??
                item.batchReference ??
                'Reference unavailable',
            },
          ]
        : [];
    }),
  );
  const root = selection.batchId
    ? roots.find(
        (entry: ChainRecord) =>
          same(entry.batchId, selection.batchId) && entry.kind === selection.kind,
      )
    : roots[0];
  if (!root) return { roots, root: null, routes: [] };
  const productItems = state.catalogue.filter((item: ChainRecord) => Number(item.kind) === 2);
  const products: ChainRecord[] = [];
  for (const item of productItems)
    for (const productId of item.batches) {
      if (root.kind === 'product' && !same(productId, root.batchId)) continue;
      const links: ChainRecord[] =
        item.batchDetails?.find((entry: ChainRecord) => same(entry.batchId, productId))
          ?.ingredientLinks ?? (await gateway.read('products', 'getIngredientLinks', [productId]));
      if (root.kind === 'ingredient' && !links.some((link) => same(link.batchId, root.batchId)))
        continue;
      const product = await gateway.read('products', 'getProduct', [productId]);
      if (
        root.kind === 'ingredient' &&
        state.role === 'MANUFACTURER' &&
        !same(product.manufacturer, state.actor)
      )
        continue;
      if (
        root.kind === 'ingredient' &&
        state.role === 'DISTRIBUTOR' &&
        !shipments.some((shipment) => same(shipment.batchId ?? shipment.productBatchId, productId))
      )
        continue;
      products.push({ item, productId, links, product });
    }
  const ingredientIds = unique(
    root.kind === 'ingredient'
      ? [
          root.batchId,
          ...products.flatMap((product) => product.links.map((link: ChainRecord) => link.batchId)),
        ]
      : products.flatMap((product) => product.links.map((link: ChainRecord) => link.batchId)),
  );
  const ingredients = await Promise.all(
    ingredientIds.map(async (batchId) => ({
      batchId,
      batch: await gateway.read('ingredients', 'getBatch', [batchId]),
    })),
  );
  const productIds = products.map((product) => product.productId);
  const productTransfers = await Promise.all(
    (await gateway.events('custody', 'TransferCreated'))
      .filter((event) => productIds.some((id) => same(id, event.productBatchId)))
      .map(async (event) => {
        const record = await gateway.read('custody', 'getTransfer', [event.transferId]);
        const carrier = state.productDeliverySupported
          ? await gateway.read('custody', 'productDeliveryCarrier', [event.transferId])
          : undefined;
        return {
          transferId: event.transferId,
          batchId: record.productBatchId,
          sender: record.sender,
          recipient: record.recipient,
          carrier,
          quantity: record.quantity,
          status: Number(record.status),
          recordedAt: Number(record.dispatchedAt),
          received: record.usable,
        };
      }),
  );
  const ingredientTransfers: ChainRecord[] = state.warehouseSupported
    ? await Promise.all(
        (await gateway.events('delivery', 'RoadShipmentDispatched')).map(async (event) => {
          const record = await gateway.read('delivery', 'getRoadShipment', [event.shipmentId]);
          return {
            batchId: record.batchId,
            shipmentId: event.shipmentId,
            positionId: record.positionId,
            sender: record.sender,
            recipient: record.recipient,
            quantity: record.quantity,
            unit: record.unit,
            status: Number(record.status),
            leg: Number(record.leg),
            dispatchedAt: Number(record.dispatchedAt),
            recordedAt: Number(record.recordedAt),
            receivedAt: Number(record.receivedAt),
            received: record.received,
          };
        }),
      ).then((records) =>
        records.filter((record) => ingredientIds.some((id) => same(id, record.batchId))),
      )
    : [];
  for (const event of await gateway.events('orders', 'ApprovedIngredientReceived')) {
    const batchId = event.batchId;
    if (!ingredientIds.some((id) => same(id, batchId))) continue;
    const order = await gateway.read('orders', 'getOrder', [event.orderId]);
    const direct = state.ingredientDeliverySupported
      ? await gateway.read('delivery', 'get', [event.orderId])
      : undefined;
    ingredientTransfers.push({
      batchId,
      shipmentId: event.receiptId ?? event.orderId,
      sender: order.seller,
      recipient: order.buyer,
      carrier: direct?.distributor,
      quantity: event.quantity,
      status: 3,
      leg: 2,
      receivedAt: Number(event.occurredAt),
      recordedAt: Number(event.recordedAt),
      received: event.quantity,
    });
  }
  const identities = await names(
    unique([
      ...ingredients.map((entry) => entry.batch.supplier),
      ...products.map((entry) => entry.product.manufacturer),
      ...[...productTransfers, ...ingredientTransfers].flatMap((entry) => [
        entry.sender,
        entry.recipient,
        'carrier' in entry ? entry.carrier : undefined,
      ]),
    ]),
  );
  const companyIdentity = (wallet: string) => {
    const identity = identities.get(wallet?.toLowerCase());
    return typeof identity === 'string'
      ? { companyName: identity }
      : (identity ?? { companyName: 'Company name unavailable' });
  };
  const company = (wallet: string) => companyIdentity(wallet).companyName;
  const logo = (wallet: string) => companyIdentity(wallet).logoPath;
  const transfers = (records: ChainRecord[]) =>
    records.map((record) => ({
      reference: record.shipmentId ?? record.transferId,
      sender: company(record.sender),
      senderLogoPath: logo(record.sender),
      recipient: company(record.recipient),
      recipientLogoPath: logo(record.recipient),
      ...(record.carrier && !/^0x0+$/.test(record.carrier)
        ? {
            distributor: company(record.carrier),
            distributorLogoPath: logo(record.carrier),
          }
        : {}),
      quantity: String(record.quantity),
      unit:
        state.catalogue.find((item: ChainRecord) =>
          item.batches.some((batchId: string) => same(batchId, record.batchId)),
        )?.unit ?? 'Unavailable',
      status:
        (record.status === 2 && record.transferId) || (record.status === 3 && record.shipmentId)
          ? 'Receipt recorded'
          : record.status === 1
            ? 'Dispatched; receipt pending'
            : 'Review recorded status',
      recordedAt: record.recordedAt,
      dispatchedAt: record.dispatchedAt,
      receivedAt: record.receivedAt,
    }));
  const stage = (id: string, title: string, records: ChainRecord[]): TraceStage => ({
    id,
    title,
    state: !records.length
      ? 'not-recorded'
      : records.some((record) => record.status === 'Dispatched; receipt pending')
        ? 'in-progress'
        : 'recorded',
    records,
  });
  const routes = (
    products.length ? products : [{ productId: null, links: [], item: {}, product: {} }]
  ).map((entry) => {
    const ids =
      entry.productId && !(root.kind === 'ingredient' && state.role === 'SUPPLIER')
        ? entry.links.map((link: ChainRecord) => link.batchId)
        : [root.batchId];
    const sources = ingredients.filter((source) =>
      ids.some((id: string) => same(id, source.batchId)),
    );
    const onward = productTransfers.filter((record) => same(record.batchId, entry.productId));
    const batchTransfers = ingredientTransfers.filter((record) =>
      ids.some((id: string) => same(id, record.batchId)),
    );
    const inbound = entry.productId
      ? batchTransfers.filter(
          (record) =>
            Number(record.leg) === 2 && same(record.recipient, entry.product.manufacturer),
        )
      : batchTransfers;
    const relevantIngredientTransfers = entry.productId
      ? batchTransfers.filter(
          (record) =>
            inbound.includes(record) ||
            (Number(record.leg) === 1 &&
              inbound.some(
                (incoming) =>
                  same(incoming.batchId, record.batchId) &&
                  same(incoming.sender, record.recipient) &&
                  same(incoming.positionId, record.positionId),
              )),
        )
      : batchTransfers;
    const ingredientDetails = sources.map((source) => {
      const item = state.catalogue.find(
        (item: ChainRecord) =>
          Number(item.kind) === 1 && item.batches.some((id: string) => same(id, source.batchId)),
      );
      const summary = item?.batchSummaries?.[source.batchId] ?? item;
      return {
        batchId: source.batchId,
        name: summary?.name ?? 'Registered ingredient',
        reference: summary?.batchReference ?? 'Reference unavailable',
        supplier: company(source.batch.supplier),
        supplierLogoPath: logo(source.batch.supplier),
        producedAt: Number(source.batch.producedAt),
        expiresAt: Number(source.batch.expiresAt),
        registryStatus: Number(source.batch.status),
        quantityUsed: entry.links
          .find((link: ChainRecord) => same(link.batchId, source.batchId))
          ?.quantity?.toString(),
        unit: item?.unit ?? 'Unavailable',
      };
    });
    const productSummary = entry.item.batchSummaries?.[entry.productId] ?? entry.item;
    return {
      id: entry.productId ?? root.batchId,
      productBatchId: entry.productId,
      name: productSummary.name ?? root.name,
      ingredients: ingredientDetails,
      stages: [
        stage('source', 'Supplier', ingredientDetails),
        stage(
          'ingredient-delivery',
          'Ingredient logistics',
          transfers(relevantIngredientTransfers),
        ),
        stage(
          'production',
          'Manufacturer',
          entry.productId
            ? [
                {
                  company: company(entry.product.manufacturer),
                  companyLogoPath: logo(entry.product.manufacturer),
                  product: productSummary.name ?? 'Registered product',
                  reference: productSummary.batchReference ?? 'Reference unavailable',
                  producedAt: Number(entry.product.producedAt),
                  quantity: String(entry.product.totalQuantity),
                  unit: entry.item.unit,
                  registryStatus: Number(entry.product.status),
                },
              ]
            : [],
        ),
        stage('product-delivery', 'Product logistics', transfers(onward)),
        stage(
          'retail',
          'Retailer receipt',
          transfers(
            onward.filter(
              (record) =>
                record.status === 2 &&
                BigInt(record.received ?? '0') > 0n &&
                state.companies?.some(
                  (company: ChainRecord) =>
                    company.role === 'RETAILER' && same(company.wallet, record.recipient),
                ),
            ),
          ).map(({ recordedAt: _dispatchBlock, dispatchedAt: _dispatch, ...record }) => record),
        ),
      ],
    };
  });
  return { roots, root, routes };
}
