import ExcelJS from 'exceljs';
import { buildBonusWorkbook } from './payroll-excel';

const at = (iso: string) => new Date(iso);

async function build() {
  const buf = await buildBonusWorkbook({
    from: '2026-10-16',
    to: '2026-11-15',
    today: '2026-10-29',
    pickups: [
      { driver: 'Абдулла ака', category: 'orta', at: at('2026-10-17T08:44:00Z'), outside: false, amount: 20_000, photo: true, note: 'BIGANT sklad' },
      { driver: 'Азиз', category: 'kichik', at: at('2026-10-18T06:00:00Z'), outside: true, amount: 20_000, photo: false, note: null },
    ],
    deliveries: [
      { driver: 'Абдулла ака', category: 'orta', at: at('2026-10-16T09:25:00Z'), outside: true, amount: 40_000, photo: true, note: 'Aziz' },
    ],
    overtime: [
      { driver: 'Абдулла ака', category: 'orta', day: '2026-10-22', rate: 70_000, started: '07:23', finished: '20:54', minutes: 271, amount: 316_167, morning: true, evening: true },
    ],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const row = (ws: ExcelJS.Worksheet, n: number) => (ws.getRow(n).values as unknown[]).slice(1);

describe('the bonus workbook, as the mini app lays it out', () => {
  it('has the mini app sheets, without Рағбат and with Юк топшириш', async () => {
    const wb = await build();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Ишбай', 'Юк олиш', 'Юк топшириш', 'Ходимлар Жами', 'Жами сумма']);
  });

  it('every sheet has its title, the period, and the mini app columns', async () => {
    const wb = await build();
    const ish = wb.getWorksheet('Ишбай')!;
    expect(ish.getCell('A1').value).toBe('Иш вақтидан ташқари қўшимча ишлаган ходимлар ҳисоботи');
    expect(ish.getCell('A2').value).toBe('16.10.2026 - 15.11.2026  (29.10.2026 гача)');
    expect(row(ish, 4)).toEqual(['№', 'Сана', 'Ходим', 'Иш тури', 'Нархи', 'Бошлади', 'Тугатди', 'Ишлаган вақти', 'Суммаси', 'Ким ёзди', 'Нима иш қилди']);
    expect(row(wb.getWorksheet('Юк олиш')!, 4)).toEqual(['№', 'Сана', 'Вақт', 'Ҳайдовчи', 'Машина', 'Шаҳар', 'Бонус', 'Расм', 'Расм изоҳи']);
    expect(row(wb.getWorksheet('Юк топшириш')!, 4)).toEqual(['№', 'Сана', 'Вақт', 'Ҳайдовчи', 'Машина', 'Шаҳар', 'Бонус', 'Расм', 'Расм изоҳи']);
    expect(row(wb.getWorksheet('Ходимлар Жами')!, 4)).toEqual(['№', 'Ходим', 'Жами олиши керак', 'Ишбай (иш ташқари)', 'Юк олиш бонуси', 'Юк топшириш бонуси']);
    expect(row(wb.getWorksheet('Жами сумма')!, 4)).toEqual(['№', 'Бўлим', 'Сони', 'Сумма']);
  });

  it('a pickup row: Tashkent day and time, machine, town, bonus, photo, note', async () => {
    const ws = (await build()).getWorksheet('Юк олиш')!;
    // Row 5 is Абдулла ака's total, row 6 his first pickup.
    expect(row(ws, 5).slice(3, 7)).toEqual(['Абдулла ака', 'Ўрта (Газел)', '', 20_000]);
    const r = row(ws, 6);
    expect((r[1] as Date).toISOString().slice(0, 10)).toBe('2026-10-17');
    expect(r.slice(2)).toEqual(['13:44', 'Абдулла ака', 'Ўрта (Газел)', 'Шаҳар ичи', 20_000, 1, 'BIGANT sklad']);
    // Азиз outside town is "2x".
    expect(row(ws, 8)[5]).toBe('Шаҳардан ташқари (2x)');
  });

  it('a day of extra hours: started, finished, time worked, sum', async () => {
    const ws = (await build()).getWorksheet('Ишбай')!;
    const r = row(ws, 6);
    expect(r.slice(2, 7)).toEqual(['Абдулла ака', 'Газел/Исузу қўшимча ишлагани учун', 70_000, '07:23', '20:54']);
    // Stored as a fraction of a day under [h]:mm; ExcelJS reads such a cell back as a date.
    const v = r[7] as number | Date;
    const days = v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000 : v;
    expect(Math.round(days * 1440)).toBe(271);
    expect(ws.getCell('H6').numFmt).toBe('[h]:mm');
    expect(r[8]).toBe(316_167);
  });

  it('what each is owed, and the grand total', async () => {
    const wb = await build();
    expect(row(wb.getWorksheet('Ходимлар Жами')!, 5)).toEqual([1, 'Абдулла ака', 376_167, 316_167, 20_000, 40_000]);
    const sums = wb.getWorksheet('Жами сумма')!;
    expect(row(sums, 5)).toEqual([1, 'Ходимлар ишдан ташқари ишлаган суммаси', '4 соат 31 дақиқа', 316_167]);
    expect(row(sums, 7)).toEqual([3, 'Ходимлар юк топшириш бонуси суммаси', '1 юк', 40_000]);
    expect(row(sums, 8)).toEqual(['', 'Жами', '2 киши', 396_167]);
  });

  it("one driver's own file: his name on the period line, only his three sheets", async () => {
    const buf = await buildBonusWorkbook({
      from: '2026-10-16',
      to: '2026-11-15',
      today: '2026-10-29',
      personal: 'Ихтиёр',
      pickups: [],
      deliveries: [{ driver: 'Ихтиёр', category: 'kichik', at: at('2026-10-16T05:32:00Z'), outside: false, amount: 10_000, photo: true, note: null }],
      overtime: [],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Ишбай', 'Юк олиш', 'Юк топшириш']);
    expect(wb.getWorksheet('Юк топшириш')!.getCell('A2').value).toBe('Ихтиёр · 16.10.2026 - 15.11.2026  (29.10.2026 гача)');
  });
});
