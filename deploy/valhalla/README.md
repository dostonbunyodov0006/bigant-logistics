# Valhalla routing engine

This stack runs a private Valhalla routing service for Uzbekistan alongside
BIGANT. It joins the existing `bigant_default` Docker network and publishes no
host port. BIGANT containers can reach it at `http://valhalla:8002`.

## Pinned inputs

- Valhalla: `3.8.3-amd64`
- Image digest: `sha256:600caefda81d6ef8e6e85fa0493213cf1723cff3665a04da592f6898d931c31f`
- OSM extract: `uzbekistan-260915.osm.pbf`
- Extract MD5: `89dd5f8677e1b1f8943a9bb8d5fbad9e`
- Build concurrency: `2`
- Admin and time-zone databases: enabled
- Elevation and transit data: disabled

## First deployment

```sh
install -d -m 0755 /opt/bigant-geo/valhalla
cp docker-compose.yml prepare-data.sh README.md /opt/bigant-geo/valhalla/
chmod 0755 /opt/bigant-geo/valhalla/prepare-data.sh
cd /opt/bigant-geo/valhalla
./prepare-data.sh
docker compose config --quiet
docker compose up -d
docker compose logs -f valhalla
```

The first start builds the routing graph and can take several minutes. Later
starts load the existing `valhalla_tiles.tar` instead of rebuilding it.

## Verification

```sh
docker compose ps
docker compose exec valhalla \
  curl --fail --silent http://127.0.0.1:8002/status
```

From another BIGANT container, the private service should resolve as
`http://valhalla:8002`.

## Safety properties

- The image and OSM input are pinned and checksum-verified.
- Valhalla runs as UID/GID `10001`, not root.
- The service has CPU, memory, process, and file-descriptor limits.
- Port 8002 is available only inside the BIGANT Docker network.
- Docker logs are rotated.
- Existing graph data is never overwritten by `prepare-data.sh`.

## Dataset updates

Automatic updates are intentionally not enabled. Build a newer pinned extract
in a separate `data-YYYYMMDD` directory, verify the replacement service, then
change `VALHALLA_DATA_DIR`. Keep the previous directory until the new graph has
run successfully in production.
