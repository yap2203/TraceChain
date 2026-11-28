import { expect, it, vi } from 'vitest';
import type { JsonRpcSigner } from 'ethers';
import { sendPreparedTransaction } from './blockchain.api';
import { transactionProgress } from './transaction-progress';

const prepared = () => ({
  chainId: 31337,
  to: '0x0000000000000000000000000000000000000001',
  value: '0x0',
  data: '0x12345678',
});
const signer = () => ({
  getAddress: vi.fn().mockResolvedValue('0x0000000000000000000000000000000000000002'),
  signMessage: vi.fn(),
  provider: { getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }) },
  sendTransaction: vi
    .fn()
    .mockResolvedValue({ hash: '0x-test', wait: vi.fn().mockResolvedValue({ status: 1 }) }),
});
it('requests the real transaction directly without an extra message signature', async () => {
  const wallet = signer();
  await (await sendPreparedTransaction(wallet as unknown as JsonRpcSigner, prepared())).wait();
  expect(wallet.signMessage).not.toHaveBeenCalled();
  expect(wallet.sendTransaction).toHaveBeenCalledOnce();
  expect(transactionProgress()).toBeUndefined();
  expect(wallet.sendTransaction).toHaveBeenCalledWith({
    data: '0x12345678',
    to: prepared().to,
    value: '0x0',
  });
});
it('preserves MetaMask cancellation without retrying', async () => {
  const wallet = signer();
  wallet.sendTransaction.mockRejectedValue(
    Object.assign(new Error('User rejected'), { code: 'ACTION_REJECTED' }),
  );
  await expect(
    sendPreparedTransaction(wallet as unknown as JsonRpcSigner, prepared()),
  ).rejects.toMatchObject({ code: 'ACTION_REJECTED' });
  expect(wallet.sendTransaction).toHaveBeenCalledOnce();
});
it('keeps the prepared call unchanged while checking the network', async () => {
  const wallet = signer(),
    transaction = prepared();
  wallet.provider.getNetwork.mockImplementation(async () => {
    transaction.to = '0x0000000000000000000000000000000000000003';
    transaction.data = '0xdeadbeef';
    return { chainId: 31337n };
  });
  await (await sendPreparedTransaction(wallet as unknown as JsonRpcSigner, transaction)).wait();
  expect(wallet.sendTransaction).toHaveBeenCalledWith({
    data: '0x12345678',
    to: prepared().to,
    value: '0x0',
  });
});
it('prevents sending on the wrong wallet network', async () => {
  const wallet = signer();
  wallet.provider.getNetwork.mockResolvedValue({ chainId: 11155111n });
  await expect(
    sendPreparedTransaction(wallet as unknown as JsonRpcSigner, prepared()),
  ).rejects.toThrow('network does not match');
  expect(wallet.sendTransaction).not.toHaveBeenCalled();
});
it('shares an in-flight transaction instead of opening duplicate confirmations', async () => {
  const wallet = signer();
  let release: (() => void) | undefined;
  const result = { hash: '0x-test', wait: vi.fn().mockResolvedValue({ status: 1 }) };
  wallet.sendTransaction.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve(result);
      }),
  );
  const first = sendPreparedTransaction(wallet as unknown as JsonRpcSigner, prepared());
  const second = sendPreparedTransaction(wallet as unknown as JsonRpcSigner, prepared());
  await vi.waitFor(() => expect(wallet.sendTransaction).toHaveBeenCalledOnce());
  release!();
  const results = await Promise.all([first, second]);
  expect(results[0]).toBe(results[1]);
  await results[0].wait();
  expect(wallet.signMessage).not.toHaveBeenCalled();
});

it('blocks through wallet submission and confirmation, then releases after a failed receipt', async () => {
  const wallet = signer();
  let confirm!: () => void;
  wallet.sendTransaction.mockResolvedValue({
    hash: '0x-test',
    wait: () =>
      new Promise((_resolve, reject) => {
        confirm = () => reject(new Error('Transaction reverted'));
      }),
  });
  expect(transactionProgress()).toBeUndefined();
  const sending = sendPreparedTransaction(wallet as unknown as JsonRpcSigner, prepared());
  await vi.waitFor(() => expect(transactionProgress()).toBe('confirming'));
  const transaction = await sending;
  const receipt = transaction.wait();
  confirm();
  await expect(receipt).rejects.toThrow('Transaction reverted');
  expect(transactionProgress()).toBeUndefined();
});
