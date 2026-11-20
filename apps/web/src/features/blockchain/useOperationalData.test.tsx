// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOperationalData: vi.fn() }));
vi.mock('./blockchain.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./blockchain.api')>()),
  getOperationalData: mocks.getOperationalData,
}));

import {
  clearOperationalDataCache,
  OperationalDataScopeProvider,
  useOperationalData,
} from './useOperationalData';

const walletA = '0x1000000000000000000000000000000000000001';
const walletB = '0x2000000000000000000000000000000000000002';

function data(wallet: string, count = 1) {
  return {
    actorWallet: wallet,
    evidenceRequests: [],
    ingredientBatches: Array.from({ length: count }, (_, batchId) => ({ batchId })),
    productBatches: [],
    transfers: [],
  };
}

function Consumer({ name }: { name: string }) {
  const query = useOperationalData();
  return (
    <div>
      <span data-testid={`${name}-state`}>
        {query.loading ? 'loading' : `${query.data.ingredientBatches.length}`}
      </span>
      <button onClick={() => void query.reload()}>{`reload-${name}`}</button>
    </div>
  );
}

describe('shared operational query cache', () => {
  beforeEach(() => {
    clearOperationalDataCache();
    mocks.getOperationalData.mockReset();
  });

  it('coalesces duplicate consumers and broadcasts a forced refresh', async () => {
    mocks.getOperationalData
      .mockResolvedValueOnce(data(walletA))
      .mockResolvedValueOnce(data(walletA, 2));
    render(
      <OperationalDataScopeProvider walletAddress={walletA}>
        <Consumer name="first" />
        <Consumer name="second" />
      </OperationalDataScopeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('first-state').textContent).toBe('1'));
    expect(screen.getByTestId('second-state').textContent).toBe('1');
    expect(mocks.getOperationalData).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'reload-first' }));
    await waitFor(() => expect(screen.getByTestId('second-state').textContent).toBe('2'));
    expect(mocks.getOperationalData).toHaveBeenCalledTimes(2);
  });

  it('isolates cached data by wallet and rejects a mismatched actor response', async () => {
    mocks.getOperationalData
      .mockResolvedValueOnce(data(walletA))
      .mockResolvedValueOnce(data(walletB, 2));
    const view = render(
      <OperationalDataScopeProvider walletAddress={walletA}>
        <Consumer name="result" />
      </OperationalDataScopeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('result-state').textContent).toBe('1'));
    view.rerender(
      <OperationalDataScopeProvider walletAddress={walletB}>
        <Consumer name="result" />
      </OperationalDataScopeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('result-state').textContent).toBe('2'));
    expect(mocks.getOperationalData).toHaveBeenCalledTimes(2);

    view.unmount();
    clearOperationalDataCache();
    mocks.getOperationalData.mockResolvedValueOnce(data(walletA));
    render(
      <OperationalDataScopeProvider walletAddress={walletB}>
        <Consumer name="result" />
      </OperationalDataScopeProvider>,
    );
    await act(async () => undefined);
    await waitFor(() => expect(mocks.getOperationalData).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByTestId('result-state').textContent).toBe('0'));
  });
});
