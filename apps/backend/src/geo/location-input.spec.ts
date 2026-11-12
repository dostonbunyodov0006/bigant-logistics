import { parseLocationInput } from '@bigant/shared';

/**
 * Lives here because `shared` has no test runner of its own and this function
 * is too easy to get quietly wrong to ship untested: a mis-read pair does not
 * fail, it puts the pin in China.
 */

// Tashkent, Amir Temur square. Well inside the country box.
const LAT = 41.311081;
const LNG = 69.240562;

const near = (v: number | undefined, want: number) => expect(v).toBeCloseTo(want, 4);

describe('parseLocationInput — bare coordinates', () => {
  it.each([
    ['41.311081, 69.240562', 'a copied readout'],
    ['41.311081,69.240562', 'no space'],
    ['41.311081   69.240562', 'spaces only'],
    ['  41.311081 , 69.240562  ', 'padded'],
  ])('reads %s (%s)', (input) => {
    const r = parseLocationInput(input);
    expect(r?.source).toBe('coordinates');
    near(r?.lat, LAT);
    near(r?.lng, LNG);
  });

  it('accepts the comma decimal separator people type', () => {
    const r = parseLocationInput('41,311081; 69,240562');
    near(r?.lat, LAT);
    near(r?.lng, LNG);
  });

  it('marks a pair outside Uzbekistan unusable, rather than going quiet', () => {
    // Latitude and longitude the wrong way round: a real paste, and the bug
    // this guard exists for. It still comes back, so the caller can say why.
    const swapped = parseLocationInput('69.240562, 41.311081');
    expect(swapped).toMatchObject({ usable: false });
    expect(parseLocationInput('51.5074, -0.1278')).toMatchObject({ usable: false });
  });

  it('marks a good pair usable', () => {
    expect(parseLocationInput('41.311081, 69.240562')).toMatchObject({ usable: true });
  });

  it('returns null for a pair that is not a coordinate at all', () => {
    // Beyond the poles: not somewhere else, just not a position.
    expect(parseLocationInput('412.3, 691.4')).toBeNull();
  });

  it.each(['', '   ', 'Chilonzor', '41.311081', 'tel: 998901234567'])(
    'returns null for %p so the caller can search instead',
    (input) => expect(parseLocationInput(input)).toBeNull(),
  );
});

describe('parseLocationInput — map links', () => {
  it('reads a Google share link', () => {
    const r = parseLocationInput('https://maps.google.com/maps?q=41.311081,69.240562');
    expect(r?.source).toBe('google');
    near(r?.lat, LAT);
  });

  it('reads the Google address-bar form, where the pair is in the path', () => {
    const r = parseLocationInput('https://www.google.com/maps/@41.311081,69.240562,17z');
    expect(r?.source).toBe('google');
    near(r?.lng, LNG);
  });

  it('reads the pin the Google Maps app shares, as /maps/place/<lat>,<lng>', () => {
    const r = parseLocationInput('https://www.google.com/maps/place/41.311081,69.240562');
    expect(r?.source).toBe('google');
    near(r?.lat, LAT);
    near(r?.lng, LNG);
  });

  it('reads the /maps/search/<lat>,+<lng> share, plus sign and all', () => {
    const r = parseLocationInput('https://www.google.com/maps/search/41.311081,+69.240562?entry=tts');
    near(r?.lat, LAT);
    near(r?.lng, LNG);
  });

  it('reads a long-pressed pin written in degrees, minutes and seconds', () => {
    const r = parseLocationInput(
      "https://www.google.com/maps/place/41%C2%B018'39.9%22N+69%C2%B014'26.0%22E/@41.3,69.24,17z",
    );
    expect(r?.source).toBe('google');
    near(r?.lat, 41.311083);
    near(r?.lng, 69.240556);
  });

  it('reads a Yandex link, which writes longitude first', () => {
    // The whole point of parsing by host: the same two numbers in the other
    // order. Read positionally this lands in China.
    const r = parseLocationInput('https://yandex.uz/maps/10335/tashkent/?ll=69.240562%2C41.311081&z=17');
    expect(r?.source).toBe('yandex');
    near(r?.lat, LAT);
    near(r?.lng, LNG);
  });

  it('reads an OpenStreetMap marker and a map hash', () => {
    near(parseLocationInput('https://www.openstreetmap.org/?mlat=41.311081&mlon=69.240562')?.lat, LAT);
    near(parseLocationInput('https://www.openstreetmap.org/#map=17/41.311081/69.240562')?.lng, LNG);
  });

  it('reads an Apple Maps link', () => {
    near(parseLocationInput('https://maps.apple.com/?ll=41.311081,69.240562')?.lat, LAT);
  });

  it('reads 2GIS, which also writes longitude first', () => {
    const r = parseLocationInput('https://2gis.uz/tashkent/geo/69.240562,41.311081');
    expect(r?.source).toBe('2gis');
    near(r?.lat, LAT);
  });

  it('accepts a link pasted without its scheme', () => {
    near(parseLocationInput('maps.google.com/maps?q=41.311081,69.240562')?.lat, LAT);
  });

  it('returns null for a shortened link, which carries nothing until followed', () => {
    expect(parseLocationInput('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
  });

  it('returns null for a map link with no coordinates in it', () => {
    expect(parseLocationInput('https://www.google.com/maps/place/Tashkent')).toBeNull();
  });

  it('reports a link pointing outside Uzbekistan, with the pair it read', () => {
    // The Kansas coordinates Google hands back when it cannot place a query —
    // pasted for real, and refused in silence until this told the user why.
    const r = parseLocationInput(
      'https://maps.google.com/maps?q=38.272112,-95.980005&ll=38.272112,-95.980005&z=16',
    );
    expect(r).toMatchObject({ usable: false, source: 'google' });
    expect(r?.lat).toBeCloseTo(38.272112, 4);
    expect(r?.lng).toBeCloseTo(-95.980005, 4);
  });
});
