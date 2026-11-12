import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, WarehouseReturn } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import type { VozvratPayload } from '../vozvrat/vozvrat-payload';
import { OmborBot, esc } from './ombor-bot';
import {
  initDataTekshir,
  kalitOl,
  omborTekshir,
  yakuniyAybdorlar,
  type Aybdor,
  type OmborTovar,
  type ReturnView,
  type Tovar,
} from './ombor-rules';

/** A signed-in storekeeper. Roles are read fresh on every call. */
export interface OmborUser {
  telegramId: string;
  name: string;
  roles: string[];
}

const SESSION_HOURS = 12;
/** A return not taken in for this long is reminded about, once per this long. */
export const ESLATMA_SOAT = 3;
const HOUR = 3_600_000;
/** Order numbers named in one reminder (audit, 07.11.2026). */
const ESLATMA_RAQAM = 20;

/**
 * Where a return is taken in (owner, 07.11.2026): our warehouse by a
 * storekeeper (omborchi), our shop by its own responsible person (dokonchi),
 * on the same page and the same way. A supplier takes it with no one counting.
 */
export type Joy = 'warehouse' | 'store';
export const JOYLAR: Joy[] = ['warehouse', 'store'];
export const JOY_ROLE: Record<Joy, string> = { warehouse: 'omborchi', store: 'dokonchi' };
const STAFF_ROLES = Object.values(JOY_ROLE);
/**
 * The allowed roles out of what was sent, de-duplicated, in a fixed order
 * (omborchi, dokonchi); none left is refused (owner, 09.11.2026).
 */
export function staffRoles(raw: unknown): string[] {
  const given = Array.isArray(raw) ? (raw as unknown[]) : [];
  const roles = STAFF_ROLES.filter((r) => given.includes(r));
  if (!roles.length) throw new BadRequestException('roles');
  return roles;
}
/** "…га келяпти", "…да қабул қилинмаган". */
const JOYGA: Record<Joy, string> = { warehouse: 'омборга', store: 'дўконга' };
const JOYDA: Record<Joy, string> = { warehouse: 'омборда', store: 'дўконда' };

type ProductRow = { id: number; name: string; unit: string | null; hodovoy: boolean | null; status: string; addedBy: string | null; firstReturnNumber: number | null };

/**
 * Omborchi (owner, 05.11.2026): the warehouse side of a vozvrat, on this
 * server instead of the mini app. A return the seller confirmed lands here;
 * the storekeepers are told; one counts it, photographs each item and takes
 * it in — which frees the driver's "Topshirdim". Dispatchers and admins see
 * the count on the site's Vozvrat page.
 */
