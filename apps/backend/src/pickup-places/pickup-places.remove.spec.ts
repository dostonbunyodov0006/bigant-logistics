import { ConflictException } from '@nestjs/common';
import { PickupPlacesService } from './pickup-places.service';

function makeService(deleteImpl: jest.Mock) {
  const prisma = {
    pickupPlace: {
      findUnique: jest.fn().mockResolvedValue({ id: 'pp1' }),
      delete: deleteImpl,
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PickupPlacesService(prisma as any);
}

describe('PickupPlacesService — removing a place', () => {
  it('removes a place no order names', async () => {
    const service = makeService(jest.fn().mockResolvedValue({}));
    await expect(service.remove('pp1')).resolves.toEqual({ deleted: true });
  });

  it('a place orders still name is refused with a reason, not a 500', async () => {
    const service = makeService(jest.fn().mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' })));
    await expect(service.remove('pp1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove('pp1')).rejects.toMatchObject({ message: 'pickup_place_in_use' });
  });
});
