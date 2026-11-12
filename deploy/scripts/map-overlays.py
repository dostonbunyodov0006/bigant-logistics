# Map overlays the tile schema leaves out, pulled from the same OSM extract:
# traffic lights, single trees, region/district label points and metro lines.
# Run on the server (writes /opt/bigant-geo/tiles/overlays, served at /tiles/overlays):
#   docker run --rm -v /opt/bigant-geo/tiles:/data -v $PWD/deploy/scripts/map-overlays.py:/m.py python:3.12-slim \
#     sh -c "apt-get -qq update && apt-get -qq install -y libexpat1 && pip install -q osmium && python /m.py"
# then pre-compress them for nginx (gzip_static): gzip -k -9 -f overlays/*.geojson
import json, osmium
signals, trees = [], []
class H(osmium.SimpleHandler):
    def node(self, n):
        t = n.tags
        if t.get('highway') == 'traffic_signals' or t.get('crossing') == 'traffic_signals':
            signals.append([round(n.location.lon, 6), round(n.location.lat, 6)])
        elif t.get('natural') == 'tree':
            trees.append([round(n.location.lon, 6), round(n.location.lat, 6)])
H().apply_file('/data/uzbekistan.osm.pbf', locations=False)
def junctions(pts, r=60):
    """OSM marks a light per approach, ten or more at one crossing: lights within
    r metres of each other (chained) become one point, at their middle."""
    import math
    def metres(a, b):
        return math.hypot((a[0] - b[0]) * 111320 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110540)
    parent = list(range(len(pts)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    grid = {}
    size = r / 111000
    for i, q in enumerate(pts):
        cell = (int(q[0] // (size * 1.4)), int(q[1] // size))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((cell[0] + dx, cell[1] + dy), []):
                    if metres(q, pts[j]) <= r:
                        parent[find(i)] = find(j)
        grid.setdefault(cell, []).append(i)
    groups = {}
    for i, q in enumerate(pts):
        groups.setdefault(find(i), []).append(q)
    return [[round(sum(q[0] for q in g) / len(g), 6), round(sum(q[1] for q in g) / len(g), 6)] for g in groups.values()]

def fc(pts):
    return {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'Point', 'coordinates': p}} for p in pts]}
import os
os.makedirs('/data/overlays', exist_ok=True)
json.dump(fc(junctions(signals)), open('/data/overlays/traffic-signals.geojson', 'w'), separators=(',', ':'))
json.dump(fc(trees), open('/data/overlays/trees.geojson', 'w'), separators=(',', ':'))
print('signals', len(signals), 'trees', len(trees))

out = []
class H(osmium.SimpleHandler):
    def area(self, a):
        lvl = a.tags.get('admin_level')
        if a.tags.get('boundary') != 'administrative' or lvl not in ('4', '5', '6', '7', '8'):
            return
        name = a.tags.get('name:uz') or a.tags.get('name')
        if not name:
            return
        best = None
        for ring in a.outer_rings():
            pts = [(n.lon, n.lat) for n in ring]
            s = cx = cy = 0.0
            for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
                f = x1 * y2 - x2 * y1
                s += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
            if s == 0:
                continue
            area = abs(s / 2)
            if best is None or area > best[0]:
                best = (area, cx / (3 * s), cy / (3 * s))
        if best:
            out.append({'type': 'Feature', 'properties': {'name': name, 'level': int(lvl)},
                        'geometry': {'type': 'Point', 'coordinates': [round(best[1], 5), round(best[2], 5)]}})
H().apply_file('/data/uzbekistan.osm.pbf', locations=True, idx='flex_mem')
json.dump({'type': 'FeatureCollection', 'features': out}, open('/data/overlays/admin-labels.geojson', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(Counter(f['properties']['level'] for f in out))
print([f['properties']['name'] for f in out if f['properties']['level'] in (4,)][:20])


# Tashkent metro lines with their names and colours, from the subway route relations.
import json, osmium

lines = {}      # relation id -> {name, colour, ways}
want = set()

class Rels(osmium.SimpleHandler):
    def relation(self, r):
        if r.tags.get('route') in ('subway', 'light_rail'):
            ways = [m.ref for m in r.members if m.type == 'w']
            lines[r.id] = {
                'name': r.tags.get('name:uz') or r.tags.get('name') or '',
                'ref': r.tags.get('ref', ''),
                'colour': r.tags.get('colour', ''),
                'ways': ways,
            }
            want.update(ways)

geom = {}
class Ways(osmium.SimpleHandler):
    def way(self, w):
        if w.id in want:
            try:
                geom[w.id] = [[round(n.lon, 6), round(n.lat, 6)] for n in w.nodes]
            except osmium.InvalidLocationError:
                pass

Rels().apply_file('/data/uzbekistan.osm.pbf')
Ways().apply_file('/data/uzbekistan.osm.pbf', locations=True, idx='flex_mem')

feats = []
seen = set()
for rid, l in lines.items():
    # One direction per line is enough: the two directions share the track.
    key = (l['name'].split('(')[0].strip().split(':')[0], l['colour'])
    if key in seen:
        continue
    seen.add(key)
    parts = [geom[w] for w in l['ways'] if w in geom and len(geom[w]) > 1]
    if parts:
        feats.append({'type': 'Feature', 'properties': {'name': l['name'], 'ref': l['ref'], 'colour': l['colour']},
                      'geometry': {'type': 'MultiLineString', 'coordinates': parts}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open('/data/overlays/metro-lines.geojson', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
for f in feats:
    print(f['properties'], len(f['geometry']['coordinates']))
