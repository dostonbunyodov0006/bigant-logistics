import ExcelJS from 'exceljs';

/**
 * The bonus workbook, laid out as the mini app's "Рағбатлантириш ва бонус"
 * file the office already reads (owner, 29.10.2026): the same sheets, the same
 * columns, the same colours — without the Рағбат sheet, and with Юк топшириш.
 */

export type Category = 'kichik' | 'orta' | 'katta' | null;

export interface XlsxTrip {
  driver: string;
  category: Category;
  at: Date;
  outside: boolean;
  amount: number;
  photo: boolean;
  note: string | null;
}

export interface XlsxOvertimeDay {
  driver: string;
  category: Category;
  /** The Tashkent day, YYYY-MM-DD. */
  day: string;
  rate: number;
  /** When he started, before 09:00 ("07:23"), or null. */
  started: string | null;
  /** His last photo after 18:00 ("20:54"), or null. */
  finished: string | null;
  minutes: number;
  amount: number;
  morning: boolean;
  evening: boolean;
  /** The evening ended at the Tashkent border, back from a Viloyat. */
  border?: boolean;
}

const MACHINE: Record<string, string> = {
  kichik: 'Кичик (Дамас/Лабо/Ван)',
  orta: 'Ўрта (Газел)',
  katta: 'Катта (Исузу)',
};
const machine = (c: Category) => (c ? MACHINE[c] : '');
const workKind = (c: Category) =>
  c === 'kichik' ? 'Ван/Лабо қўшимча ишлагани учун' : 'Газел/Исузу қўшимча ишлагани учун';

const HEAD_FILL = 'FF2F5597';
const GROUP_FILL = 'FFD9E2F3';
const TOTAL_FILL = 'FFFFE699';
const SUM_FILL = 'FFFFF2CC';
const MONEY = '#,##0';
const HOURS = '[h]:mm';
const thin = { style: 'thin' as const };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

const dmy = (ymd: string) => ymd.split('-').reverse().join('.');
/** A Tashkent day as the date Excel shows (stored at UTC midnight). */
const excelDay = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const tkDay = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
const tkTime = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(11, 16);
const hoursOf = (min: number) => min / 1440;
const byName = (a: string, b: string) => a.localeCompare(b, 'ru');

function sheet(wb: ExcelJS.Workbook, name: string, title: string, period: string, widths: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.mergeCells(1, 1, 1, widths.length);
  ws.mergeCells(2, 1, 2, widths.length);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 14 };
  t.alignment = { horizontal: 'center', wrapText: true };
  const p = ws.getCell(2, 1);
  p.value = period;
  p.font = { size: 12 };
  p.alignment = { horizontal: 'center', wrapText: true };
  return ws;
}

function header(ws: ExcelJS.Worksheet, row: number, cells: string[]) {
  cells.forEach((v, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = v;
    c.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = BORDER;
  });
}

type Cell = string | number | Date | null;
function line(ws: ExcelJS.Worksheet, row: number, cells: Cell[], opts: { fill?: string; bold?: boolean; formats?: Record<number, string> } = {}) {
  cells.forEach((v, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = v ?? '';
    c.font = { size: 12, bold: !!opts.bold };
    c.border = BORDER;
    if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
    if (v instanceof Date) c.numFmt = 'DD.MM.YYYY';
    else if (typeof v === 'number') c.numFmt = MONEY;
    const f = opts.formats?.[i];
    if (f) c.numFmt = f;
  });
}

function totalRow(ws: ExcelJS.Worksheet, row: number, labelSpan: number, width: number, values: Record<number, Cell>, formats: Record<number, string> = {}) {
  const cells: Cell[] = Array.from({ length: width }, (_, i) => (i === 0 ? 'ЖАМИ' : (values[i] ?? '')));
  line(ws, row, cells, { fill: TOTAL_FILL, bold: true, formats });
  if (labelSpan > 1) ws.mergeCells(row, 1, row, labelSpan);
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return new Map([...out.entries()].sort(([a], [b]) => byName(a, b)));
}

