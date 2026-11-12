import { VozvratProductsService, rankProducts } from './vozvrat-products.service';

describe('VozvratProductsService', () => {
  it("serves the warehouse's own list, ids as the driver app sends them", async () => {
    const ombor = {
      products: async () => [
        { id: 12, name: 'Sement M400', unit: 'qop', hodovoy: true, status: 'tasdiq', addedBy: null, firstReturnNumber: null },
        { id: 13, name: 'Gips', unit: null, hodovoy: null, status: 'yangi', addedBy: 'Ҳайдовчи A', firstReturnNumber: 5 },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new VozvratProductsService(ombor as any);
    expect(await service.all()).toEqual([
      { id: '12', name: 'Sement M400', unit: 'qop', xodovoy: true },
      { id: '13', name: 'Gips', unit: null, xodovoy: null },
    ]);
    expect((await service.search('gip')).map((p) => p.id)).toEqual(['13']);
  });

  it('searches with their ranking: starts with, then a word starts with, then contains', () => {
    const names = ['Kafel yelimi', 'Yelim PVA', 'Gips', 'Shpaklyovka (yelimli)'];
    const products = names.map((name, i) => ({ id: String(i), name, unit: null, xodovoy: null }));
    expect(rankProducts(products, 'yel').map((p) => p.name)).toEqual([
      'Yelim PVA',
      'Kafel yelimi',
      'Shpaklyovka (yelimli)',
    ]);
    expect(rankProducts(products, 'Ё').length).toBe(0);
    expect(rankProducts(products, '')).toBe(products);
  });

  it('finds a Cyrillic name typed in Uzbek Latin, by ear', () => {
    const list = [
      { id: '1', name: 'Дорожная сетка 15*15 д-4мм', unit: null, xodovoy: null },
      { id: '2', name: 'Кладка сетка 4талик д-4мм', unit: null, xodovoy: null },
      { id: '3', name: 'Цемент М400', unit: null, xodovoy: null },
    ];
    expect(rankProducts(list, 'darojni setka').map((p) => p.id)).toEqual(['1']);
    expect(rankProducts(list, 'setka').map((p) => p.id)).toEqual(['1', '2']);
    expect(rankProducts(list, 'doroj setka 15').map((p) => p.id)).toEqual(['1']);
    expect(rankProducts(list, 'sement').map((p) => p.id)).toEqual(['3']);
    expect(rankProducts(list, 'truba').length).toBe(0);
  });
});
