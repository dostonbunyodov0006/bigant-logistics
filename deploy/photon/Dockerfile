FROM eclipse-temurin:21-jre@sha256:f5e749f83c8a6d0b14b729ad35eebb9a96493b38178d2ddd5429e5a0733b6ee5

ARG PHOTON_VERSION=1.3.0
ARG PHOTON_SHA256=a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl tini zstd \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 photon \
    && useradd --uid 10001 --gid photon --create-home --shell /usr/sbin/nologin photon

WORKDIR /opt/photon

RUN curl --fail --location --retry 3 \
      "https://github.com/komoot/photon/releases/download/${PHOTON_VERSION}/photon-${PHOTON_VERSION}.jar" \
      --output photon.jar \
    && echo "${PHOTON_SHA256}  photon.jar" | sha256sum --check --strict

COPY import.sh /opt/photon/import.sh

RUN chmod 0755 /opt/photon/import.sh \
    && mkdir -p /data /imports \
    && chown -R photon:photon /opt/photon /data /imports

USER photon

EXPOSE 2322

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["java", "-jar", "/opt/photon/photon.jar", "serve", "-data-dir", "/data", "-listen-ip", "0.0.0.0", "-listen-port", "2322", "-default-language", "uz", "-max-results", "10", "-max-reverse-results", "10", "-query-timeout", "5", "-metrics-enable", "prometheus"]