function tripsSheet(wb: ExcelJS.Workbook, name: string, title: string, period: string, trips: XlsxTrip[]) {
  const ws = sheet(wb, name, title, period, [5, 12, 8, 18, 24, 22, 12, 7, 45]);
  header(ws, 4, ['№', 'Сана', 'Вақт', 'Ҳайдовчи', 'Машина', 'Шаҳар', 'Бонус', 'Расм', 'Расм изоҳи']);
  let r = 5;
  const groups = groupBy(trips, (t) => t.driver);
  let n = 0;
  for (const [driver, list] of groups) {
    n += 1;
    const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    const sum = sorted.reduce((s, t) => s + t.amount, 0);
    line(ws, r++, [n, '', '', driver, machine(sorted[0]!.category), '', sum, '', ''], { fill: GROUP_FILL, bold: true });
    sorted.forEach((t, i) => {
      line(ws, r++, [
        i + 1,
        excelDay(tkDay(t.at)),
        tkTime(t.at),
        driver,
        machine(t.category),
        t.outside ? 'Шаҳардан ташқари (2x)' : 'Шаҳар ичи',
        t.amount,
        t.photo ? 1 : '',
        t.note ?? '',
      ]);
    });
  }
  const total = trips.reduce((s, t) => s + t.amount, 0);
  totalRow(ws, r, 6, 9, { 6: total });
  r += 3;
  ws.getCell(r, 1).value = 'ҲАР БИР ҲАЙДОВЧИНИНГ УМУМИЙ БОНУСИ';
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  r += 1;
  header(ws, r++, ['№', 'Ҳайдовчи', 'Машина', 'Шаҳар ичи', 'Ташқари (2x)', 'Жами юк', 'Жами бонус']);
  let k = 0;
  let city = 0;
  let out = 0;
  for (const [driver, list] of groups) {
    k += 1;
    const o = list.filter((t) => t.outside).length;
    city += list.length - o;
    out += o;
    line(ws, r++, [k, driver, machine(list[0]!.category), list.length - o, o, list.length, list.reduce((s, t) => s + t.amount, 0)]);
  }
  totalRow(ws, r, 3, 7, { 3: city, 4: out, 5: city + out, 6: total });
  return { count: trips.length, total };
}

