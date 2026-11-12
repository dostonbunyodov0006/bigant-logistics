import type { DataDrivenPropertyValueSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * The basemap, drawn in the app's own colours.
 *
 * The tiles are one PMTiles archive of Uzbekistan built from the same OSM
 * extract Valhalla routes on, served as a static file — there is no tile
 * server. Planetiler writes the OpenMapTiles schema, which is what the layer
 * names and `class` values below refer to.
 *
 * Drawn the way the map apps the office knows draw a city (owner, 30.10.2026):
 * street names along the streets, mahallas and districts, district borders,
 * the airport, markets and other named places, house numbers close in. The
 * archive always carried all of it; only the roads and town names were drawn.
 *
 * Two themes because the app has two: the admin console is light, the seller
 * board is a dark island, and a light map dropped into that panel reads as a
 * mistake. Both come from the same archive.
 */
// Rebuilt from the OSM extract of 03.11.2026; a new name so browsers do not keep the old archive 30 days.
const TILES = '/tiles/uzbekistan-2026-11-03.pmtiles';
const GLYPHS = '/tiles/fonts/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Regular'];
/** Pulled out of the same OSM extract: what the tile schema leaves out. */
const OVERLAYS = '/tiles/overlays';
/** One spelling for every label: the Latin form where the archive has one. */
const NAME = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

interface Palette {
  ground: string;
  residential: string;
  commercial: string;
  industrial: string;
  hospital: string;
  school: string;
  water: string;
  green: string;
  wood: string;
  farmland: string;
  sand: string;
  park: string;
  building: string;
  buildingLine: string;
  road: string;
  roadCasing: string;
  roadSecondary: string;
  roadSecondaryCasing: string;
  roadMajor: string;
  roadMajorCasing: string;
  motorway: string;
  motorwayCasing: string;
  rail: string;
  runway: string;
  boundary: string;
  text: string;
  textStrong: string;
  textRoad: string;
  textWater: string;
  textPoi: string;
  textHalo: string;
}

// Google Maps' own colours (owner, 02.11.2026: the map was too grey): every kind
// of ground has its tint — trade warm yellow, hospitals pink, schools lilac,
// parks and woods green — blue water, and roads graded white, yellow, orange.
const LIGHT: Palette = {
  ground: '#f1f3f4',
  residential: '#f4f2ed',
  commercial: '#fdf0c8',
  industrial: '#e8e6ef',
  hospital: '#fbdcd9',
  school: '#e9e3f6',
  water: '#7fb6f5',
  green: '#d3edc4',
  wood: '#a9dc95',
  farmland: '#e9f1d2',
  sand: '#f6ecc9',
  park: '#a8e092',
  building: '#e9e4db',
  buildingLine: '#cfc8bb',
  road: '#ffffff',
  roadCasing: '#d3d6db',
  roadSecondary: '#fff6cf',
  roadSecondaryCasing: '#e8d48a',
  roadMajor: '#fddc73',
  roadMajorCasing: '#e6b422',
  motorway: '#fbb03b',
  motorwayCasing: '#d98a0b',
  rail: '#bdc1c6',
  runway: '#d5d8de',
  boundary: '#9aa0a6',
  text: '#5f6368',
  textStrong: '#202124',
  textRoad: '#4d5156',
  textWater: '#1f5fa8',
  textPoi: '#5f6368',
  textHalo: '#ffffff',
};

/** Google colours a place's name by what it is; the same here. */
const POI_COLOR = [
  'match',
  ['get', 'class'],
  ['shop', 'grocery', 'clothing_store', 'furniture', 'hardware', 'alcohol_shop', 'bakery', 'jewelry', 'shoe_shop', 'electronics', 'mobile_phone', 'marketplace', 'department_store', 'mall'],
  '#1a73e8',
  ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'beer'],
  '#e37400',
  ['hospital', 'pharmacy', 'doctors', 'dentist', 'clinic', 'veterinary'],
  '#d93025',
  ['school', 'college', 'university', 'kindergarten', 'library'],
  '#7b5e57',
  ['park', 'garden', 'playground', 'stadium', 'pitch', 'sports_centre', 'golf'],
  '#188038',
  ['place_of_worship', 'religion', 'cemetery'],
  '#5f6368',
  ['bus', 'railway', 'subway', 'airport', 'ferry_terminal', 'transit'],
  '#1967d2',
  ['fuel', 'car', 'car_repair', 'parking'],
  '#5e35b1',
  ['lodging', 'hotel'],
  '#c5221f',
  '#5f6368',
];

