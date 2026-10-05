#!/usr/bin/env bash
# Rebuild apps/web/src/lib/tariffs/geo/za-local-municipalities-2021.json from the
# Municipal Demarcation Board's local-municipality FeatureServer (provenance and
# licence: docs/tariffs/mdb-boundaries-source.json). Needs node 18+, python3 with
# shapely (pip install --user shapely), and network access.
#   scripts/tariffs/build-municipal-boundaries.sh [FeatureServer layer URL]
# After MDB's 2026 boundaries take effect (2026-11-04), pass the new layer URL,
# re-check docs/tariffs/licensee-mdb-mapping.json, and rename the output file.
set -euo pipefail
LAYER="${1:-https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/LocalMunicipalities2018_Final/FeatureServer/0}"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/apps/web/src/lib/tariffs/geo/za-local-municipalities-2021.json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
LAYER="$LAYER" node -e '
const base=process.env.LAYER+"/query";
(async()=>{const all=[];for(let off=0;off<1000;off+=50){
  const r=await fetch(`${base}?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultOffset=${off}&resultRecordCount=50`);
  const j=await r.json(); if(!j.features||!j.features.length)break; all.push(...j.features)}
  require("fs").writeFileSync("raw.geojson",JSON.stringify({type:"FeatureCollection",features:all}));console.log("fetched",all.length)})()'
npx -y mapshaper@0.7.76 raw.geojson \
  -each 'code=CAT_B, name=MUNICNAME, province=(PROVINCE=="LIM"?"LP":PROVINCE=="GT"?"GP":PROVINCE), category=CATEGORY' \
  -filter-fields code,name,province,category -simplify 5% keep-shapes -o simplified.geojson precision=0.0001
python3 - "$OUT" <<'PY'
import json, sys
from shapely.geometry import shape, mapping
from shapely.validation import make_valid
from shapely.ops import unary_union
def rnd(c): return [round(c[0],4),round(c[1],4)] if isinstance(c[0],(int,float)) else [rnd(x) for x in c]
def valid(s):
    if s.is_valid: return s
    v=make_valid(s); return unary_union([p for p in getattr(v,'geoms',[v]) if p.geom_type in ('Polygon','MultiPolygon')])
g=json.load(open('simplified.geojson'))
for f in g['features']:
    s=valid(shape(f['geometry'])); m=mapping(s); geom={'type':m['type'],'coordinates':rnd(m['coordinates'])}
    if not shape(geom).is_valid:
        m=mapping(valid(shape(geom))); geom={'type':m['type'],'coordinates':rnd(m['coordinates'])}
    f['geometry']=geom
codes=[f['properties']['code'] for f in g['features']]
assert len(codes)==len(set(codes)), 'duplicate MDB codes'
assert all(shape(f['geometry']).is_valid for f in g['features']), 'invalid geometry after repair'
json.dump(g,open(sys.argv[1],'w'),separators=(',',':'))
print('wrote', len(codes), 'municipalities to', sys.argv[1])
PY
