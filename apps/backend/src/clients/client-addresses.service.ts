import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ClientAddressPublic,
  CreateClientAddressInput,
  UpdateClientAddressInput,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { clientVisibleTo, type ClientActor } from './clients.service';

const ADDRESS_INCLUDE = { region: true, district: true } as const;
type AddressRow = Prisma.ClientAddressGetPayload<{ include: typeof ADDRESS_INCLUDE }>;

/**
 * The places one client takes deliveries at.
 *
 * A regular customer has a shop, a second shop and a yard. Keeping them on the
 * client means the seller picks a name and the pin comes with it, instead of
 * describing a location again on every order — and the driver reads a name he
 * recognises rather than a street he has to work out.
 *
 * The order copies the address it was made for. That copy is what the driver
 * drives to, so correcting an address later never moves a delivery that has
 * already happened.
 */
@Injectable()
export class ClientAddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every place of one client, the default first, then by name. */
  async list(clientId: string, actor: ClientActor): Promise<ClientAddressPublic[]> {
    await this.clientOrThrow(clientId, actor);
    const rows = await this.prisma.clientAddress.findMany({
      where: { clientId },
      include: ADDRESS_INCLUDE,
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
    });
    return rows.map(toPublic);
  }

  async create(
    clientId: string,
    input: CreateClientAddressInput,
    actor: ClientActor,
  ): Promise<ClientAddressPublic> {
    await this.clientOrThrow(clientId, actor);
    // The first address of a client is its default whatever the form says:
    // a client with no default would have nothing to offer an order.
    const existing = await this.prisma.clientAddress.count({ where: { clientId } });
    const wantsDefault = input.is_default === true || existing === 0;

    const row = await this.prisma.$transaction(async (tx) => {
      if (wantsDefault) await this.standDown(tx, clientId);
      const created = await tx.clientAddress.create({
        data: {
          clientId,
          label: input.label,
          address: input.address ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          regionCode: input.region_code,
          districtCode: input.district_code || null,
          isDefault: wantsDefault,
        },
        include: ADDRESS_INCLUDE,
      });
      if (wantsDefault) await this.mirrorOntoClient(tx, clientId, created);
      return created;
    });
    return toPublic(row);
  }

  async update(
    id: string,
    input: UpdateClientAddressInput,
    actor: ClientActor,
  ): Promise<ClientAddressPublic> {
    const current = await this.prisma.clientAddress.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('client_address_not_found');
    await this.clientOrThrow(current.clientId, actor);
    // A client must keep somewhere to deliver to: the default cannot be
    // switched off, and the last active address cannot be closed.
    if (input.active === false) {
      if (current.isDefault) throw new ConflictException('client_address_is_default');
      const active = await this.prisma.clientAddress.count({
        where: { clientId: current.clientId, active: true },
      });
      if (active <= 1) throw new ConflictException('client_address_last_one');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const becomesDefault = input.is_default === true && !current.isDefault;
      if (becomesDefault) await this.standDown(tx, current.clientId);
      const saved = await tx.clientAddress.update({
        where: { id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.address !== undefined ? { address: input.address ?? null } : {}),
          ...(input.lat !== undefined ? { lat: input.lat ?? null } : {}),
          ...(input.lng !== undefined ? { lng: input.lng ?? null } : {}),
          ...(input.region_code !== undefined ? { regionCode: input.region_code } : {}),
          ...(input.district_code !== undefined ? { districtCode: input.district_code || null } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(becomesDefault ? { isDefault: true, active: true } : {}),
        },
        include: ADDRESS_INCLUDE,
      });
      if (saved.isDefault) await this.mirrorOntoClient(tx, current.clientId, saved);
      return saved;
    });
    return toPublic(row);
  }

  /**
   * The address an order should go to: the one asked for, else the default.
   * Refuses an address of another client, which is how a mistyped id would
   * otherwise deliver one customer's goods to another's shop.
   */
  async forOrder(clientId: string, addressId: string | null | undefined): Promise<AddressRow | null> {
    if (addressId) {
      const chosen = await this.prisma.clientAddress.findUnique({
        where: { id: addressId },
        include: ADDRESS_INCLUDE,
      });
      if (!chosen || chosen.clientId !== clientId) {
        throw new NotFoundException('client_address_not_found');
      }
      if (!chosen.active) throw new ConflictException('client_address_closed');
      return chosen;
    }
    return this.prisma.clientAddress.findFirst({
      where: { clientId, active: true },
      include: ADDRESS_INCLUDE,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** Only one address per client is the default; the index enforces it too. */
  private async standDown(tx: Prisma.TransactionClient, clientId: string): Promise<void> {
    await tx.clientAddress.updateMany({
      where: { clientId, isDefault: true },
      data: { isDefault: false },
    });
  }

  /**
   * The client row keeps the default address in its own fields. Older screens,
   * the po puti search and every report read it there, so the two must agree.
   */
  private async mirrorOntoClient(
    tx: Prisma.TransactionClient,
    clientId: string,
    address: { address: string | null; lat: number | null; lng: number | null; regionCode: string | null; districtCode: string | null },
  ): Promise<void> {
    await tx.client.update({
      where: { id: clientId },
      data: {
        address: address.address,
        lat: address.lat,
        lng: address.lng,
        ...(address.regionCode ? { regionCode: address.regionCode } : {}),
        districtCode: address.districtCode,
      },
    });
  }

  private async clientOrThrow(clientId: string, actor: ClientActor) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    // A seller asking about another seller's client is told it does not exist,
    // the same answer the client pages give.
    if (!client || !clientVisibleTo(client, actor)) throw new NotFoundException('client_not_found');
    return client;
  }
}

export function toPublic(a: AddressRow): ClientAddressPublic {
  return {
    id: a.id,
    client_id: a.clientId,
    label: a.label,
    address: a.address,
    lat: a.lat,
    lng: a.lng,
    region_code: a.regionCode,
    region_name: a.region?.name ?? null,
    district_code: a.districtCode,
    district_name: a.district?.name ?? null,
    is_default: a.isDefault,
    active: a.active,
  };
}

/**
 * The address text copied onto an order: the place's own name and street, so
 * the driver reads "Chilonzor filiali — Bunyodkor 12" instead of working out
 * which of three shops was meant. Falls back to the client's own field for a
 * client that has no address rows yet.
 */
export function clientAddressText(
  place: { label: string; address: string | null } | null,
  client: { address: string | null },
): string {
  if (!place) return client.address ?? '';
  const street = place.address?.trim();
  return street ? `${place.label} — ${street}` : place.label;
}
