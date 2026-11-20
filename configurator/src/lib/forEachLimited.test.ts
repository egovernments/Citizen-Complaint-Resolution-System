import { describe, expect, it } from 'vitest';
import { forEachLimited } from './forEachLimited';

/** A call that stays in flight until released, recording how many run at once. */
function tracker() {
  let inFlight = 0;
  const seen = { max: 0, started: [] as number[] };
  const pending: (() => void)[] = [];
  const call = (item: number, fail = false) =>
    new Promise<void>((resolve, reject) => {
      inFlight += 1;
      seen.max = Math.max(seen.max, inFlight);
      seen.started.push(item);
      pending.push(() => {
        inFlight -= 1;
        if (fail) reject(new Error(`item ${item} failed`));
        else resolve();
      });
    });
  const releaseAll = async () => {
    while (pending.length) {
      pending.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { seen, call, releaseAll, inFlight: () => inFlight };
}

describe('forEachLimited', () => {
  it('runs every item, in order, never more than the limit at once', async () => {
    const { seen, call, releaseAll } = tracker();
    const done = forEachLimited([...Array(20).keys()], 6, (item) => call(item));
    await releaseAll();
    await done;
    expect(seen.started).toEqual([...Array(20).keys()]);
    expect(seen.max).toBe(6);
  });

  it('starts nothing new after a failure, waits for what is in flight, then throws the failure', async () => {
    const { seen, call, releaseAll, inFlight } = tracker();
    const done = forEachLimited([...Array(20).keys()], 3, (item) => call(item, item === 1));
    const outcome = done.then(
      () => 'resolved',
      (error: Error) => ({ message: error.message, inFlight: inFlight() }),
    );
    await releaseAll();
    expect(await outcome).toEqual({ message: 'item 1 failed', inFlight: 0 });
    expect(seen.started.length).toBeLessThan(20);
  });

  it('does nothing for no items', async () => {
    let calls = 0;
    await forEachLimited([], 5, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