const DARK: Palette = {
  ground: '#0b0e14',
  residential: '#0f131a',
  commercial: '#1c1a12',
  industrial: '#121420',
  hospital: '#1f1416',
  school: '#16141f',
  water: '#111b28',
  green: '#101a13',
  wood: '#12211a',
  farmland: '#11160f',
  sand: '#1a1812',
  park: '#122016',
  building: '#161b24',
  buildingLine: '#1d2430',
  road: '#232a36',
  roadCasing: '#11151c',
  roadSecondary: '#2c2d2c',
  roadSecondaryCasing: '#11151c',
  roadMajor: '#39311f',
  roadMajorCasing: '#1a1610',
  motorway: '#4a3a1c',
  motorwayCasing: '#1a1610',
  rail: '#2b313c',
  runway: '#1d2230',
  boundary: '#4b4560',
  text: '#8a93a0',
  textStrong: '#c3cad4',
  textRoad: '#9aa3ae',
  textWater: '#5b86b0',
  textPoi: '#7c8794',
  textHalo: '#0b0e14',
};

/** Line width that grows with zoom — the same curve for every road class,
 *  scaled by how important the class is. */
function width(scale: number): DataDrivenPropertyValueSpecification<number> {
  return [
    'interpolate',
    ['exponential', 1.4],
    ['zoom'],
    6, 0.4 * scale,
    10, 1.2 * scale,
    14, 3 * scale,
    18, 14 * scale,
  ] as unknown as DataDrivenPropertyValueSpecification<number>;
}

const ROUND = { 'line-cap': 'round', 'line-join': 'round' } as const;
const METRO_COLOR = ['match', ['get', 'ref'], '1', '#e53935', '2', '#1e88e5', '3', '#43a047', '4', '#8e24aa', '#9aa0a6'];
const METRO_NAME = [
  'match',
  ['get', 'ref'],
  '1',
  'Ⓜ Chilonzor liniyasi',
  '2',
  "Ⓜ O'zbekiston liniyasi",
  '3',
  'Ⓜ Yunusobod liniyasi',
  '4',
  'Ⓜ Halqa liniyasi',
  ['get', 'name'],
];
/** Places drawn with their own sign rather than as a coloured name. */
const KEY_POI = ['fuel', 'marketplace', 'mall', 'department_store', 'police', 'railway', 'bus', 'grocery', 'shop'];
const MINOR = ['in', 'class', 'minor', 'service', 'tertiary', 'track'];
const SECONDARY = ['==', 'class', 'secondary'];
const MAJOR = ['==', 'class', 'primary'];
const MOTORWAY = ['in', 'class', 'motorway', 'trunk'];

