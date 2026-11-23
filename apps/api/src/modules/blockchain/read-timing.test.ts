import { expect, it } from 'vitest';
import { countRead, timeOrderRead } from './read-timing.js';

it('keeps concurrent request counters isolated without recording business content', async () => {
  const [first, second] = await Promise.all([
    timeOrderRead(async () => {
      countRead('rpc');
      await new Promise((resolve) => setTimeout(resolve, 1));
      countRead('scans');
      return 'private-result';
    }),
    timeOrderRead(async () => {
      countRead('ipfs');
      return 'another-private-result';
    }),
  ]);
  expect(first.header).toContain('rpc;desc="1 transports"');
  expect(first.header).toContain('scans;desc="1 log pages"');
  expect(first.header).toContain('ipfs;desc="0 downloads"');
  expect(second.header).toContain('rpc;desc="0 transports"');
  expect(second.header).toContain('ipfs;desc="1 downloads"');
  expect(first.header + second.header).not.toContain('private-result');
});
