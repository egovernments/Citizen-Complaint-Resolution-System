import { BadRequestException } from '@nestjs/common';
import { BoundaryController, MAX_SEARCH_LIMIT } from './boundary.controller';

function controllerWithSpy() {
  const calls: unknown[][] = [];
  const service = {
    search: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ type: 'FeatureCollection', features: [] });
    },
  };
  return { calls, controller: new BoundaryController(service as any) };
}

describe('BoundaryController /boundary/search', () => {
  it('defaults to substring matching and 10 results', async () => {
    const { calls, controller } = controllerWithSpy();
    await controller.search('Delhi', 'overture');
    expect(calls).toEqual([['Delhi', 'overture', 'substring', 10, 0]]);
  });

  it('accepts every match mode', async () => {
    const { calls, controller } = controllerWithSpy();
    for (const m of ['exact', 'prefix', 'substring', 'fuzzy'])
      await controller.search('Delhi', 'overture', m);
    expect(calls.map((c) => c[2])).toEqual([
      'exact',
      'prefix',
      'substring',
      'fuzzy',
    ]);
  });

  it('rejects an unknown match mode with 400', async () => {
    const { calls, controller } = controllerWithSpy();
    await expect(
      controller.search('Delhi', 'overture', 'bogus'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual([]);
  });

  it('rejects a non-positive or non-numeric limit with 400 and caps large ones', async () => {
    const { calls, controller } = controllerWithSpy();
    await expect(
      controller.search('Delhi', 'overture', 'substring', 'abc'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.search('Delhi', 'overture', 'substring', '0'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await controller.search('Delhi', 'overture', 'substring', '1000');
    expect(calls).toEqual([
      ['Delhi', 'overture', 'substring', MAX_SEARCH_LIMIT, 0],
    ]);
  });

  it('defaults to the offline overture source', async () => {
    const { calls, controller } = controllerWithSpy();
    await controller.search('Delhi');
    expect(calls[0][1]).toBe('overture');
  });

  it('passes min_descendants through and rejects a non-integer with 400', async () => {
    const { calls, controller } = controllerWithSpy();
    await controller.search('Delhi', 'overture', 'substring', undefined, '1');
    expect(calls[0][4]).toBe(1);
    for (const bad of ['-1', '1.5', 'x']) {
      await expect(
        controller.search('Delhi', 'overture', 'substring', undefined, bad),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(calls).toHaveLength(1);
  });
});
