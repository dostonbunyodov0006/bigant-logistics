#!/usr/bin/env bash
set -euo pipefail

readonly data_dir="${VALHALLA_DATA_DIR:-/opt/bigant-geo/valhalla/data-current}"
readonly pbf_name="uzbekistan-260915.osm.pbf"
readonly pbf_url="https://download.geofabrik.de/asia/${pbf_name}"
readonly pbf_md5="89dd5f8677e1b1f8943a9bb8d5fbad9e"
readonly pbf_path="${data_dir}/${pbf_name}"

install -d -m 0755 -o 10001 -g 10001 "${data_dir}"

if [[ -e "${pbf_path}" ]]; then
  echo "Refusing to overwrite existing input: ${pbf_path}" >&2
  exit 1
fi

curl --fail --location --retry 3 --output "${pbf_path}.part" "${pbf_url}"
echo "${pbf_md5}  ${pbf_path}.part" | md5sum --check --strict
mv "${pbf_path}.part" "${pbf_path}"
chown 10001:10001 "${pbf_path}"
chmod 0644 "${pbf_path}"

echo "Prepared ${pbf_path}"
