import { placeInTashkent, tumanAt } from './tashkent-tumans';
import type { GeocodingResult } from '@bigant/shared';

const at = (lat: number, lng: number) => tumanAt(lat, lng)?.name ?? null;

describe('tumanAt', () => {
  it('names the tuman from the boundary, whatever the map calls the neighbourhood', () => {
    expect(at(41.3406, 69.3345)).toBe('Mirzo Ulug‘bek tumani'); // map says "Qorasuv"
    expect(at(41.355, 69.205)).toBe('Olmazor tumani'); // map says "Qoraqamish"
    expect(at(41.3268, 69.2347)).toBe('Shayxontoxur tumani'); // Chorsu, map in Cyrillic
    expect(at(41.2875, 69.2038)).toBe('Chilonzor tumani');
    expect(at(41.2765, 69.17)).toBe('Uchtepa tumani');
    expect(at(41.29, 69.28)).toBe('Mirobod tumani');
    expect(at(41.296, 69.32)).toBe('Yashnobod tumani');
    expect(at(41.217, 69.225)).toBe('Sirg‘ali tumani'); // map says "Sergeli"
  });

  it('knows Yangihayot, which the map still files under Sergeli', () => {
    expect(at(41.236477, 69.195807)).toBe('Yangihayot tumani');
  });

  it('is null outside the city', () => {
    expect(at(41.205, 69.13)).toBeNull(); // Zangiota, Toshkent viloyati
    expect(at(41.181, 69.356)).toBeNull(); // towards Chirchiq
    expect(at(39.654, 66.96)).toBeNull(); // Samarqand
  });
});

describe('placeInTashkent', () => {
  const base: GeocodingResult = {
    id: 'x', label: 'x', name: null, latitude: 0, longitude: 0, country: null, country_code: null,
    state: null, county: null, city: null, district: null, street: null, house_number: null,
    postcode: null, osm_type: null, osm_id: null, osm_key: null, osm_value: null,
  };
  it('states the official tuman inside the city', () => {
    const r = placeInTashkent({ ...base, latitude: 41.3406, longitude: 69.3345, city: 'Toshkent', district: 'Qorasuv' });
    expect(r).toMatchObject({ district: 'Mirzo Ulug‘bek tumani', city: 'Toshkent', state: null });
  });
  it('moves a "Toshkent" outside every tuman to the viloyat', () => {
    const r = placeInTashkent({ ...base, latitude: 41.181, longitude: 69.356, city: 'Toshkent' });
    expect(r.state).toBe('Toshkent viloyati');
  });
  it('leaves the regions alone', () => {
    const r = placeInTashkent({ ...base, latitude: 39.654, longitude: 66.96, city: 'Samarqand', state: 'Samarqand viloyati' });
    expect(r).toMatchObject({ city: 'Samarqand', state: 'Samarqand viloyati', district: null });
  });
});
