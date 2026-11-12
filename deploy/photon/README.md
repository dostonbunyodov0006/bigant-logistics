# Photon geocoder

This stack runs a private, Uzbekistan-only Photon geocoder alongside BIGANT.
Photon is attached to the existing `bigant_default` Docker network and does not
publish a host port. BIGANT services can reach it at `http://photon:2322`.

## Pinned inputs

- Photon: `1.3.0`
- Central Asia JSON dump: `photon-dump-central-asia-release-260906.jsonl.zst`
- Dump MD5: `ad4408876cb2a034e3eaad7b057fbf12`
- Imported country: `UZ`
- Imported languages: `uz,ru,en`
- Import concurrency: `1` (kept deliberately low for reliable embedded OpenSearch bulk writes)

## First deployment

Create the server directories and give the unprivileged Photon user ownership
of the database directory:

```sh
install -d -m 0755 /opt/bigant-geo/photon/imports
install -d -m 0755 -o 10001 -g 10001 /opt/bigant-geo/photon/data-current
```

Download and verify the pinned input dump:

```sh
curl --fail --location --retry 3 \
  https://download1.graphhopper.com/public/asia/central-asia/photon-dump-central-asia-release-260906.jsonl.zst \
  --output /opt/bigant-geo/photon/imports/photon-dump-central-asia-release-260906.jsonl.zst
echo 'ad4408876cb2a034e3eaad7b057fbf12  /opt/bigant-geo/photon/imports/photon-dump-central-asia-release-260906.jsonl.zst' \
  | md5sum --check --strict
```

Build the pinned image and import only Uzbekistan:

```sh
cd /opt/bigant-geo/photon
docker compose build photon
docker compose --profile tools run --rm photon-import
```

Start and verify the private service:

```sh
docker compose up -d photon
docker compose ps
docker compose exec photon \
  curl --fail --silent 'http://127.0.0.1:2322/api?q=Toshkent&countrycode=UZ&lang=uz&limit=3'
```

## Safety properties

- The importer refuses to overwrite an existing `/data/photon_data` database.
- Photon runs as UID/GID `10001`, not root.
- The service has explicit CPU, memory, process and file-descriptor limits.
- The service is reachable only through the BIGANT Docker network.
- Docker logs are rotated.

## Dataset updates

Import a new pinned dump into a new `data-YYYYMMDD` directory. Start a temporary
Photon instance against it and verify `/status`, forward search and reverse
search before changing `PHOTON_DATA_DIR`. Keep the former directory until the
new database has run successfully in production. Never unpack or import a new
dataset over the active directory.
