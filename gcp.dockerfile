# check=skip=SecretsUsedInArgOrEnv
# syntax=docker/dockerfile:1.7
# Reproducible build for the GCP Confidential Space deployment.
# Same source + same builder image digest = same OCI tarball sha256.
#
# Base image: node:24.13.0 (Debian bookworm). Pinned by digest so apt
# repositories cannot drift between builds. Update both the tag and the
# digest in lockstep when bumping Node.
ARG NODE_DIGEST=sha256:1de022d8459f896fff2e7b865823699dc7a8d5567507e8b87b14a7442e07f206

FROM node:24.13.0@${NODE_DIGEST} AS builder

# git is required for the few git-resolved entries in package-lock.json
# (@reclaimprotocol/tls, snarkjs). unzip is required by the
# zk-symmetric-crypto download script.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends git unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Two-step copy so the npm ci layer caches independently of source edits.
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./

# package.json declares "prepare": "npm run build", which runs during
# `npm ci` and needs src/ to exist. Stub it so the prepare step is a
# no-op; the real build happens after the source COPY below. The same
# trick is used in attestor.dockerfile.
RUN mkdir -p src/scripts && \
    printf 'console.log("stub")\n' > src/index.ts && \
    printf 'console.log("stub")\n' > src/scripts/build-lib.ts

# `npm ci` resolves strictly from the lockfile; re2's install script first
# tries to download a prebuilt .node from the maintainer's GitHub release
# and only falls back to compiling. The prebuilt path is bit-identical
# across builds; the fallback is not, so we want the prebuilt to succeed.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund \
        --fetch-retries=10 \
        --fetch-retry-mintimeout=60000 \
        --fetch-retry-maxtimeout=300000 \
        --fetch-timeout=600000

# Replace stubs with the real source.
COPY . .

RUN npm run build && \
    npm run download:zk-files && \
    npm run build:browser && \
    npm prune --omit=dev

# ---------------------------------------------------------------------------

FROM node:24.13.0@${NODE_DIGEST} AS runtime

# CA certs come from the base image; nothing else needed at runtime.
WORKDIR /app

# Copy the whole built /app from the builder stage. We rely on the
# builder having pruned dev deps already (`npm prune --omit=dev`).
# `npm run start` invokes `node --experimental-strip-types src/scripts/start-server.ts`
# so we need the source tree, not just lib/.
COPY --from=builder /app /app

# Declare every env var that the deployer is allowed to override via
# instance metadata. Confidential Space enforces a strict policy: only
# variables present here (and listed in the launch_policy label below)
# can be set with `tee-env-<NAME>` at VM creation.
ENV ENCLAVE_MODE=""
ENV ENCLAVE_DOMAIN=""
ENV ACME_EMAIL=""
ENV ACME_DIRECTORY_URL=""
ENV GOOGLE_PROJECT_ID=""
ENV LOG_NAME=""
ENV LOG_LEVEL=""
ENV PORT=""
ENV HTTP_PORT=""
ENV HTTPS_PORT=""
ENV DISABLE_BGP_CHECKS=""

LABEL "tee.launch_policy.allow_env_override"="ENCLAVE_MODE,ENCLAVE_DOMAIN,ACME_EMAIL,ACME_DIRECTORY_URL,GOOGLE_PROJECT_ID,LOG_NAME,LOG_LEVEL,PORT,HTTP_PORT,HTTPS_PORT,DISABLE_BGP_CHECKS"

EXPOSE 80 443
CMD ["npm", "run", "start"]
