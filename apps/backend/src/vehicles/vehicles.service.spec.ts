import { completeServiceVisitSchema, logKmSchema } from '@bigant/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';

function vehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    plateNumber: '01A123BC',
    model: 'Isuzu NQR',
    type: 'truck',
    capacityKg: 3000,
    status: 'active',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(existingByPlate: Record<string, unknown> | null = null, byId: Record<string, unknown> | null = vehicle()) {
  const prisma = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue([vehicle()]),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string; plateNumber?: string } }) =>
        Promise.resolve(where.plateNumber !== undefined ? existingByPlate : byId),
      ),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(vehicle(data)),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(vehicle(data)),
      ),
      delete: jest.fn().mockResolvedValue(vehicle()),
    },
    kmRecord: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'km1',
          vehicleId: data.vehicleId,
          km: data.km,
          recordedById: data.recordedById ?? null,
          recordedAt: new Date(),
          needsReview: data.needsReview ?? false,
        }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'km1', vehicleId: 'v1', km: 48500, recordedById: null, recordedAt: new Date() },
      ]),
    },
    vehicleDocument: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'doc1',
          vehicleId: 'v1',
          type: 'insurance',
          number: null,
          issuedAt: null,
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({ id: 'doc1', vehicleId: 'v1' }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'doc1',
          number: null,
          issuedAt: null,
          notes: null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'doc1',
          vehicleId: 'v1',
          type: 'insurance',
          number: null,
          issuedAt: null,
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          notes: null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
    incident: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'inc1',
          vehicleId: 'v1',
          orderId: null,
          type: 'accident',
          description: null,
          occurredAt: new Date(),
          reportedById: null,
          createdAt: new Date(),
          order: null,
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({ id: 'inc1', vehicleId: 'v1' }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'inc1',
          orderId: null,
          description: null,
          reportedById: null,
          createdAt: new Date(),
          order: null,
          ...data,
        }),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u-admin' }, { id: 'u-manager' }]),
      findUnique: jest.fn().mockResolvedValue({ name: 'Bobur' }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
  };
  const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new VehiclesService(prisma as any, notifications as any), prisma, notifications };
}

