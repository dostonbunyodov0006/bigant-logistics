/** A return leg routes to where the goods go back to, not to where they came from. */
import { nextTargetOf, returnTarget } from '../lib/navigation';

const stop = {
  id: 'p1',
  name: 'Supplier A',
  lat: 41.23,
  lng: 69.19,
  return_place: { name: 'BIGANT sklad', address: "Sample street 1", lat: 41.256, lng: 69.223 },
} as never;

describe('the return route', () => {
  it('goes to the place picked for the return', () => {
    expect(returnTarget(stop)).toEqual({ lat: 41.256, lng: 69.223, label: 'BIGANT sklad' });
  });

  it('the next-step route on a return leg is that place too', () => {
    const order = { next_action: { type: 'return_depart', pickup_id: 'p1' }, pickup_sources: [stop] } as never;
    expect(nextTargetOf(order)).toEqual({ lat: 41.256, lng: 69.223, label: 'BIGANT sklad' });
  });

  it('a pickup leg still goes to the pickup stop', () => {
    const order = { next_action: { type: 'depart_pickup', pickup_id: 'p1' }, pickup_sources: [stop] } as never;
    expect(nextTargetOf(order)).toEqual({ lat: 41.23, lng: 69.19, label: 'Supplier A' });
  });
});
