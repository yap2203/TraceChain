import { describe, expect, it, vi } from 'vitest';
import { EthersOrdersGateway } from './orders.gateway.js';

const orders = '0x0000000000000000000000000000000000000010';
const addresses = {
  stakeholders: '0x0000000000000000000000000000000000000001',
  ingredients: '0x0000000000000000000000000000000000000002',
  products: '0x0000000000000000000000000000000000000003',
  evidence: '0x0000000000000000000000000000000000000004',
  custody: '0x0000000000000000000000000000000000000005',
};

function fixture() {
  const gateway = new EthersOrdersGateway(11155111, orders, 'http://127.0.0.1:1', addresses);
  const provider = {
    send: vi.fn(async () => '0xaa36a7'),
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
