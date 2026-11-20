import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import createHandlers from '../plugins/sepolia-transactions.js';
import type { HookContext } from 'hardhat/types/hooks';
import type { NetworkConnection } from 'hardhat/types/network';
import type { JsonRpcRequest } from 'hardhat/types/providers';

describe('Sepolia delegated-account transaction queue', function () {
  this.timeout(10_000);
  const context = {} as HookContext;
  const request: JsonRpcRequest = {
    jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction',
    params: [{ from: '0x1111111111111111111111111111111111111111' }],
  };
  function connection(read: (method: string) => unknown, networkName = 'sepolia') {
    return { networkName, provider: { request: async ({ method }: { method: string }) => read(method) } } as unknown as NetworkConnection;
  }

  it('returns the first hash immediately, but waits for mining before the next send', async function () {
    const { onRequest } = await createHandlers();
    let mined = false;
    let sends = 0;
    const network = connection((method) => method === 'eth_getTransactionReceipt' ? (mined ? {} : null) : '0x0');
    const send = async () => ({ jsonrpc: '2.0' as const, id: 1, result: `0x${++sends}` });
    assert.equal((await onRequest!(context, network, request, send) as { result: string }).result, '0x1');
    const second = onRequest!(context, network, request, send);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sends, 1);
    mined = true;
    await second;
    assert.equal(sends, 2);
  });

  it('waits for a pending transaction from a previous process before resuming', async function () {
    const { onRequest } = await createHandlers();
    let polls = 0;
    const network = connection((method) => method === 'eth_getTransactionCount' && ++polls === 2 ? '0x1' : '0x0');
    let sent = false;
    const result = onRequest!(context, network, request, async () => {
      sent = true;
      return { jsonrpc: '2.0', id: 1, result: '0x1' };
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sent, false);
    await result;
    assert.equal(sent, true);
  });

  it('handles signed raw transactions and permits retry after an RPC rejection', async function () {
    const { onRequest } = await createHandlers();
    const network = connection(() => '0x0');
    const raw = await Wallet.createRandom().signTransaction({ chainId: 11155111, nonce: 0, gasLimit: 21000 });
    const signedRequest = { ...request, method: 'eth_sendRawTransaction', params: [raw] };
    await assert.rejects(onRequest!(context, network, signedRequest, async () => { throw new Error('RPC rejected'); }), /RPC rejected/);
    await onRequest!(context, network, signedRequest, async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }));
  });

  it('leaves read requests and other networks unchanged', async function () {
    const { onRequest } = await createHandlers();
    const network = connection(() => { throw new Error('Unexpected queue read'); });
    const send = async () => ({ jsonrpc: '2.0' as const, id: 1, result: 'ok' });
    await onRequest!(context, network, { ...request, method: 'eth_chainId' }, send);
    await onRequest!(context, connection(() => { throw new Error('Unexpected queue read'); }, 'hardhatMainnet'), request, send);
  });
});