@Injectable()
export class OmborService {
  private readonly logger = new Logger(OmborService.name);
  private readonly sessionKey: Buffer;
  /** Where the photo service puts a warehouse photo: an accepted URL starts with one of these. */
  private readonly photoPrefixes: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: UploadService,
    private readonly bot: OmborBot,
    config: ConfigService<Env, true>,
  ) {
    // Its own key, derived: a warehouse pass is never a dashboard login.
    this.sessionKey = createHmac('sha256', config.get('JWT_ACCESS_SECRET', { infer: true })).update('ombor-session').digest();
    this.photoPrefixes = omborPhotoPrefixes(config);
  }

  // ---- sign-in -----------------------------------------------------------

  /** Telegram's initData → a pass for this page, if the person is on the list. */
  async session(initData: string, now = Date.now()): Promise<{ token: string; user: OmborUser }> {
    if (!this.bot.token) throw new UnauthorizedException('Бот уланмаган');
    const r = initDataTekshir(initData, this.bot.token, { hozir: now });
    if (!r.ok) throw new UnauthorizedException(r.xato);
    const staff = await this.prisma.vozvratStaff.findUnique({ where: { telegramId: r.uid } });
    if (!staff || staff.roles.length === 0) throw new ForbiddenException('Рухсат йўқ');
    const body = Buffer.from(JSON.stringify({ tg: r.uid, exp: now + SESSION_HOURS * HOUR })).toString('base64url');
    const sig = createHmac('sha256', this.sessionKey).update(body).digest('base64url');
    return { token: `${body}.${sig}`, user: { telegramId: staff.telegramId, name: staff.name, roles: staff.roles } };
  }

  /** The pass → who it is, as the list has them now. */
  async auth(token: string | undefined, now = Date.now()): Promise<OmborUser> {
    const [body, sig] = (token ?? '').split('.');
    if (!body || !sig) throw new UnauthorizedException('Қайта киринг');
    const want = createHmac('sha256', this.sessionKey).update(body).digest('base64url');
    if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) throw new UnauthorizedException('Қайта киринг');
    let p: { tg?: string; exp?: number };
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Қайта киринг');
    }
    if (!p.tg || !p.exp || p.exp < now) throw new UnauthorizedException('Қайта киринг');
    const staff = await this.prisma.vozvratStaff.findUnique({ where: { telegramId: p.tg } });
    if (!staff || staff.roles.length === 0) throw new ForbiddenException('Рухсат йўқ');
    return { telegramId: staff.telegramId, name: staff.name, roles: staff.roles };
  }

  // ---- a return arrives ----------------------------------------------------

  /**
   * The seller confirmed the driver's write-up: it is the warehouse's or the
   * shop's now — once per order and place. (owner, 07.11.2026) Only the places
   * its stops go to get a row and a message: warehouse → omborchi, store →
   * dokonchi; a supplier-only return gets nothing. Returns the places taken.
   */
  async receive(orderId: string, payload: VozvratPayload): Promise<Joy[]> {
    const joylar = await this.destinationsOf(orderId);
    const yangi: Joy[] = [];
    for (const joy of joylar) {
      const exists = await this.prisma.warehouseReturn.findUnique({
        where: { orderId_destination: { orderId, destination: joy } },
        select: { id: true },
      });
      if (!exists) yangi.push(joy);
    }
    if (!yangi.length) return [];
    const orderNumber = Number(payload.id);
    const items: Tovar[] = [];
    for (const t of payload.tovarlar) {
      const item: Tovar = {
        nom: t.nom,
        soni: t.soni,
        birlik: t.birlik ?? '',
        holat: t.holat,
        sabab: t.sabab,
        ...('izoh_sabab' in t ? { izoh_sabab: t.izoh_sabab, aybdor: t.aybdor as Aybdor } : {}),
        rasmlar: t.rasmlar ?? [],
        mahsulot_id: t.mahsulot_id ?? null,
      };
      const m = await this.bindProduct(item.nom, item.mahsulot_id ?? null, `Ҳайдовчи ${payload.haydovchi}`, orderNumber, item.birlik);
      item.mahsulot_id = m?.id ?? null;
      if (m?.status === 'tasdiq') item.nom = m.name;
      items.push(item);
    }
    const taken: Joy[] = [];
    for (const joy of yangi) {
      try {
        await this.prisma.warehouseReturn.create({
          data: {
            orderId,
            orderNumber,
            destination: joy,
            at: new Date(payload.sana),
            driverName: payload.haydovchi,
            clientName: payload.mijoz,
            sellerName: payload.sotuvchi,
            comment: payload.izoh || null,
            items: items as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        // Two sends of the same return at once: the first one stands.
        if ((err as { code?: string }).code === 'P2002') continue;
        throw err;
      }
      taken.push(joy);
      // (owner, 07.11.2026) One list for the whole order: when part of it goes
      // to the other place, each side counts what came and writes 0 for the rest.
      const qismi = joylar.length > 1 ? '\nБу возвратнинг бир қисми бошқа жойга кетади — келмаган товарга 0 ёзинг.' : '';
      await this.bot.send(
        await this.staffWith(JOY_ROLE[joy]),
        `📦 <b>Возврат №${orderNumber} ${JOYGA[joy]} келяпти</b>\nОлиб келяпти: Ҳайдовчи ${esc(payload.haydovchi)}\n` +
          `Мижоз: ${esc(payload.mijoz)} · Сотувчи: ${esc(payload.sotuvchi)}\n\n${tovarQator(items)}\n\n` +
          `Келганда санаб, ҳар товарни расмга олиб, қабул қилинг.${qismi}`,
      );
    }
    return taken;
  }

  /**
   * The places this order's returned stops go to that take a return in
   * (owner, 07.11.2026). Destinations are per stop; a supplier is left out.
   * A stop with no place (an old row) goes to the warehouse, as it did before.
   */
  private async destinationsOf(orderId: string): Promise<Joy[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { returnDestination: true, pickupSources: { where: { returnRequired: true }, select: { returnDestination: true } } },
    });
    if (!order) return [];
    const raw = order.pickupSources.length ? order.pickupSources.map((p) => p.returnDestination) : [order.returnDestination];
    const set = new Set(raw.map((d) => d ?? 'warehouse'));
    return JOYLAR.filter((j) => set.has(j));
  }

  // ---- the storekeeper -------------------------------------------------------

  async list(user: OmborUser): Promise<ReturnView[]> {
    // (owner, 07.11.2026) A storekeeper sees the warehouse's, a shop person the shop's.
    const destination = { in: this.joylar(user) };
    // (audit, 07.11.2026) One "newest 150" across both kinds dropped old returns
    // still waiting to be taken in once 150 newer ones existed — they vanished
    // from the page for good. Every waiting one is listed; of the done ones, the newest 50.
    // (owner, 07.11.2026) One the office released with no count yet still
    // waits for its count, so it is listed with the waiting ones.
    const [waiting, done] = await Promise.all([
      this.prisma.warehouseReturn.findMany({
        where: { destination, OR: [{ acceptedAt: null }, SANASH_KERAK] },
        orderBy: { orderNumber: 'desc' },
      }),
      this.prisma.warehouseReturn.findMany({
        where: { destination, acceptedAt: { not: null }, NOT: SANASH_KERAK },
        orderBy: { orderNumber: 'desc' },
        take: 50,
      }),
    ]);
    return this.views([...waiting, ...done].sort((a, b) => b.orderNumber - a.orderNumber));
  }

  /** One photo, stored; its address goes with the count. */
  async photo(user: OmborUser, base64: string): Promise<{ url: string }> {
    this.joylar(user);
    if (typeof base64 !== 'string' || base64.length < 100 || base64.length > 10_000_000) throw new BadRequestException('Расм нотўғри');
    return { url: await this.upload.uploadBase64(base64, 'ombor') };
  }

  /** The storekeeper's count: every item, its photos and one of them all together. */
  async accept(
    user: OmborUser,
    orderNumber: number,
    body: { malumot?: unknown; rasmlar?: Record<string, unknown>; umumiy?: unknown },
    joy?: string,
  ): Promise<{ ok: true }> {
    // (owner, 07.11.2026) Only the place one works at: a storekeeper cannot
    // take a shop's return in, nor a shop person the warehouse's. `joy` names
    // the row when the order has one for each and the person holds both roles.
    const meniki = this.joylar(user);
    const rows = await this.prisma.warehouseReturn.findMany({
      where: { orderNumber, ...(joy ? { destination: joy } : {}) },
    });
    if (!rows.length) throw new NotFoundException('Возврат топилмади');
    const mine = rows.filter((x) => meniki.includes(x.destination as Joy));
    if (!mine.length) throw new ForbiddenException('Бу возврат сизнинг жойингизга эмас');
    // (owner, 07.11.2026) Released by the office with no count yet: the count
    // and photos may still come, once — a late count.
    const r = mine.find((x) => !x.acceptedAt) ?? mine.find(sanashKerak) ?? mine[0];
    const kech = !!r.acceptedAt && sanashKerak(r);
    if (r.acceptedAt && !kech) throw new ConflictException('Бу возврат қабул қилинган');
    const tovarlar = r.items as unknown as Tovar[];
    const t = omborTekshir(body.malumot, tovarlar);
    if ('xato' in t) throw new BadRequestException(t.xato);
    const rasmlar = body.rasmlar ?? {};
    // (audit, 07.11.2026) Any http(s) address used to pass, so a count could
    // point at a photo from anywhere, or the same photo for every item. Only a
    // photo this server stored for the warehouse is taken, each one once.
    const isUrl = (u: unknown): u is string =>
      typeof u === 'string' && /^https?:\/\/\S{4,1000}$/.test(u) && this.photoPrefixes.some((p) => u.startsWith(p));
    const ishlatilgan = new Set<string>();
    const birMarta = (u: string) => {
      if (ishlatilgan.has(u)) throw new BadRequestException('Битта расм икки марта юборилган — ҳар бирини алоҳида олинг');
      ishlatilgan.add(u);
    };
    for (let i = 0; i < t.v.length; i++) {
      // (audit, 07.11.2026) Nothing of this item came (0): there is nothing to
      // photograph or judge, and asking for it left the return stuck for good.
      if (t.v[i].soni === 0) {
        const u = rasmlar[`${i}u`];
        if (isUrl(u)) {
          birMarta(u);
          t.v[i].rasm = { u };
        }
        continue;
      }
      for (const k of t.v[i].holat === 'yaroqsiz' ? (['u', 'y'] as const) : (['u'] as const)) {
        const u = rasmlar[`${i}${k}`];
        if (!isUrl(u)) throw new BadRequestException(`${i + 1}-товар: ${k === 'u' ? 'умумий расмни' : 'яроқсиз жойининг расмини'} олинг`);
        birMarta(u);
        (t.v[i].rasm ??= {})[k] = u;
      }
    }
    // Nothing came at all: no photo of it either (audit, 07.11.2026).
    const hechNarsa = t.v.every((x) => x.soni === 0);
    let umumiy: string | null = null;
    if (isUrl(body.umumiy)) {
      birMarta(body.umumiy);
      umumiy = body.umumiy;
    } else if (!hechNarsa) throw new BadRequestException('Ҳаммасини битта умумий расмга олинг');
    // (audit, 07.11.2026) The claim comes first: a storekeeper who lost the race
    // to another one used to add the names he wrote to the product list anyway.
    const now = new Date();
    const count = {
      answer: t.v as unknown as Prisma.InputJsonValue,
      answerComment: t.izoh || null,
      overallPhotoUrl: umumiy,
      acceptedByTelegramId: user.telegramId,
      acceptedByName: user.name,
    };
    // (owner, 07.11.2026) A late count fills the count, photos and the
    // storekeeper's name; the office's release time stays, and the driver was
    // freed then already. Conditional on no count yet, so it happens once.
    // (owner, 07.11.2026) Taking it in and freeing the driver are one step:
    // the claim and the driver's flag commit together or not at all. The
    // product binding below stays outside (a P2002 inside aborts a Postgres tx).
    await this.prisma.$transaction(async (tx) => {
      const done = kech
        ? await tx.warehouseReturn.updateMany({ where: { id: r.id, ...SANASH_KERAK }, data: count })
        : await tx.warehouseReturn.updateMany({ where: { id: r.id, acceptedAt: null }, data: { ...count, acceptedAt: now } });
      if (done.count === 0) throw new ConflictException('Бу возврат қабул қилинган');
      // The driver's "Topshirdim" opens from here.
      if (!kech) await this.openForDriver(tx, r.orderId, r.destination as Joy, now);
    });
    // Only the winner ties the names to the list. Should that fail, the count
    // stands as written (the names as he typed them).
    try {
      for (const x of t.v) {
        const m = await this.bindProduct(x.nom, x.mahsulot_id, `Омборчи ${user.name}`, orderNumber, '');
        x.mahsulot_id = m?.id ?? null;
        if (m?.status === 'tasdiq') x.nom = m.name;
      }
      await this.prisma.warehouseReturn.update({ where: { id: r.id }, data: { answer: t.v as unknown as Prisma.InputJsonValue } });
    } catch (err) {
      this.logger.warn(`ombor №${orderNumber}: product names not tied to the list: ${(err as Error).message}`);
    }
    return { ok: true };
  }

  /**
   * The office marks a waiting return as taken in (owner, 07.11.2026) — no
   * count, no photos: it opens the driver's "Topshirdim" the way the
   * storekeeper's acceptance does. Only while no one has taken it in yet.
   */
  async release(id: string, userId: string): Promise<{ ok: true }> {
    const r = await this.prisma.warehouseReturn.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('warehouse_return_not_found');
    const joy = r.destination as Joy;
    if (r.acceptedAt) {
      // (owner, 07.11.2026) Taken in, yet the driver was never freed (an old
      // two-step accept that stopped half-way): pressing it again frees him.
      const order = await this.prisma.order.findUnique({
        where: { id: r.orderId },
        select: { returnWarehouseAcceptedAt: true, returnStoreAcceptedAt: true },
      });
      const flag = joy === 'store' ? order?.returnStoreAcceptedAt : order?.returnWarehouseAcceptedAt;
      if (order && flag == null) {
        await this.openForDriver(this.prisma, r.orderId, joy, new Date());
        return { ok: true };
      }
      throw new ConflictException('return_already_accepted');
    }
    const who = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const now = new Date();
    // (owner, 07.11.2026) The mark and the driver's flag in one step.
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.warehouseReturn.updateMany({
        where: { id: r.id, acceptedAt: null },
        // (owner, 07.11.2026) Marked, so the storekeeper's count may follow later.
        data: { acceptedAt: now, acceptedByName: `${who?.name ?? 'Ofis'} (ofis)`, acceptedByTelegramId: null, releasedByOffice: true },
      });
      if (done.count === 0) throw new ConflictException('return_already_accepted');
      await this.openForDriver(tx, r.orderId, joy, now);
    });
    return { ok: true };
  }

  async searchProducts(user: OmborUser, q: string) {
    this.joylar(user);
    const k = String(q || '').trim().toLowerCase().replace(/ё/g, 'е');
    if (!k) return [];
    const all = await this.products();
    const bal = (n: string) => {
      const x = n.toLowerCase().replace(/ё/g, 'е');
      return x.startsWith(k) ? 0 : x.split(/[\s\-/(),.]+/).some((w) => w.startsWith(k)) ? 1 : x.includes(k) ? 2 : 9;
    };
    return all
      .map((m) => [bal(m.name), m] as const)
      .filter(([b]) => b < 9)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      .slice(0, 10)
      .map(([, m]) => productView(m));
  }

  // ---- who may open it (the admin, on the Xodimlar page) -----------------------

  staffList() {
    return this.prisma.vozvratStaff.findMany({ orderBy: { name: 'asc' } }).then((rows) =>
      rows.map((s) => ({ id: s.id, telegram_id: s.telegramId, name: s.name, roles: s.roles })),
    );
  }

  /**
   * Add a person (the add form). (owner, 09.11.2026) One person may hold both
   * roles: adding a Telegram id that is already on the list MERGES the new
   * roles into the old ones — re-adding oneself as dokonchi no longer drops omborchi.
   */
  async staffSave(b: { telegram_id?: unknown; name?: unknown; roles?: unknown }) {
    const telegramId = String(b.telegram_id ?? '').trim();
    if (!/^\d{4,16}$/.test(telegramId)) throw new BadRequestException('telegram_id');
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    if (!name) throw new BadRequestException('name');
    // (owner, 07.11.2026) The shop's person (dokonchi) is kept on the same list.
    const roles = staffRoles(b.roles);
    const old = await this.prisma.vozvratStaff.findUnique({ where: { telegramId } });
    const s = await this.prisma.vozvratStaff.upsert({
      where: { telegramId },
      create: { telegramId, name, roles },
      update: { name, roles: staffRoles([...(old?.roles ?? []), ...roles]) },
    });
    return { id: s.id, telegram_id: s.telegramId, name: s.name, roles: s.roles };
  }

  /** The list's checkboxes save the exact set given (owner, 09.11.2026); an empty set is refused. */
  async staffSetRoles(id: string, rolesIn: unknown) {
    const roles = staffRoles(rolesIn);
    const found = await this.prisma.vozvratStaff.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('staff');
    const s = await this.prisma.vozvratStaff.update({ where: { id }, data: { roles } });
    return { id: s.id, telegram_id: s.telegramId, name: s.name, roles: s.roles };
  }

  async staffRemove(id: string) {
    await this.prisma.vozvratStaff.deleteMany({ where: { id } });
    return { ok: true as const };
  }

  // ---- reminders -------------------------------------------------------------------

  /** Returns not taken in for three hours: one message to the storekeepers, at most once every three hours each. */
  async remind(now = new Date()): Promise<number> {
    const edge = new Date(now.getTime() - ESLATMA_SOAT * HOUR);
    const due = await this.prisma.warehouseReturn.findMany({
      where: {
        acceptedAt: null,
        createdAt: { lte: edge },
        OR: [{ remindedAt: null }, { remindedAt: { lte: edge } }],
      },
      select: { id: true, orderNumber: true, destination: true },
      orderBy: { orderNumber: 'asc' },
    });
    if (!due.length) return 0;
    // (owner, 07.11.2026) Each place reminds its own people of its own returns.
    let marked = 0;
    for (const joy of JOYLAR) {
      const own = due.filter((d) => (d.destination ?? 'warehouse') === joy);
      if (own.length) marked += await this.remindAt(joy, own, now);
    }
    return marked;
  }

  private async remindAt(joy: Joy, due: { id: string; orderNumber: number }[], now: Date): Promise<number> {
    // (audit, 07.11.2026) Hundreds of numbers overran Telegram's 4096 characters
    // and the reminder was refused; and a reminder no one got still counted as
    // sent, so the next try waited three more hours. Twenty numbers at most, and
    // marked reminded only when it reached someone.
    const raqamlar = due.slice(0, ESLATMA_RAQAM).map((d) => d.orderNumber).join(', №');
    const yana = due.length > ESLATMA_RAQAM ? ` … яна ${due.length - ESLATMA_RAQAM} та` : '';
    const sent = await this.bot.send(
      await this.staffWith(JOY_ROLE[joy]),
      `⏰ <b>Эслатма</b>: ${due.length} та возврат ${JOYDA[joy]} қабул қилинмаган (№${raqamlar}${yana}).\n` +
        'Санаб, расмга олиб, «Қабул қилдим»ни босинг.',
    );
    if (sent <= 0) return 0;
    await this.prisma.warehouseReturn.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { remindedAt: now } });
    return due.length;
  }

  // ---- helpers -------------------------------------------------------------------

  /** The places this person takes returns in at; none → no entry (owner, 07.11.2026). */
  private joylar(user: OmborUser): Joy[] {
    const j = JOYLAR.filter((x) => user.roles.includes(JOY_ROLE[x]));
    if (!j.length) throw new ForbiddenException('Рухсат йўқ');
    return j;
  }

  /** Taken in: the driver may hand over his stops bound for this place. */
  private async openForDriver(db: Prisma.TransactionClient, orderId: string, joy: Joy, now: Date): Promise<void> {
    if (joy === 'store') {
      await db.order.updateMany({ where: { id: orderId, returnStoreAcceptedAt: null }, data: { returnStoreAcceptedAt: now } });
    } else {
      await db.order.updateMany({ where: { id: orderId, returnWarehouseAcceptedAt: null }, data: { returnWarehouseAcceptedAt: now } });
    }
  }

  private async staffWith(role: string): Promise<string[]> {
    // A muted person still works on the page; only the messages skip him (owner, 11.11.2026).
    const rows = await this.prisma.vozvratStaff.findMany({ where: { roles: { has: role }, muted: false }, select: { telegramId: true } });
    return rows.map((r) => r.telegramId);
  }

  private productCache: { at: number; rows: ProductRow[] } | null = null;

  /** The whole list (under a thousand rows), kept for a minute. */
  async products(now = Date.now()): Promise<ProductRow[]> {
    if (this.productCache && now - this.productCache.at < 60_000) return this.productCache.rows;
    const rows = await this.prisma.vozvratProduct.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, unit: true, hodovoy: true, status: true, addedBy: true, firstReturnNumber: true },
    });
    this.productCache = { at: now, rows };
    return rows;
  }

  /**
   * A written name tied to the list: the picked product; else the same name;
   * else a new one, added as "yangi" (owner: no one confirms them).
   */
  private async bindProduct(nom: string, id: number | null, who: string, returnNumber: number, unit: string | undefined): Promise<ProductRow | null> {
    // (owner, 07.11.2026) Never throws: a bad catalogue id (or any lookup
    // error) used to fail the seller's receive on every retry, for good. It
    // falls back to no binding, with a warning.
    try {
      return await this.bindProductOrThrow(nom, catalogueRowId(id), who, returnNumber, unit);
    } catch (err) {
      this.logger.warn(`ombor №${returnNumber}: "${nom}" (id ${String(id)}) not tied to the list: ${(err as Error).message}`);
      return null;
    }
  }

  private async bindProductOrThrow(nom: string, id: number | null, who: string, returnNumber: number, unit: string | undefined): Promise<ProductRow | null> {
    if (id != null) {
      const r = await this.prisma.vozvratProduct.findUnique({ where: { id } });
      if (r) return r;
    }
    const key = kalitOl(nom);
    if (!key) return null;
    const found = await this.prisma.vozvratProduct.findUnique({ where: { key } });
    if (found) return found;
    let created: ProductRow;
    try {
      created = await this.prisma.vozvratProduct.create({
        data: { name: nom, key, unit: unit || null, status: 'yangi', addedBy: who, firstReturnNumber: returnNumber },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return this.prisma.vozvratProduct.findUnique({ where: { key } });
      throw err;
    }
    this.productCache = null;
    return created;
  }

  private async views(rows: WarehouseReturn[]): Promise<ReturnView[]> {
    const byId = new Map((await this.products()).map((m) => [m.id, m]));
    return rows.map((r) => {
      const items = (r.items as unknown as Tovar[]).map((t) => {
        const m = t.mahsulot_id != null ? byId.get(t.mahsulot_id) : undefined;
        return { ...t, hodovoy: m ? m.hodovoy : null, yangiMahsulot: !!m && m.status === 'yangi' };
      });
      const answer = (r.answer as unknown as OmborTovar[] | null) ?? null;
      return {
        id: r.orderNumber,
        joy: r.destination as Joy,
        sana: r.at.toISOString(),
        haydovchi: r.driverName,
        mijoz: r.clientName,
        sotuvchi: r.sellerName,
        izoh: r.comment ?? '',
        holat: r.acceptedAt ? 'qabul' : 'ombor',
        tovarlar: items,
        aybdorlar: yakuniyAybdorlar(items, answer),
        omborJavob: answer,
        omborIzoh: r.answerComment ?? '',
        omborVaqt: r.acceptedAt?.toISOString() ?? null,
        omborUmumiy: r.overallPhotoUrl,
        omborchi: r.acceptedByName,
        // (owner, 07.11.2026) The office released it; the count is still to come.
        sanash: !!r.acceptedAt && sanashKerak(r),
      };
    });
  }
}

/** Postgres INTEGER's top: a larger "id" cannot be a catalogue row. */
const INT4_MAX = 2_147_483_647;

/**
 * A catalogue row id, or null when it cannot be one (owner, 07.11.2026):
 * only a positive whole number up to 2147483647 is looked up.
 */
export function catalogueRowId(id: unknown): number | null {
  const n = typeof id === 'string' && id.trim() !== '' ? Number(id) : id;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= INT4_MAX ? n : null;
}

/** Released by the office with no count yet (owner, 07.11.2026). */
const SANASH_KERAK = { releasedByOffice: true, acceptedByTelegramId: null } satisfies Prisma.WarehouseReturnWhereInput;
const sanashKerak = (r: Pick<WarehouseReturn, 'releasedByOffice' | 'acceptedByTelegramId'>) =>
  r.releasedByOffice && r.acceptedByTelegramId == null;

function productView(m: ProductRow) {
  return {
    id: m.id,
    nom: m.name,
    birlik: m.unit ?? '',
    hodovoy: m.hodovoy,
    holat: m.status,
    qoshgan: m.addedBy ?? '',
    vozvratId: m.firstReturnNumber,
  };
}

function tovarQator(tv: Tovar[]): string {
  return (
    tv
      .slice(0, 5)
      .map((t) => `• ${esc(t.nom)} — ${t.soni}${t.birlik ? ' ' + esc(t.birlik) : ''}`)
      .join('\n') + (tv.length > 5 ? `\n… яна ${tv.length - 5} та` : '')
  );
}

/**
 * (audit, 07.11.2026) The address a warehouse photo gets, decided the way
 * UploadService decides it (S3, else Cloudinary, else this server's disk at
 * MEDIA_PUBLIC_URL). UploadService keeps its base private, so the same
 * settings are read here.
 */
export function omborPhotoPrefixes(config: ConfigService<Env, true>): string[] {
  const s3 = config.get('S3_PUBLIC_URL', { infer: true });
  if (config.get('S3_ENDPOINT', { infer: true }) && s3 && config.get('S3_ACCESS_KEY', { infer: true }) && config.get('S3_SECRET_KEY', { infer: true })) {
    return [`${s3.replace(/\/+$/, '')}/ombor/`];
  }
  const cloud = config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
  if (cloud && config.get('CLOUDINARY_API_KEY', { infer: true }) && config.get('CLOUDINARY_API_SECRET', { infer: true })) {
    return [`https://res.cloudinary.com/${cloud}/image/upload/`];
  }
  const media = config.get('MEDIA_PUBLIC_URL', { infer: true }) ?? `http://localhost:${config.get('PORT', { infer: true })}/media`;
  return [`${media.replace(/\/+$/, '')}/ombor/`];
}
