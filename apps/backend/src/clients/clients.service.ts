import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ClientFilterInput,
  ClientPublic,
  CreateClientInput,
  Page,
  Role,
  UpdateClientInput,
} from '@bigant/shared';
import { DEFAULT_PAGE_SIZE } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toPublic as addressToPublic } from './client-addresses.service';

const CLIENT_INCLUDE = {
  region: true,
  district: true,
  seller: { select: { name: true } },
  // The places this client takes deliveries at, the default first: the order
  // form offers them, so it must not need a second request to show them.
  addresses: {
    where: { active: true },
    include: { region: true, district: true },
    orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
  },
} as const satisfies Prisma.ClientInclude;
type ClientRow = Prisma.ClientGetPayload<{ include: typeof CLIENT_INCLUDE }>;

/** What the client's first address is called when nobody has named it. */
const DEFAULT_ADDRESS_LABEL = 'Asosiy manzil';

/** Who is asking. A seller sees and edits their own clients; staff see all. */
export type ClientActor = { userId: string; role: Role };

const isStaff = (a: ClientActor) => a.role === 'admin' || a.role === 'manager';

/**
 * Whether a client may be used by this actor. Everything that takes a client id
 * from a seller — the client pages, booking a truck, creating an order, the po
 * puti search — asks this; otherwise a guessed id would book for another
 * seller's customer.
 */
export function clientVisibleTo(client: { sellerId: string | null }, actor: ClientActor): boolean {
  return isStaff(actor) || client.sellerId === actor.userId;
}

