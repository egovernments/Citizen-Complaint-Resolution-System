/**
 * Run `fn` over `items` with at most `limit` calls in flight, starting them in item order.
 *
 * For writes that go one request per record (an MDMS row each): a few hundred in a row take minutes,
 * and all at once flood the gateway. Once a call fails no new one starts; the ones already in flight
 * are waited for, and then the first failure is thrown, so a caller that retries never races its own
 * leftovers.
 */
export async function forEachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await fn(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failure) throw failure.error;
}