export function basemapStyle(theme: 'light' | 'dark'): StyleSpecification {
  const c = theme === 'dark' ? DARK : LIGHT;
  const halo = { 'text-halo-color': c.textHalo, 'text-halo-width': 1.5 };
  /** A road drawn as a casing under a fill, so junctions and kerbs read. */
  const road = (id: string, filter: unknown[], fill: string, casing: string, scale: number, minzoom = 0) => [
    {
      id: `${id}-casing`,
      type: 'line',
      source: 'uz',
      'source-layer': 'transportation',
      filter,
      minzoom,
      paint: { 'line-color': casing, 'line-width': width(scale * 1.35) },
      layout: ROUND,
    },
    {
      id,
      type: 'line',
      source: 'uz',
      'source-layer': 'transportation',
      filter,
      minzoom,
      paint: { 'line-color': fill, 'line-width': width(scale) },
      layout: ROUND,
    },
  ];
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      uz: { type: 'vector', url: `pmtiles://${TILES}` },
      // One point per crossing; the version drops the cached file of one per approach.
      // ?v= bumps when the overlays are regenerated from a new extract (03.11.2026: v3).
      signals: { type: 'geojson', data: `${OVERLAYS}/traffic-signals.geojson?v=3` },
      trees: { type: 'geojson', data: `${OVERLAYS}/trees.geojson?v=3` },
      admin: { type: 'geojson', data: `${OVERLAYS}/admin-labels.geojson?v=3` },
      metro: { type: 'geojson', data: `${OVERLAYS}/metro-lines.geojson?v=3` },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': c.ground } },
      {
        id: 'landuse-residential',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'residential', 'suburb', 'neighbourhood'],
        paint: { 'fill-color': c.residential },
      },
      {
        id: 'landuse-industrial',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'industrial', 'railway', 'quarry', 'garages'],
        minzoom: 10,
        paint: { 'fill-color': c.industrial },
      },
      {
        id: 'landuse-commercial',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'commercial', 'retail'],
        minzoom: 10,
        paint: { 'fill-color': c.commercial },
      },
      {
        id: 'landuse-hospital',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['==', 'class', 'hospital'],
        minzoom: 10,
        paint: { 'fill-color': c.hospital },
      },
      {
        id: 'landuse-school',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'school', 'university', 'college', 'kindergarten', 'library'],
        minzoom: 10,
        paint: { 'fill-color': c.school },
      },
      {
        id: 'landuse-green',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'cemetery', 'stadium', 'pitch', 'playground', 'track', 'theme_park', 'zoo'],
        minzoom: 10,
        paint: { 'fill-color': c.green },
      },
      {
        id: 'closed-area',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'military', 'prison'],
        minzoom: 10,
        paint: { 'fill-color': theme === 'dark' ? '#2a1618' : '#f6e1e1' },
      },
      {
        id: 'closed-area-edge',
        type: 'line',
        source: 'uz',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'military', 'prison'],
        minzoom: 12,
        paint: { 'line-color': '#d93025', 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.6 },
      },
      {
        id: 'green',
        type: 'fill',
        source: 'uz',
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'wood',
            c.wood,
            'farmland',
            c.farmland,
            'sand',
            c.sand,
            'rock',
            c.ground,
            c.green,
          ],
        },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'uz',
        'source-layer': 'park',
        paint: { 'fill-color': c.park },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'uz',
        'source-layer': 'water',
        paint: { 'fill-color': c.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'uz',
        'source-layer': 'waterway',
        paint: {
          'line-color': c.water,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.5, 18, 6],
        },
        layout: ROUND,
      },
      {
        id: 'aeroway',
        type: 'line',
        source: 'uz',
        'source-layer': 'aeroway',
        filter: ['in', 'class', 'runway', 'taxiway'],
        minzoom: 10,
        paint: {
          'line-color': c.runway,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 12, 17, 40],
        },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'uz',
        'source-layer': 'building',
        minzoom: 12,
        // Fades in, so the tints of the ground still show from the district view.
        paint: {
          'fill-color': c.building,
          'fill-outline-color': c.buildingLine,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.45, 16, 1],
        },
      },
      // District borders dashed, region and country borders firm — as the
      // office's tracker and Google draw them.
      {
        id: 'boundary-district',
        type: 'line',
        source: 'uz',
        'source-layer': 'boundary',
        filter: ['all', ['>=', 'admin_level', 5], ['<=', 'admin_level', 8], ['!=', 'maritime', 1]],
        minzoom: 7,
        paint: {
          'line-color': c.boundary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 14, 1.6],
          'line-dasharray': [3, 2],
          'line-opacity': 0.8,
        },
      },
      {
        id: 'boundary-region',
        type: 'line',
        source: 'uz',
        'source-layer': 'boundary',
        filter: ['all', ['<=', 'admin_level', 4], ['!=', 'maritime', 1]],
        paint: {
          'line-color': '#8e7cc3',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 2.2, 14, 3],
          'line-dasharray': [6, 2, 1, 2],
        },
      },
      {
        id: 'footway',
        type: 'line',
        source: 'uz',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'path'],
        minzoom: 15,
        paint: {
          'line-color': theme === 'dark' ? '#2b313c' : '#c7c9cc',
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.8, 18, 2],
          'line-dasharray': [2, 1.5],
        },
      },
      // Railways: grey with white ties, as Google draws them.
      {
        id: 'rail',
        type: 'line',
        source: 'uz',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        minzoom: 8,
        paint: { 'line-color': '#9aa0a6', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 16, 3] },
      },
      {
        id: 'rail-ties',
        type: 'line',
        source: 'uz',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        minzoom: 12,
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.6],
          'line-dasharray': [0.5, 3],
        },
      },
      // The four Tashkent metro lines, each in its own colour (from the OSM
      // route relations): 1 Chilonzor red, 2 O'zbekiston blue, 3 Yunusobod
      // green, 4 Halqa purple.
      {
        id: 'metro-casing',
        type: 'line',
        source: 'metro',
        minzoom: 9,
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 16, 8] },
        layout: ROUND,
      },
      {
        id: 'metro',
        type: 'line',
        source: 'metro',
        minzoom: 9,
        paint: {
          'line-color': METRO_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.8, 16, 5],
        },
        layout: ROUND,
      },
      ...road('road-minor', MINOR, c.road, c.roadCasing, 0.8, 12),
      ...road('road-secondary', SECONDARY, c.roadSecondary, c.roadSecondaryCasing, 1.15, 9),
      ...road('road-major', MAJOR, c.roadMajor, c.roadMajorCasing, 1.4),
      ...road('road-motorway', MOTORWAY, c.motorway, c.motorwayCasing, 1.6),
      {
        id: 'bridge-edge',
        type: 'line',
        source: 'uz',
        'source-layer': 'transportation',
        filter: ['all', ['==', ['get', 'brunnel'], 'bridge'], ['!', ['in', ['get', 'class'], ['literal', ['path', 'rail', 'transit']]]]],
        // Only close in: from afar the two edges merge into a dark smear.
        minzoom: 15,
        paint: {
          'line-color': '#9aa0a6',
          'line-width': 0.8,
          'line-opacity': 0.7,
          'line-gap-width': width(1.2),
        },
      },
      {
        id: 'tunnel',
        type: 'line',
        source: 'uz',
        'source-layer': 'transportation',
        // Roads only: over the rail and metro lines it chopped them into dashes.
        filter: ['all', ['==', ['get', 'brunnel'], 'tunnel'], ['!', ['in', ['get', 'class'], ['literal', ['path', 'rail', 'transit']]]]],
        minzoom: 13,
        paint: {
          'line-color': theme === 'dark' ? '#3a414d' : '#ffffff',
          'line-width': width(1.1),
          'line-dasharray': [1, 1],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'tree',
        type: 'circle',
        source: 'trees',
        minzoom: 16,
        paint: {
          'circle-color': theme === 'dark' ? '#16301c' : '#b7dfa8',
          'circle-stroke-color': theme === 'dark' ? '#1f4227' : '#8cc47a',
          'circle-stroke-width': 1,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 2.5, 18, 7],
        },
      },
      // Traffic lights: the icon is drawn by BaseMap the first time it is asked for.
      {
        id: 'traffic-signal',
        type: 'symbol',
        source: 'signals',
        minzoom: 12,
        layout: {
          'icon-image': 'traffic-signal',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 15, 0.85, 18, 1.2],
          'icon-allow-overlap': true,
        },
      },
      {
        // Parks, gardens, stadiums, cemeteries by name (owner, 03.11.2026).
        id: 'park-label',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'park',
        filter: ['has', 'name'],
        minzoom: 12,
        layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 11.5, 'text-max-width': 8 },
        paint: { 'text-color': '#2f7a3b', ...halo },
      },
      {
        id: 'water-label',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'water_name',
        minzoom: 11,
        layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 12, 'symbol-placement': 'line' },
        paint: { 'text-color': c.textWater, ...halo },
      },
      {
        id: 'metro-label',
        type: 'symbol',
        source: 'metro',
        minzoom: 11,
        layout: {
          'text-field': METRO_NAME,
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 15, 13],
          'symbol-placement': 'line',
          'symbol-spacing': 500,
          'text-letter-spacing': 0.04,
        },
        paint: { 'text-color': METRO_COLOR, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      },
      {
        id: 'waterway-label',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'waterway',
        filter: ['has', 'name'],
        minzoom: 12,
        layout: {
          'text-field': NAME,
          'text-font': FONT,
          'text-size': 12,
          'symbol-placement': 'line',
          'symbol-spacing': 400,
          'text-letter-spacing': 0.05,
        },
        paint: { 'text-color': c.textWater, ...halo },
      },
      // Street names along their streets: the majors from the city view, the
      // small streets once a neighbourhood fills the screen.
      {
        id: 'road-label',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'transportation_name',
        filter: [
          'any',
          ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
          ['>=', ['zoom'], 13],
        ],
        minzoom: 10,
        layout: {
          'text-field': NAME,
          'text-font': FONT,
          'symbol-placement': 'line',
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 12, 16, 13.5, 18, 15],
          'text-max-angle': 30,
          'symbol-spacing': 250,
        },
        paint: { 'text-color': c.textRoad, ...halo },
      },
      {
        id: 'road-ref',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'transportation_name',
        filter: ['all', ['has', 'ref'], ['in', 'class', 'motorway', 'trunk', 'primary']],
        minzoom: 9,
        layout: {
          'text-field': ['get', 'ref'],
          'text-font': FONT,
          'text-size': 11,
          'symbol-placement': 'line',
          'symbol-spacing': 600,
          'text-rotation-alignment': 'viewport',
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#3c78d8', 'text-halo-width': 3 },
      },
      {
        id: 'housenumber',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'housenumber',
        minzoom: 17,
        layout: { 'text-field': ['get', 'housenumber'], 'text-font': FONT, 'text-size': 10 },
        paint: { 'text-color': c.textPoi, ...halo },
      },
      // What a driver steers by gets its own sign, earlier than other places:
      // fuel stations, bazaars and shops, police posts.
      {
        id: 'poi-key',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'poi',
        // Stations, fuel, bazaars and posts from the district view; bus stops
        // and shops once the streets are readable.
        filter: [
          'all',
          ['in', ['get', 'class'], ['literal', KEY_POI]],
          ['any', ['>=', ['zoom'], 15], ['in', ['get', 'class'], ['literal', ['fuel', 'marketplace', 'mall', 'department_store', 'police', 'railway']]]],
        ],
        minzoom: 12,
        layout: {
          'icon-image': [
            'match',
            ['get', 'class'],
            'fuel',
            'poi-fuel',
            'police',
            'poi-police',
            'railway',
            'poi-metro',
            'bus',
            'poi-bus',
            ['grocery', 'shop'],
            'poi-shop',
            'poi-market',
          ],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 16, 1],
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name'], ''],
          'text-font': FONT,
          'text-size': 11.5,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-max-width': 9,
          'text-optional': true,
        },
        paint: {
          'text-color': ['match', ['get', 'class'], 'fuel', '#5e35b1', 'police', '#1a3d8f', 'railway', '#c5221f', 'bus', '#1967d2', ['grocery', 'shop'], '#1a73e8', '#1a73e8'],
          ...halo,
        },
      },
      // Named places the office steers by: bazaars, malls, fuel, hospitals,
      // schools, mosques — close in, so the city view does not drown in them.
      {
        id: 'poi-label',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'poi',
        filter: [
          'all',
          ['has', 'name'],
          ['!', ['in', ['get', 'class'], ['literal', KEY_POI]]],
          ['any', ['>=', ['zoom'], 15], ['<=', ['get', 'rank'], 20]],
        ],
        minzoom: 13,
        layout: {
          'text-field': ['concat', '● ', NAME],
          'text-font': FONT,
          'text-size': 11.5,
          'text-max-width': 9,
          'text-padding': 2,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': theme === 'dark' ? c.textPoi : POI_COLOR, ...halo },
      },
      {
        id: 'airport-label',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'aerodrome_label',
        minzoom: 9,
        layout: { 'text-field': ['concat', '✈ ', NAME], 'text-font': FONT, 'text-size': 13, 'text-max-width': 10 },
        paint: { 'text-color': c.textWater, ...halo },
      },
      // Mahallas and quarters close in; districts and suburbs from the city view.
      {
        id: 'place-quarter',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'place',
        filter: ['in', 'class', 'neighbourhood', 'quarter', 'hamlet', 'isolated_dwelling'],
        minzoom: 11,
        layout: {
          'text-field': NAME,
          'text-font': FONT,
          'text-size': 11,
          'text-max-width': 8,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.06,
        },
        paint: { 'text-color': c.text, ...halo },
      },
      {
        id: 'place-suburb',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'place',
        filter: ['in', 'class', 'suburb', 'village'],
        minzoom: 8,
        layout: {
          'text-field': NAME,
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 14],
          'text-max-width': 8,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
        },
        paint: { 'text-color': c.text, ...halo },
      },
      // District names (tuman) in the middle of their areas, region names (viloyat) from afar.
      {
        id: 'admin-district',
        type: 'symbol',
        source: 'admin',
        filter: ['>=', ['get', 'level'], 5],
        minzoom: 9,
        maxzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 13, 14],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.1,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#7a6aa8', ...halo },
      },
      {
        id: 'admin-region',
        type: 'symbol',
        source: 'admin',
        filter: ['<=', ['get', 'level'], 4],
        minzoom: 5,
        maxzoom: 9,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 8, 16],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.12,
          'text-max-width': 9,
        },
        paint: { 'text-color': '#6a5a9c', ...halo },
      },
      {
        id: 'place-town',
        type: 'symbol',
        source: 'uz',
        'source-layer': 'place',
        filter: ['in', 'class', 'city', 'town'],
        layout: {
          'text-field': NAME,
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 10, 18, 13, 24],
          'text-max-width': 8,
        },
        paint: { 'text-color': c.textStrong, 'text-halo-color': c.textHalo, 'text-halo-width': 2 },
      },
    ],
  } as StyleSpecification;
}