describe('VehiclesService', () => {
  it('creates a vehicle', async () => {
    const { service, prisma } = makeService(null);
    const res = await service.create({
      plate_number: '01A777ZZ',
      model: 'Damas',
      type: 'van',
      capacity_kg: 500,
    });
    expect(res.plate_number).toBe('01A777ZZ');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicle as any).create).toHaveBeenCalled();
  });

  it('rejects a duplicate plate number', async () => {
    const { service } = makeService(vehicle());
    await expect(
      service.create({ plate_number: '01A123BC', model: 'X', type: 'car' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('filters vehicles by search across plate, model and tech passport', async () => {
    const { service, prisma } = makeService();
    await service.findAll({ search: 'isuzu' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicle as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { plateNumber: { contains: 'isuzu', mode: 'insensitive' } },
            { model: { contains: 'isuzu', mode: 'insensitive' } },
            { techPassport: { contains: 'isuzu', mode: 'insensitive' } },
          ],
          // A switched-off lorry is not offered in the pickers.
          status: { not: 'inactive' },
        },
      }),
    );
  });

  it('updates a vehicle status', async () => {
    const { service, prisma } = makeService(null);
    const res = await service.update('v1', { status: 'maintenance' });
    expect(res.status).toBe('maintenance');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicle as any).update).toHaveBeenCalled();
  });

  it('throws when updating a missing vehicle', async () => {
    const { service } = makeService(null, null);
    await expect(service.update('missing', { model: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never deletes a vehicle: it is switched off and its driver let go, its history kept', async () => {
    const { service, prisma } = makeService(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    p.driver = { ...(p.driver ?? {}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    p.$transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
    await service.remove('v1');
    expect(p.vehicle.delete).not.toHaveBeenCalled();
    expect(p.vehicle.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'inactive' } });
    expect(p.driver.updateMany).toHaveBeenCalledWith({ where: { vehicleId: 'v1' }, data: { vehicleId: null } });
  });

  it('a smaller odometer reading than the last is refused', async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.vehicle as any).findUnique.mockResolvedValue({ id: 'v1', currentKm: 152_300 });
    await expect(service.logKm('v1', 15_230, 'u1')).rejects.toMatchObject({ message: 'km_less_than_previous' });
  });

  // Owner, 07.11.2026: a driver's reading far ahead is kept and flagged, not refused.
  it('driver big jump: saved and flagged, current km unchanged, admins and managers told', async () => {
    const { service, prisma, notifications } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.vehicle as any).findUnique.mockResolvedValue({ id: 'v1', plateNumber: '01 X 111 XX', currentKm: 123_456 });
    const res = await service.logKm('v1', 1_234_567, 'u-driver', 'p.jpg', { aiKm: null, status: 'skipped' });
    expect(res.km).toBe(1_234_567);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.kmRecord as any).create.mock.calls[0][0].data).toMatchObject({ km: 1_234_567, photoUrl: 'p.jpg', needsReview: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicle as any).update).not.toHaveBeenCalled();
    expect(notifications.notifyMany).toHaveBeenCalledWith(['u-admin', 'u-manager'], {
      type: 'km_needs_review',
      title: 'Spidometrni tekshiring',
      body: "01 X 111 XX (Bobur): spidometrda 1 234 567 km kiritildi, oldingisi 123 456 km — farq 1 111 111 km. Rasmni tekshirib, to'g'ri km'ni Transport → mashina sahifasida kiriting.",
    });
  });

  it('driver within 10 000 km: taken as the current km, nobody told', async () => {
    const { service, prisma, notifications } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.vehicle as any).findUnique.mockResolvedValue({ id: 'v1', plateNumber: '01 X 111 XX', currentKm: 123_456 });
    await service.logKm('v1', 133_456, 'u-driver', 'p.jpg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicle as any).update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { currentKm: 133_456 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.kmRecord as any).updateMany).not.toHaveBeenCalled();
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('admin big jump from the console: accepted, current km set, the flags cleared', async () => {
    const { service, prisma, notifications } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.vehicle as any).findUnique.mockResolvedValue({ id: 'v1', plateNumber: '01 X 111 XX', currentKm: 123_456 });
    await expect(service.logKm('v1', 1_234_567, 'u-admin', null, null, { office: true })).resolves.toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.kmRecord as any).create.mock.calls[0][0].data.needsReview).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicle as any).update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { currentKm: 1_234_567 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.kmRecord as any).updateMany).toHaveBeenCalledWith({ where: { vehicleId: 'v1', needsReview: true }, data: { needsReview: false } });
    expect(notifications.notifyMany).not.toHaveBeenCalled();
    // Never backwards, even for the office.
    await expect(service.logKm('v1', 100, 'u-admin', null, null, { office: true })).rejects.toMatchObject({
      message: 'km_less_than_previous',
    });
  });

  it('a failed notice never loses the reading', async () => {
    const { service, prisma, notifications } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.vehicle as any).findUnique.mockResolvedValue({ id: 'v1', plateNumber: '01 X 111 XX', currentKm: 123_456 });
    notifications.notifyMany.mockRejectedValueOnce(new Error('fcm down'));
    await expect(service.logKm('v1', 1_234_567, 'u-driver', 'p.jpg')).resolves.toBeDefined();
  });

  it('POST /vehicles/:id/km passes the office flag', async () => {
    const logKm = jest.fn().mockResolvedValue({ id: 'km1' });
    const controller = new VehiclesController({ logKm } as unknown as VehiclesService);
    await controller.logKm('v1', 'u-admin', { km: 1_250_000 });
    expect(logKm).toHaveBeenCalledWith('v1', 1_250_000, 'u-admin', null, null, { office: true });
  });

  it('logs a km reading and updates the current km', async () => {
    const { service, prisma } = makeService();
    await service.logKm('v1', 48500, 'u1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.kmRecord as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicleId: 'v1', km: 48500, recordedById: 'u1' }),
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicle as any).update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v1' }, data: { currentKm: 48500 } }),
    );
  });

  it('lists km history for a vehicle', async () => {
    const { service, prisma } = makeService();
    const res = await service.listKm('v1');
    expect(res).toHaveLength(1);
    expect(res[0].km).toBe(48500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.kmRecord as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vehicleId: 'v1' } }),
    );
  });

  it('adds a document (parsing the expiry date)', async () => {
    const { service, prisma } = makeService();
    const res = await service.addDocument('v1', { type: 'insurance', expires_at: '2027-01-01' });
    expect(res.expires_at).toContain('2027-01-01');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicleDocument as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicleId: 'v1', type: 'insurance' }),
      }),
    );
  });

  it('lists documents for a vehicle', async () => {
    const { service } = makeService();
    const res = await service.listDocuments('v1');
    expect(res).toHaveLength(1);
    expect(res[0].type).toBe('insurance');
  });

  it('rejects a document that belongs to another vehicle', async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.vehicleDocument as any).findUnique.mockResolvedValueOnce({ id: 'doc1', vehicleId: 'other' });
    await expect(
      service.removeDocument('v1', 'doc1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes a document', async () => {
    const { service, prisma } = makeService();
    await service.removeDocument('v1', 'doc1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicleDocument as any).delete).toHaveBeenCalledWith({ where: { id: 'doc1' } });
  });

  it('flags a vehicle whose document is expiring soon', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000);
    const { service } = makeService(null, vehicle({ documents: [{ expiresAt: soon }] }));
    const res = await service.findOne('v1');
    expect(res.docs_expiry_alert).toBe('soon');
  });

  it('flags a vehicle whose document has expired', async () => {
    const past = new Date(Date.now() - 86_400_000);
    const { service } = makeService(null, vehicle({ documents: [{ expiresAt: past }] }));
    const res = await service.findOne('v1');
    expect(res.docs_expiry_alert).toBe('expired');
  });

  it('adds an incident (defaulting occurredAt to now)', async () => {
    const { service, prisma } = makeService();
    await service.addIncident('v1', { type: 'accident', description: 'bumper' }, 'u1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.incident as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicleId: 'v1', type: 'accident', reportedById: 'u1' }),
      }),
    );
  });

  it('lists incidents for a vehicle', async () => {
    const { service } = makeService();
    const res = await service.listIncidents('v1');
    expect(res).toHaveLength(1);
    expect(res[0].type).toBe('accident');
  });

  it('deletes an incident', async () => {
    const { service, prisma } = makeService();
    await service.removeIncident('v1', 'inc1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.incident as any).delete).toHaveBeenCalledWith({ where: { id: 'inc1' } });
  });
});

describe('km readings over two million are refused at the door (audit, 07.11.2026)', () => {
  it('logKmSchema and completeServiceVisitSchema', () => {
    expect(logKmSchema.safeParse({ km: 2_000_000 }).success).toBe(true);
    expect(logKmSchema.safeParse({ km: 2_000_001 }).success).toBe(false);
    expect(completeServiceVisitSchema.safeParse({ odometer_km: 2_000_001, total_sum: 1, no_receipt: true }).success).toBe(false);
    expect(completeServiceVisitSchema.safeParse({ odometer_km: 150_000, total_sum: 1, no_receipt: true }).success).toBe(true);
  });
});
