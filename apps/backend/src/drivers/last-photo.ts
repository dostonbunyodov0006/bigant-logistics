import type { PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'order' | 'orderPickupSource' | 'fuelLog' | 'serviceVisit' | 'telegramReport'>;

/**
 * The time of a driver's last piece of photographed work in [since, until]:
 * a delivery, a return handed back, a fuel fill, a finished service visit, or
 * any photo sent to the groups (the loaded goods at a pickup have no time of
 * their own on the order — their report does). Null when there is none.
 *
 * What the end of his working day is read from when he did not press
 * «Ishni tugatish», and what the evening extra is paid up to.
 */
export async function lastPhotoAt(db: Db, driverId: string, since: Date, until: Date): Promise<Date | null> {
  const inShift = { gte: since, lte: until };
  const [delivered, returned, legReturned, fuel, service, posted] = await Promise.all([
    db.order.aggregate({ where: { assignedDriverId: driverId, deliveredAt: inShift }, _max: { deliveredAt: true } }),
    db.order.aggregate({ where: { assignedDriverId: driverId, returnedAt: inShift }, _max: { returnedAt: true } }),
    db.orderPickupSource.aggregate({ where: { order: { assignedDriverId: driverId }, returnedAt: inShift }, _max: { returnedAt: true } }),
    db.fuelLog.aggregate({ where: { driverId, capturedAt: inShift }, _max: { capturedAt: true } }),
    db.serviceVisit.aggregate({ where: { driverId, completedAt: inShift }, _max: { completedAt: true } }),
    db.telegramReport.aggregate({
      where: {
        createdAt: inShift,
        OR: [{ order: { assignedDriverId: driverId } }, { fuelLog: { driverId } }, { serviceVisit: { driverId } }],
      },
      _max: { createdAt: true },
    }),
  ]);
  const times = [
    delivered._max.deliveredAt,
    returned._max.returnedAt,
    legReturned._max.returnedAt,
    fuel._max.capturedAt,
    service._max.completedAt,
    posted._max.createdAt,
  ].filter((d): d is Date => !!d);
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
}
