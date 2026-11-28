import { expect, it } from 'vitest';
import { countRead, timeOrderRead, recordReadDuration, measureRead } from './read-timing.js';

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
it('reports queue, RPC, event-scan and IPFS durations without business values', async () => {
  const result = await timeOrderRead(async () => {
    recordReadDuration('queue', 500);
    recordReadDuration('rpc', 25);
    await measureRead('scans', async () => {
      countRead('scans');
    });
    await measureRead('ipfs', async () => {
      countRead('ipfs');
    });
    return 'private';
  });
  expect(result.header).toContain('queue;dur=500.0');
  expect(result.header).toContain('rpc;desc="0 transports";dur=25.0');
  expect(result.header).toMatch(/scans;desc="1 log pages";dur=\d/);
  expect(result.header).toMatch(/ipfs;desc="1 downloads";dur=\d/);
  expect(result.header).not.toContain('private');
});
