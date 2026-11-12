import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_PAGE_SIZE,
  type OrderStatus,
  type VozvratCondition,
  type VozvratCulprit,
  type VozvratListFilterInput,
  type VozvratListPage,
  type VozvratListRow,
  type VozvratReasonCode,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { dayRange } from './date-range';
import type { OmborTovar } from '../ombor/ombor-rules';

/**
 * Every vozvrat the drivers wrote up, for the office: the order, who drove,
 * what came back and who is to blame — plus totals over the whole filter,
 * not just the page, so the tiles and the per-driver table are true.
 */
@Injectable()
export class ReturnsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: VozvratListFilterInput): Promise<VozvratListPage> {
    const createdAt = dayRange(filters.from, filters.to);
    const item: Prisma.OrderReturnItemWhereInput = {
      ...(createdAt.gte || createdAt.lt ? { createdAt } : {}),
      ...(filters.culprit ? { culprit: filters.culprit } : {}),
    };
    const where: Prisma.OrderWhereInput = {
      returnItems: { some: item },
      ...(filters.driver_id ? { assignedDriverId: filters.driver_id } : {}),
    };

    const [orders, total, items] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          returnItems: { orderBy: { createdAt: 'asc' } },
          assignedDriver: { include: { user: { select: { name: true } } } },
          createdBySeller: { select: { name: true } },
          vozvratReport: { select: { status: true } },
          warehouseReturns: { orderBy: { destination: 'asc' } },
        },
        orderBy: { orderNumber: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? DEFAULT_PAGE_SIZE,
      }),
      this.prisma.order.count({ where }),
      this.prisma.orderReturnItem.findMany({
        where: {
          ...item,
          ...(filters.driver_id ? { order: { assignedDriverId: filters.driver_id } } : {}),
        },
        select: {
          orderId: true,
          culprit: true,
          order: {
            select: {
              assignedDriverId: true,
              assignedDriver: { select: { user: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);

    return {
      items: orders.map((o) => ({
        order_id: o.id,
        order_number: o.orderNumber,
        order_status: o.status as OrderStatus,
        returned_at: (o.returnItems[0]?.createdAt ?? o.updatedAt).toISOString(),
        driver_id: o.assignedDriverId,
        driver_name: o.assignedDriver?.user.name ?? null,
        client_name: o.clientName,
        seller_name: o.createdBySeller.name,
        destination: o.returnDestination,
        comment: o.returnReason,
        report_status: (o.vozvratReport?.status as VozvratListRow['report_status']) ?? null,
        items: o.returnItems.map((i) => ({
          id: i.id,
          product_id: i.productId,
          name: i.name,
          unit: i.unit,
          quantity: Number(i.quantity),
          condition: i.condition as VozvratCondition,
          reason: i.reasonCode as VozvratReasonCode,
          other_reason: i.otherReason,
          culprit: (i.culprit as VozvratCulprit | null) ?? null,
          photo_url: i.photoUrl,
        })),
        warehouses: o.warehouseReturns.map(warehouseOf),
      })),
      total,
      summary: summarize(items),
    };
  }
}

/** The storekeeper's count as the Vozvrat page shows it. */
function warehouseOf(w: {
  id: string;
  destination: string;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  answerComment: string | null;
  overallPhotoUrl: string | null;
  answer: Prisma.JsonValue;
}): VozvratListRow['warehouses'][number] {
  const answer = Array.isArray(w.answer) ? (w.answer as unknown as OmborTovar[]) : [];
  return {
    id: w.id,
    destination: w.destination === 'store' ? 'store' : 'warehouse',
    accepted_at: w.acceptedAt?.toISOString() ?? null,
    accepted_by: w.acceptedByName,
    comment: w.answerComment,
    overall_photo_url: w.overallPhotoUrl,
    items: answer.map((a) => ({
      name: a.nom,
      quantity: Number(a.soni),
      condition: a.holat,
      reason: a.sabab,
      other_reason: a.sabab === 'x' ? a.izoh_sabab || null : null,
      culprit: a.aybdor ?? null,
      photo_url: a.rasm?.u ?? null,
      damage_photo_url: a.rasm?.y ?? null,
    })),
  };
}

type ItemFact = {
  orderId: string;
  culprit: string | null;
  order: { assignedDriverId: string | null; assignedDriver: { user: { name: string } } | null };
};

/** Totals over every matching item: by who is to blame and by driver. */
export function summarize(items: ItemFact[]): VozvratListPage['summary'] {
  const byCulprit = new Map<VozvratCulprit | null, number>();
  const byDriver = new Map<string | null, { name: string | null; orders: Set<string>; items: number }>();
  const orders = new Set<string>();
  for (const i of items) {
    orders.add(i.orderId);
    const culprit = (i.culprit as VozvratCulprit | null) ?? null;
    byCulprit.set(culprit, (byCulprit.get(culprit) ?? 0) + 1);
    const key = i.order.assignedDriverId;
    const d = byDriver.get(key) ?? { name: i.order.assignedDriver?.user.name ?? null, orders: new Set(), items: 0 };
    d.orders.add(i.orderId);
    d.items += 1;
    byDriver.set(key, d);
  }
  return {
    returns: orders.size,
    items: items.length,
    by_culprit: [...byCulprit].map(([culprit, n]) => ({ culprit, items: n })).sort((a, b) => b.items - a.items),
    by_driver: [...byDriver]
      .map(([driver_id, d]) => ({ driver_id, driver_name: d.name, returns: d.orders.size, items: d.items }))
      .sort((a, b) => b.returns - a.returns || b.items - a.items),
  };
}
