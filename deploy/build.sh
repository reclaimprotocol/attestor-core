#!/bin/bash
set -e

# =============================================================================
# attestor-core reproducible build
# =============================================================================
# Builds and pushes a bit-for-bit reproducible image of attestor-core for
# GCP Confidential Space. Same git commit + same builder image digest =
# same OCI tarball sha256, so customers can rebuild and verify what's
# running.
#
# Flow: deterministic OCI tarball -> crane push (preserves digest)
#
# Requirements:
#   - Docker with buildx
#   - crane (go install github.com/google/go-containerregistry/cmd/crane@latest)
#   - deploy/build.env with REGISTRY (gitignored)
#
# Usage:
#   ./deploy/build.sh [tag] [commit] [--verify]
#   ./deploy/build.sh                     # tag=v1, HEAD
#   ./deploy/build.sh v2                  # explicit tag, HEAD
#   ./deploy/build.sh v2 abc123           # explicit tag, specific commit
#   ./deploy/build.sh v2 --verify         # build + reproducibility check
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"

# Pinned BuildKit. Update this digest when upgrading by running:
#   crane digest moby/buildkit:buildx-stable-1
BUILDKIT_IMAGE="moby/buildkit:buildx-stable-1@sha256:0039c1d47e8748b5afea56f4e85f14febaf34452bd99d9552d2daa82262b5cc5"

# Pinned base image. Must match FROM in gcp.dockerfile.
NODE_IMAGE_DIGEST="sha256:1de022d8459f896fff2e7b865823699dc7a8d5567507e8b87b14a7442e07f206"

BUILD_ENV="${SCRIPT_DIR}/build.env"
if [[ ! -f "${BUILD_ENV}" ]]; then
    echo "Missing ${BUILD_ENV}. Create it with:"
    echo "  REGISTRY=gcr.io/your-gcp-project"
    exit 1
fi
source "${BUILD_ENV}"

: "${REGISTRY:?REGISTRY not set in deploy/build.env}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
    echo "[ERROR] $1" >&2
    exit 1
}

IMAGE_TAG="${1:-v1}"
COMMIT="${2:-}"
VERIFY="${3:-}"

# Allow `./build.sh v1 --verify` (commit defaults to HEAD).
if [[ "${COMMIT}" == "--verify" ]]; then
    VERIFY="--verify"
    COMMIT=""
fi

IMAGE="${REGISTRY}/attestor-core:${IMAGE_TAG}"

if [[ -n "${COMMIT}" ]]; then
    export SOURCE_DATE_EPOCH=$(git -C "${REPO_ROOT}" log -1 --pretty=%ct "${COMMIT}")
    log "SOURCE_DATE_EPOCH from commit ${COMMIT}: ${SOURCE_DATE_EPOCH}"
else
    COMMIT=$(git -C "${REPO_ROOT}" rev-parse HEAD)
    export SOURCE_DATE_EPOCH=$(git -C "${REPO_ROOT}" log -1 --pretty=%ct)
    log "SOURCE_DATE_EPOCH from HEAD (${COMMIT:0:12}): ${SOURCE_DATE_EPOCH}"
fi

TMPDIR=$(mktemp -d)
trap "rm -rf ${TMPDIR}" EXIT

command -v crane >/dev/null 2>&1 \
    || error "crane not found. Install: go install github.com/google/go-containerregistry/cmd/crane@latest"

# Normalize file mtimes to SOURCE_DATE_EPOCH. git checkout sets mtimes
# to checkout time, which varies between environments.
find "${REPO_ROOT}" \
    -not -path '*/.git/*' \
    -not -path '*/node_modules/*' \
    -exec touch -d "@${SOURCE_DATE_EPOCH}" {} + 2>/dev/null || true

# Reuse pinned BuildKit builder if it exists; else create.
BUILDER_NAME="attestor-repro"
if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
    log "Creating pinned builder: ${BUILDER_NAME}"
    docker buildx create --name "${BUILDER_NAME}" \
        --driver docker-container \
        --driver-opt image="${BUILDKIT_IMAGE}" \
        --bootstrap
fi
BUILDER_FLAG="--builder=${BUILDER_NAME}"

build_to_tar() {
    local out="$1"
    docker buildx build ${BUILDER_FLAG} --no-cache \
        --build-arg "NODE_DIGEST=${NODE_IMAGE_DIGEST}" \
        -f "${REPO_ROOT}/gcp.dockerfile" \
        -o "type=oci,dest=${out},rewrite-timestamp=true" \
        "${REPO_ROOT}"
}

log "Building reproducible image"
log "  Image:  ${IMAGE}"
log "  Commit: ${COMMIT}"
log "  Epoch:  ${SOURCE_DATE_EPOCH}"

build_to_tar "${TMPDIR}/attestor.tar"
log "Build complete"

# Extract OCI layout and push with crane to preserve the exact digest
# produced by the build.
mkdir -p "${TMPDIR}/oci"
tar -xf "${TMPDIR}/attestor.tar" -C "${TMPDIR}/oci"

log "Pushing to ${IMAGE}"
crane push "${TMPDIR}/oci" "${IMAGE}"

DIGEST=$(crane digest "${IMAGE}")
echo
echo "============================================="
echo "Image: ${IMAGE}"
echo "Digest: ${DIGEST}"
echo "============================================="

if [[ "${VERIFY}" == "--verify" ]]; then
    log "Rebuilding from scratch to verify reproducibility"
    build_to_tar "${TMPDIR}/verify.tar"

    HASH_ORIG=$(sha256sum "${TMPDIR}/attestor.tar" | cut -d' ' -f1)
    HASH_VERIFY=$(sha256sum "${TMPDIR}/verify.tar" | cut -d' ' -f1)

    echo
    echo "Reproducibility verification:"
    echo "  Build 1: ${HASH_ORIG}"
    echo "  Build 2: ${HASH_VERIFY}"
    if [[ "${HASH_ORIG}" == "${HASH_VERIFY}" ]]; then
        echo "  Result:  MATCH (bit-for-bit reproducible)"
    else
        echo "  Result:  MISMATCH"
        echo
        echo "Inspect differences with:"
        echo "  diff <(tar -tvf ${TMPDIR}/attestor.tar | sort) <(tar -tvf ${TMPDIR}/verify.tar | sort)"
        exit 1
    fi
fi
