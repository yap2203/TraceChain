import { afterEach, describe, expect, it, vi } from 'vitest';
import { Interface } from 'ethers';
import { EthersOrdersGateway } from './orders.gateway.js';

const orders = '0x0000000000000000000000000000000000000010';
const addresses = {
  stakeholders: '0x0000000000000000000000000000000000000001',
  ingredients: '0x0000000000000000000000000000000000000002',
  products: '0x0000000000000000000000000000000000000003',
  evidence: '0x0000000000000000000000000000000000000004',
  custody: '0x0000000000000000000000000000000000000005',
};
afterEach(() => vi.useRealTimers());

function handoffFixture() {
  const f = fixture();
  const iface = new Interface([
    'function createRoadTransfer(bytes32,bytes32,address,uint256,uint64,bytes32,string,bytes32,bytes32,uint64,string)',
    'error InvalidInput()',
  ]);
  const simulate = vi.fn(async () => undefined);
  (f.gateway as any).contracts.set('custody', {
    target: addresses.custody,
    interface: iface,
    getFunction: () => ({ staticCall: simulate }),
  });
  const occurredAt = 1795860419;
  const args = [
    '0x' + '11'.repeat(32),
    '0x' + '22'.repeat(32),
    addresses.stakeholders,
    '4',
    occurredAt + 86400,
    '0x' + '33'.repeat(32),
    'encrypted-cid',
    '0x' + '44'.repeat(32),
    '0x' + '55'.repeat(32),
    occurredAt,
    'VAB 1234',
  ];
  return { ...f, simulate, args, occurredAt };
}

it('waits through block lag and simulates unchanged calldata in the mined block with the actual sender', async () => {
  vi.useFakeTimers();
  const f = handoffFixture(),
    started = Date.now();
  f.provider.send.mockImplementation(async (method: string) =>
    method === 'eth_chainId'
      ? '0xaa36a7'
      : ({
          number: '0x64',
          timestamp:
            '0x' + (f.occurredAt - 11 + Math.floor((Date.now() - started) / 1000)).toString(16),
        } as any),
  );
  const pending = f.gateway.prepare(addresses.products, 'custody', 'createRoadTransfer', f.args);
  await vi.advanceTimersByTimeAsync(11_000);
  expect(f.simulate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  const prepared = await pending;
  expect(f.simulate).toHaveBeenCalledExactlyOnceWith(...f.args, {
    from: addresses.products,
    blockTag: 100,
  });
  expect(prepared.notBeforeTimestamp).toBe(f.occurredAt);
  expect(prepared.data.startsWith('0x48e46a7a')).toBe(true);
});

it('does not hide a different contract validation failure once mined time is eligible', async () => {
  const f = handoffFixture(),
    error = Object.assign(new Error('InvalidInput'), {
      code: 'CALL_EXCEPTION',
      revert: { name: 'InvalidInput' },
    });
  f.provider.send.mockImplementation(async (method: string) =>
    method === 'eth_chainId'
      ? '0xaa36a7'
      : ({ number: '0x64', timestamp: '0x' + f.occurredAt.toString(16) } as any),
  );
  f.simulate.mockRejectedValueOnce(error);
  await expect(
    f.gateway.prepare(addresses.products, 'custody', 'createRoadTransfer', f.args),
  ).rejects.toBe(error);
  expect(f.simulate).toHaveBeenCalledTimes(1);
});

function fixture() {
  const gateway = new EthersOrdersGateway(11155111, orders, 'http://127.0.0.1:1', addresses);
  const provider = {
    send: vi.fn(async (_method: string) => '0xaa36a7'),
    getCode: vi.fn(async () => '0x1234'),
  };
  (gateway as any).provider = provider;
  vi.spyOn(gateway, 'read').mockImplementation(async (contract, method) => {
    if (contract === 'orders') return addresses[method as keyof typeof addresses];
    if (method === 'supplyOrders') return orders;
    throw new Error('unexpected deployment read');
  });
  return { gateway, provider };
}

describe('Orders deployment verification cache', () => {
  it('shares one successful verification promise across concurrent requests', async () => {
    const { gateway, provider } = fixture();
    await Promise.all([gateway.assertDeployment(), gateway.assertDeployment()]);
    await gateway.assertDeployment();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.getCode).toHaveBeenCalledTimes(1);
  });

  it('clears a failed promise so provider recovery can be checked later', async () => {
    const { gateway, provider } = fixture();
    provider.send.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await expect(gateway.assertDeployment()).rejects.toThrow('temporarily unavailable');
    await expect(gateway.assertDeployment()).resolves.toBeUndefined();
    expect(provider.send).toHaveBeenCalledTimes(2);
  });
});
