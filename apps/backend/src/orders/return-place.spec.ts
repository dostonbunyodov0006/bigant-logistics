import { pickHomePlaces, returnPlaceOf } from './return-place';

const places = [
  { name: 'Supplier A', type: 'custom', address: 'Uzar 65', lat: 41.23, lng: 69.19 },
  { name: 'BIGANT sklad', type: 'warehouse', address: "Sample street 1", lat: 41.256, lng: 69.223 },
  { name: "BIGANT do'kon", type: 'market', address: 'Yuqori Sample street 2', lat: 41.254, lng: 69.201 },
];
const home = pickHomePlaces(places);
const lecco = { name: 'Supplier A', address: 'Sergeli', lat: 41.23, lng: 69.19 };

describe('where a return goes', () => {
  it('Sklad sends the driver to BIGANT sklad, not to where the goods came from', () => {
    expect(returnPlaceOf('warehouse', lecco, home)).toEqual({ name: 'BIGANT sklad', address: "Sample street 1", lat: 41.256, lng: 69.223, phone_number: null });
  });

  it("Do'kon sends him to BIGANT do'kon", () => {
    expect(returnPlaceOf('store', lecco, home)?.name).toBe("BIGANT do'kon");
  });

  it("Ta'minotchi sends him back to the stop itself", () => {
    expect(returnPlaceOf('supplier', lecco, home)).toEqual({ ...lecco, phone_number: null });
  });

  it("Ta'minotchi picked from the list: that supplier's place, with its phone (owner, 12.11.2026)", () => {
    const picked = { name: 'Artel · Chilonzor', address: 'Chilonzor 5', lat: 41.28, lng: 69.2, phone_number: '901234567', place_id: 'pp9' };
    expect(returnPlaceOf('supplier', lecco, home, picked)).toEqual(picked);
    // A picked supplier never overrides Sklad or Do'kon.
    expect(returnPlaceOf('store', lecco, home, picked)?.name).toBe("BIGANT do'kon");
  });

  it('the shop and warehouse carry their phone from the places list', () => {
    const h = pickHomePlaces([{ name: "BIGANT do'kon", type: 'market', address: null, lat: 1, lng: 2, phoneNumber: '712000000' }]);
    expect(returnPlaceOf('store', lecco, h)?.phone_number).toBe('712000000');
  });

  it('nothing picked yet, no place', () => {
    expect(returnPlaceOf(null, lecco, home)).toBeNull();
  });
});