export async function buildBonusWorkbook(input: {
  from: string;
  to: string;
  today: string;
  pickups: XlsxTrip[];
  deliveries: XlsxTrip[];
  overtime: XlsxOvertimeDay[];
  /** One driver's own file: his name on the period line, and only his three sheets. */
  personal?: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const period =
    (input.personal ? `${input.personal} · ` : '') +
    `${dmy(input.from)} - ${dmy(input.to)}` +
    (input.today >= input.from && input.today < input.to ? `  (${dmy(input.today)} гача)` : '');

  // --- Ишбай: the minutes before 09:00 and after 18:00, one row a day.
  const ws = sheet(wb, 'Ишбай', 'Иш вақтидан ташқари қўшимча ишлаган ходимлар ҳисоботи', period, [
    5, 12, 18, 34, 11, 10, 10, 13, 13, 34, 40,
  ]);
  header(ws, 4, ['№', 'Сана', 'Ходим', 'Иш тури', 'Нархи', 'Бошлади', 'Тугатди', 'Ишлаган вақти', 'Суммаси', 'Ким ёзди', 'Нима иш қилди']);
  const fmt = { 7: HOURS };
  let r = 5;
  const days = groupBy(input.overtime, (o) => o.driver);
  let n = 0;
  for (const [driver, list] of days) {
    n += 1;
    const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
    const min = sorted.reduce((s, o) => s + o.minutes, 0);
    const sum = sorted.reduce((s, o) => s + o.amount, 0);
    line(ws, r++, [n, '', driver, workKind(sorted[0]!.category), '', '', '', hoursOf(min), sum, '', ''], {
      fill: GROUP_FILL,
      bold: true,
      formats: fmt,
    });
    sorted.forEach((o, i) => {
      const who = [o.morning ? 'Эрталаб: илова' : null, o.evening ? (o.border ? 'Кечқурун: Тошкент чегараси' : 'Кечқурун: гуруҳдаги расм') : null].filter(Boolean).join(' · ');
      line(
        ws,
        r++,
        [i + 1, excelDay(o.day), driver, workKind(o.category), o.rate, o.started ?? '', o.finished ?? '', hoursOf(o.minutes), o.amount, who, ''],
        { formats: fmt },
      );
    });
  }
  const otMin = input.overtime.reduce((s, o) => s + o.minutes, 0);
  const otSum = input.overtime.reduce((s, o) => s + o.amount, 0);
  totalRow(ws, r, 6, 11, { 7: hoursOf(otMin), 8: otSum }, fmt);
  r += 3;
  ws.getCell(r, 1).value = 'ҲАР БИР ХОДИМНИНГ УМУМИЙ ҚЎШИМЧА ИШ СУММАСИ';
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  r += 1;
  header(ws, r++, ['№', 'Ходим', 'Иш тури', 'Марта', 'Жами вақт', 'Жами сумма']);
  let k = 0;
  for (const [driver, list] of days) {
    k += 1;
    line(
      ws,
      r++,
      [k, driver, workKind(list[0]!.category), list.length, hoursOf(list.reduce((s, o) => s + o.minutes, 0)), list.reduce((s, o) => s + o.amount, 0)],
      { formats: { 4: HOURS } },
    );
  }
  totalRow(ws, r, 3, 6, { 3: input.overtime.length, 4: hoursOf(otMin), 5: otSum }, { 4: HOURS });

  // --- Юк олиш, Юк топшириш.
  const pick = tripsSheet(wb, 'Юк олиш', 'Юк олиш бонуслари', period, input.pickups);
  const drop = tripsSheet(wb, 'Юк топшириш', 'Юк топшириш бонуслари', period, input.deliveries);

  if (input.personal) return Buffer.from(await wb.xlsx.writeBuffer());

  // --- Ходимлар Жами: what each driver is owed.
  const people = new Map<string, { ot: number; pick: number; drop: number }>();
  const add = (name: string, key: 'ot' | 'pick' | 'drop', v: number) => {
    const p = people.get(name) ?? { ot: 0, pick: 0, drop: 0 };
    p[key] += v;
    people.set(name, p);
  };
  input.overtime.forEach((o) => add(o.driver, 'ot', o.amount));
  input.pickups.forEach((t) => add(t.driver, 'pick', t.amount));
  input.deliveries.forEach((t) => add(t.driver, 'drop', t.amount));
  const ws2 = sheet(wb, 'Ходимлар Жами', 'ХОДИМЛАРГА ҲИСОБЛАНГАН БОНУСЛАР', period, [5, 26, 20, 20, 18, 20]);
  header(ws2, 4, ['№', 'Ходим', 'Жами олиши керак', 'Ишбай (иш ташқари)', 'Юк олиш бонуси', 'Юк топшириш бонуси']);
  r = 5;
  const ranked = [...people.entries()]
    .map(([name, p]) => ({ name, ...p, total: p.ot + p.pick + p.drop }))
    .sort((a, b) => b.total - a.total || byName(a.name, b.name));
  ranked.forEach((p, i) => line(ws2, r++, [i + 1, p.name, p.total, p.ot || '', p.pick || '', p.drop || '']));
  totalRow(ws2, r, 2, 6, {
    2: ranked.reduce((s, p) => s + p.total, 0),
    3: otSum,
    4: pick.total,
    5: drop.total,
  });

  // --- Жами сумма: the three heads and the grand total.
  const ws3 = sheet(wb, 'Жами сумма', 'Ходимларга ҳисобланган бонуслар ҳисоботи', period, [5, 42, 20, 20]);
  header(ws3, 4, ['№', 'Бўлим', 'Сони', 'Сумма']);
  const rows: [string, string, number][] = [
    ['Ходимлар ишдан ташқари ишлаган суммаси', `${Math.floor(otMin / 60)} соат ${otMin % 60} дақиқа`, otSum],
    ['Ходимлар юк олиш бонуси суммаси', `${pick.count} юк`, pick.total],
    ['Ходимлар юк топшириш бонуси суммаси', `${drop.count} юк`, drop.total],
  ];
  rows.forEach(([label, count, sum], i) => {
    line(ws3, 5 + i, [i + 1, label, count, sum]);
    ws3.getCell(5 + i, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } };
  });
  line(ws3, 5 + rows.length, ['', 'Жами', `${people.size} киши`, otSum + pick.total + drop.total], { bold: true, fill: TOTAL_FILL });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
