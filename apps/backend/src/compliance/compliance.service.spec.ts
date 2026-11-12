import { ComplianceService } from './compliance.service';

const DAY = 86_400_000;

function driverDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ddoc1',
    driverId: 'd1',
    type: 'license',
    number: 'AB123',
    issuedAt: null,
    expiresAt: new Date(Date.now() + 10 * DAY), // soon
    notes: null,
    expiryNotifiedStage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    driver: { user: { name: 'Ali' } },
    ...overrides,
  };
}

function vehicleDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vdoc1',
    vehicleId: 'v1',
    type: 'insurance',
    number: null,
    issuedAt: null,
    expiresAt: new Date(Date.now() - 5 * DAY), // expired
    notes: null,
    expiryNotifiedStage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    vehicle: { plateNumber: '01A123BC' },
    ...overrides,
  };
}

function makeService(driverDocs: unknown[], vehicleDocs: unknown[]) {
  const prisma = {
    driverDocument: {
      findMany: jest.fn().mockResolvedValue(driverDocs),
      update: jest.fn().mockResolvedValue({}),
    },
    vehicleDocument: {
      findMany: jest.fn().mockResolvedValue(vehicleDocs),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }, { id: 'mgr1' }]),
    },
  };
  const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ComplianceService(prisma as any, notifications as any);
  return { service, prisma, notifications };
}

describe('ComplianceService', () => {
  describe('listExpiring', () => {
    it('aggregates counts and sorts most-urgent first', async () => {
      const { service } = makeService([driverDoc()], [vehicleDoc()]);
      const stats = await service.listExpiring();

      expect(stats.total).toBe(2);
      expect(stats.expired_count).toBe(1);
      expect(stats.soon_count).toBe(1);
      // Expired (negative days) sorts before the expiring-soon one.
      expect(stats.documents[0].owner_type).toBe('vehicle');
      expect(stats.documents[0].status).toBe('expired');
      expect(stats.documents[0].owner_label).toBe('01A123BC');
      expect(stats.documents[1].status).toBe('soon');
      expect(stats.documents[1].owner_label).toBe('Ali');
      expect(stats.documents[1].days_until_expiry).toBeGreaterThanOrEqual(9);
    });
  });

  describe('sweepAndNotify', () => {
    it('notifies admins/managers and stamps newly-crossed documents', async () => {
      const { service, prisma, notifications } = makeService([driverDoc()], [vehicleDoc()]);
      const result = await service.sweepAndNotify();

      expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
      const [recipients, payload] = notifications.notifyMany.mock.calls[0];
      expect(recipients).toEqual(['admin1', 'mgr1']);
      expect(payload.type).toBe('document.expiry_reminder');
      expect(prisma.driverDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { expiryNotifiedStage: 'soon' } }),
      );
      expect(prisma.vehicleDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { expiryNotifiedStage: 'expired' } }),
      );
      expect(result.notified).toBe(2);
    });

    it('stamps nothing when the notification fails, so the next sweep tries again', async () => {
      const { service, prisma, notifications } = makeService([driverDoc()], [vehicleDoc()]);
      notifications.notifyMany.mockRejectedValueOnce(new Error('push down'));
      await expect(service.sweepAndNotify()).rejects.toThrow('push down');
      expect(prisma.driverDocument.update).not.toHaveBeenCalled();
      expect(prisma.vehicleDocument.update).not.toHaveBeenCalled();
    });

    it('does not re-notify when documents are already stamped at their current stage', async () => {
      const { service, prisma, notifications } = makeService(
        [driverDoc({ expiryNotifiedStage: 'soon' })],
        [vehicleDoc({ expiryNotifiedStage: 'expired' })],
      );
      const result = await service.sweepAndNotify();

      expect(notifications.notifyMany).not.toHaveBeenCalled();
      expect(prisma.driverDocument.update).not.toHaveBeenCalled();
      expect(prisma.vehicleDocument.update).not.toHaveBeenCalled();
      expect(result.notified).toBe(0);
    });

    it('re-notifies when a document escalates from soon to expired', async () => {
      const { service, prisma, notifications } = makeService(
        [],
        [vehicleDoc({ expiryNotifiedStage: 'soon' })], // was soon, now expired
      );
      await service.sweepAndNotify();

      expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
      expect(prisma.vehicleDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { expiryNotifiedStage: 'expired' } }),
      );
    });
  });
});
