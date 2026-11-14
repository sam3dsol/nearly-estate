# Nearly Estate server, built to run inside a confidential VM (Intel TDX on Phala Cloud, dstack).
# What the TEE's attestation quote measures is this image (through the compose file's hash): the same source, the same
# dependencies, the same start command. The data dir holds the hidden accounts and the feed-token secret and lives on the
# CVM's encrypted disk; nobody outside the enclave, the team included, can read it.
FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./
# the data dir is a volume on the CVM's encrypted disk (see docker-compose.yml)
ENV PORT=8830 DATA=/data ORIGIN=*
RUN mkdir -p /data && chown node:node /data
EXPOSE 8830
USER node
CMD ["node", "index.mjs"]
