#!/usr/bin/env bash
set -euo pipefail

import_file="${PHOTON_IMPORT_FILE:-}"
import_threads="${PHOTON_IMPORT_THREADS:-2}"

if [[ -z "${import_file}" || ! -f "${import_file}" ]]; then
  echo "Photon import file does not exist: ${import_file:-<unset>}" >&2
  exit 1
fi

if [[ -e /data/photon_data ]]; then
  echo "Refusing to replace an existing Photon database at /data/photon_data" >&2
  exit 1
fi

zstd --stdout --decompress "${import_file}" \
  | java -jar /opt/photon/photon.jar import \
      -data-dir /data \
      -import-file - \
      -country-codes UZ \
      -languages uz,ru,en \
      -j "${import_threads}"