/**
 * Each client belongs to one seller. A seller's list, search, detail and edit
 * are limited to their own; another seller's client does not exist for them —
 * it answers 404, not 403, so its existence is not revealed either. Staff see
 * every client with whose it is, and are the only ones who choose or change
 * the owner.
 */
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateClientInput, actor: ClientActor): Promise<ClientPublic> {
    // A seller's new client is theirs, whatever the body says; staff pick one
    // (or none — staff-only until assigned).
    const sellerId = isStaff(actor) ? await this.sellerOrNull(input.seller_id) : actor.userId;
    const client = await this.prisma.client.create({
      data: {
        name: input.name,
        phoneNumber: input.phone_number,
        regionCode: input.region_code,
        // Empty string (non-Tashkent region has no district picker) → null, not a bad FK.
        districtCode: input.district_code || null,
        address: input.address ?? null,
        location: input.location ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        createdById: actor.userId,
        sellerId,
        oneOff: input.one_off ?? false,
        // The place it was entered with becomes its first address, so every
        // client has somewhere to deliver to from the moment it exists — and
        // the second branch is added next to it rather than instead of it.
        addresses: {
          create: {
            label: DEFAULT_ADDRESS_LABEL,
            address: input.address ?? null,
            lat: input.lat ?? null,
            lng: input.lng ?? null,
            regionCode: input.region_code,
            districtCode: input.district_code || null,
            isDefault: true,
          },
        },
      },
      include: CLIENT_INCLUDE,
    });
    return this.toPublic(client);
  }

  /** The owner scope first, then the search inside it. */
  private buildWhere(actor: ClientActor, filters: ClientFilterInput): Prisma.ClientWhereInput {
    // A one-off is not in the address book. It exists only so its own order has
    // a client; nobody searches for it, and the list is for names you return to.
    const listed: Prisma.ClientWhereInput = { oneOff: false };
    const scope: Prisma.ClientWhereInput = isStaff(actor)
      ? filters.seller_id === 'none'
        ? { sellerId: null }
        : filters.seller_id
          ? { sellerId: filters.seller_id }
          : {}
      : { sellerId: actor.userId };
    const q = filters.search?.trim();
    if (!q) return { AND: [listed, scope] };
    return {
      AND: [
        listed,
        scope,
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phoneNumber: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
            { region: { name: { contains: q, mode: 'insensitive' } } },
            { district: { name: { contains: q, mode: 'insensitive' } } },
            // Staff can find a client by its seller's name too.
            ...(isStaff(actor) ? [{ seller: { name: { contains: q, mode: 'insensitive' as const } } }] : []),
          ],
        },
      ],
    };
  }

  /** Bounded: this used to return every client in the database. Callers that
   *  need more should page, or narrow with `search`. */
  async findAll(filters: ClientFilterInput, actor: ClientActor): Promise<ClientPublic[]> {
    const clients = await this.prisma.client.findMany({
      where: this.buildWhere(actor, filters),
      orderBy: { createdAt: 'desc' },
      include: CLIENT_INCLUDE,
      skip: filters.skip ?? 0,
      take: filters.take ?? DEFAULT_PAGE_SIZE,
    });
    return clients.map((c) => this.toPublic(c));
  }

  async findPage(filters: ClientFilterInput, actor: ClientActor): Promise<Page<ClientPublic>> {
    const where = this.buildWhere(actor, filters);
    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: CLIENT_INCLUDE,
        skip: filters.skip ?? 0,
        take: filters.take ?? DEFAULT_PAGE_SIZE,
      }),
      this.prisma.client.count({ where }),
    ]);
    return { items: clients.map((c) => this.toPublic(c)), total };
  }

  async findOne(id: string, actor: ClientActor): Promise<ClientPublic> {
    return this.toPublic(await this.getVisibleOrThrow(id, actor));
  }

  async update(id: string, input: UpdateClientInput, actor: ClientActor): Promise<ClientPublic> {
    const current = await this.getVisibleOrThrow(id, actor);
    // Only staff move a client between sellers; a seller sending it changes
    // nothing. Unchanged owner = no check, so a client of a seller who has
    // since left can still be edited.
    const reassign = isStaff(actor) && input.seller_id !== undefined && (input.seller_id || null) !== current.sellerId;
    const client = await this.prisma.client.update({
      where: { id },
      data: {
        name: input.name,
        phoneNumber: input.phone_number,
        ...(input.region_code !== undefined && { regionCode: input.region_code }),
        ...(input.district_code !== undefined && { districtCode: input.district_code || null }),
        ...(input.address !== undefined && { address: input.address ?? null }),
        ...(input.location !== undefined && { location: input.location ?? null }),
        // The schema guarantees lat/lng arrive as a pair, so one check covers both.
        ...(input.lat !== undefined && { lat: input.lat, lng: input.lng }),
        ...(reassign && { sellerId: await this.sellerOrNull(input.seller_id) }),
      },
      include: CLIENT_INCLUDE,
    });
    // The client's own address fields and its default address are two views of
    // one place; editing here moves both, as setting a default moves the
    // fields the other way.
    const touchesPlace =
      input.address !== undefined ||
      input.lat !== undefined ||
      input.region_code !== undefined ||
      input.district_code !== undefined;
    if (touchesPlace) {
      const updated = await this.prisma.clientAddress.updateMany({
        where: { clientId: id, isDefault: true },
        data: {
          address: client.address,
          lat: client.lat,
          lng: client.lng,
          regionCode: client.regionCode,
          districtCode: client.districtCode,
        },
      });
      // A client from before addresses existed, whose backfill found nothing
      // to copy, gets its first one here.
      if (updated.count === 0) {
        await this.prisma.clientAddress.create({
          data: {
            clientId: id,
            label: DEFAULT_ADDRESS_LABEL,
            address: client.address,
            lat: client.lat,
            lng: client.lng,
            regionCode: client.regionCode,
            districtCode: client.districtCode,
            isDefault: true,
          },
        });
      }
      return this.toPublic(await this.getVisibleOrThrow(id, actor));
    }
    return this.toPublic(client);
  }

  async remove(id: string, actor: ClientActor): Promise<{ deleted: true }> {
    await this.getVisibleOrThrow(id, actor);
    try {
      await this.prisma.client.delete({ where: { id } });
    } catch (err) {
      // A client with orders behind it cannot be removed: those orders are the
      // record of work done, and they name their customer. The database says
      // so with a foreign-key error, which used to reach the office as a 500
      // and read like a broken system rather than a rule.
      if ((err as { code?: string }).code === 'P2003' || (err as { code?: string }).code === 'P2014') {
        throw new ConflictException('client_has_orders');
      }
      throw err;
    }
    return { deleted: true };
  }

  /** The client, if this actor may see it — the same rule as `clientVisibleTo`. */
  async getVisibleOrThrow(id: string, actor: ClientActor): Promise<ClientRow> {
    const client = await this.prisma.client.findUnique({ where: { id }, include: CLIENT_INCLUDE });
    if (!client || !clientVisibleTo(client, actor)) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  /** A seller id from staff, checked to be an active seller; null/empty = unassigned. */
  private async sellerOrNull(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true, status: true } });
    if (!user || user.role !== 'seller' || user.status !== 'active') {
      throw new BadRequestException('client_seller_invalid');
    }
    return id;
  }

  private toPublic(c: ClientRow): ClientPublic {
    return {
      id: c.id,
      name: c.name,
      phone_number: c.phoneNumber,
      address: c.address,
      location: c.location,
      region_code: c.regionCode,
      region_name: c.region?.name ?? null,
      district_code: c.districtCode,
      district_name: c.district?.name ?? null,
      lat: c.lat,
      lng: c.lng,
      is_city: c.region?.isCity ?? false,
      created_by: c.createdById,
      seller_id: c.sellerId,
      seller_name: c.seller?.name ?? null,
      // A row read without the include (an internal lookup) has none; the
      // list is then empty rather than a crash on the way out.
      addresses: (c.addresses ?? []).map(addressToPublic),
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    };
  }
}
