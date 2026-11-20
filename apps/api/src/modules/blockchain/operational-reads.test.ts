import { describe, expect, it, vi } from 'vitest';
import { BlockchainGatewayService, type OperationalData } from './blockchain-gateway.service.js';

const empty = (): OperationalData => ({
  ingredientBatches: [],
  productBatches: [],
  transfers: [],
  evidenceRequests: [],
});
function fixture() {
  const address = '0x1111111111111111111111111111111111111111';
  const gateway = new BlockchainGatewayService(
    11155111,
    'http://127.0.0.1:1',
    address,
    address,
    address,
    address,
    address,
    address,
  );
  const read = vi.spyOn(
    gateway as unknown as { readOperationalData(account: string): Promise<OperationalData> },
    'readOperationalData',
  );
  return { gateway, read };
}

describe('Concurrent operational reads', () => {
  it('shares an in-flight read for the same wallet but refreshes after completion', async () => {
    const { gateway, read } = fixture();
    let finish!: (data: OperationalData) => void;
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = gateway.listOperationalData('0xABC');
    const second = gateway.listOperationalData('0xabc');
    expect(read).toHaveBeenCalledTimes(1);
    finish(empty());
    await Promise.all([first, second]);
    read.mockResolvedValueOnce(empty());
    await gateway.listOperationalData('0xabc');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('keeps different wallets separate', async () => {
    const { gateway, read } = fixture();
    read.mockImplementation(async (wallet) => ({ ...empty(), actorWallet: wallet }));
    const [first, second] = await Promise.all([
      gateway.listOperationalData('first'),
      gateway.listOperationalData('second'),
    ]);
    expect(first.actorWallet).toBe('first');
    expect(second.actorWallet).toBe('second');
  });
  it('does not cache a failed read', async () => {
    const { gateway, read } = fixture();
    read.mockRejectedValueOnce(new Error('RPC busy')).mockResolvedValueOnce(empty());
    await expect(gateway.listOperationalData('wallet')).rejects.toThrow('RPC busy');
    await expect(gateway.listOperationalData('wallet')).resolves.toEqual(empty());
  });
});
