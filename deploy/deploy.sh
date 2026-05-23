#!/bin/bash
set -e

# =============================================================================
# attestor-core Confidential Space deployment helper
# =============================================================================
# One-shot setup for the attestor-core VM. Idempotent — re-running only
# changes what needs changing.
#
# Steps:
#   provision  one-time: create service account, grant IAM, reserve IP
#   secrets    one-time: upload signing key + OPRF material to Secret Manager
#   create     create the Confidential Space VM
#   update     update the VM's image reference + tee-env metadata, restart
#   status     show VM state + recent logs
#
# Usage:
#   ./deploy/deploy.sh provision
#   ./deploy/deploy.sh secrets
#   ./deploy/deploy.sh create v1
#   ./deploy/deploy.sh update v2
#   ./deploy/deploy.sh status
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/build.env" || { echo "Missing deploy/build.env (copy from build.env.example)"; exit 1; }

# Required (no defaults — must be set in deploy/build.env):
: "${PROJECT_ID:?PROJECT_ID not set in deploy/build.env}"
: "${DOMAIN:?DOMAIN not set in deploy/build.env}"
: "${ACME_EMAIL:?ACME_EMAIL not set in deploy/build.env}"

# Optional with sensible defaults:
REGISTRY="${REGISTRY:-gcr.io/${PROJECT_ID}}"
ZONE="${ZONE:-asia-south2-a}"
INSTANCE="${INSTANCE:-attestor-prod}"
MACHINE_TYPE="${MACHINE_TYPE:-n2d-standard-2}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-tee-attestor-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
STATIC_IP_NAME="${STATIC_IP_NAME:-attestor-prod-ip}"
REGION="${REGION:-${ZONE%-*}}"
FIREWALL_RULE="${FIREWALL_RULE:-allow-attestor}"
NETWORK_TAG="${NETWORK_TAG:-attestor}"
# Set DEBUG=1 to use the debug Confidential Space image (SSH-able) and
# stream container stdout/stderr to Cloud Logging via the launcher
# (so crashes before our installCloudLogging are visible).
DEBUG_MODE="${DEBUG:-0}"
if [[ "${DEBUG_MODE}" == "1" ]]; then
    IMAGE_FAMILY="confidential-space-debug"
    LOG_REDIRECT="true"
else
    IMAGE_FAMILY="confidential-space"
    LOG_REDIRECT="false"
fi

log() { echo "[$(date '+%H:%M:%S')] $1"; }
err() { echo "[ERROR] $1" >&2; exit 1; }

cmd_provision() {
    log "Creating service account ${SERVICE_ACCOUNT}"
    gcloud iam service-accounts describe "${SERVICE_ACCOUNT}" --project="${PROJECT_ID}" >/dev/null 2>&1 \
        || gcloud iam service-accounts create "tee-attestor-sa" \
            --display-name="attestor-core (Confidential Space)" \
            --project="${PROJECT_ID}"

    log "Granting roles/secretmanager.secretAccessor"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role="roles/secretmanager.secretAccessor" \
        --condition=None >/dev/null

    log "Granting roles/secretmanager.secretVersionAdder (for ACME cert + account state writeback)"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role="roles/secretmanager.secretVersionAdder" \
        --condition=None >/dev/null

    log "Granting roles/secretmanager.admin (for attestor to create its own cert/account secrets on first boot)"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role="roles/secretmanager.admin" \
        --condition=None >/dev/null

    log "Granting roles/logging.logWriter"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role="roles/logging.logWriter" \
        --condition=None >/dev/null

    log "Granting roles/confidentialcomputing.workloadUser"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role="roles/confidentialcomputing.workloadUser" \
        --condition=None >/dev/null

    # gcr.io in this project is fronted by Artifact Registry, so the
    # right grant is artifactregistry.reader on the gcr.io repo (not the
    # legacy GCS bucket). The repo lives in location=us by default.
    log "Granting roles/artifactregistry.reader on gcr.io (so launcher can pull)"
    gcloud artifacts repositories add-iam-policy-binding gcr.io \
        --location=us \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role=roles/artifactregistry.reader \
        --project="${PROJECT_ID}" >/dev/null

    log "Reserving static external IP ${STATIC_IP_NAME} in ${REGION}"
    gcloud compute addresses describe "${STATIC_IP_NAME}" \
        --region="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1 \
        || gcloud compute addresses create "${STATIC_IP_NAME}" \
            --region="${REGION}" --project="${PROJECT_ID}"

    IP=$(gcloud compute addresses describe "${STATIC_IP_NAME}" \
        --region="${REGION}" --project="${PROJECT_ID}" --format='value(address)')
    log "Static IP: ${IP}"
    log "Set DNS A record: ${DOMAIN} -> ${IP}"

    log "Creating firewall rule ${FIREWALL_RULE}"
    gcloud compute firewall-rules describe "${FIREWALL_RULE}" --project="${PROJECT_ID}" >/dev/null 2>&1 \
        || gcloud compute firewall-rules create "${FIREWALL_RULE}" \
            --allow=tcp:80,tcp:443 \
            --target-tags="${NETWORK_TAG}" \
            --project="${PROJECT_ID}"
}

cmd_secrets() {
    [[ -z "${SIGNING_KEY:-}" ]] && err "SIGNING_KEY env var required (0x-prefixed hex)"
    [[ -z "${TOPRF_PUBLIC_KEY:-}" ]] && err "TOPRF_PUBLIC_KEY env var required"
    [[ -z "${TOPRF_SHARE_PRIVATE_KEY:-}" ]] && err "TOPRF_SHARE_PRIVATE_KEY env var required"
    [[ -z "${TOPRF_SHARE_PUBLIC_KEY:-}" ]] && err "TOPRF_SHARE_PUBLIC_KEY env var required"

    upload() {
        local id="$1" value="$2"
        if gcloud secrets describe "${id}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
            printf '%s' "${value}" | gcloud secrets versions add "${id}" \
                --project="${PROJECT_ID}" --data-file=-
        else
            printf '%s' "${value}" | gcloud secrets create "${id}" \
                --replication-policy=automatic \
                --project="${PROJECT_ID}" --data-file=-
        fi
        log "Uploaded ${id}"
    }
    upload attestor-signing-key         "${SIGNING_KEY}"
    upload attestor-toprf-public        "${TOPRF_PUBLIC_KEY}"
    upload attestor-toprf-share-private "${TOPRF_SHARE_PRIVATE_KEY}"
    upload attestor-toprf-share-public  "${TOPRF_SHARE_PUBLIC_KEY}"
}

build_metadata() {
    local image_ref="$1"
    cat <<EOF
tee-image-reference=${image_ref}
tee-restart-policy=Never
tee-container-log-redirect=${LOG_REDIRECT}
tee-env-ENCLAVE_MODE=true
tee-env-ENCLAVE_DOMAIN=${DOMAIN}
tee-env-ACME_EMAIL=${ACME_EMAIL}
tee-env-GOOGLE_PROJECT_ID=${PROJECT_ID}
tee-env-LOG_NAME=attestor-core
tee-env-LOG_LEVEL=info
tee-env-DISABLE_BGP_CHECKS=1
EOF
}

cmd_create() {
    local tag="${1:-v1}"
    local image_ref="${REGISTRY}/attestor-core:${tag}"
    local digest
    digest=$(gcloud container images describe "${image_ref}" \
        --project="${PROJECT_ID}" --format='value(image_summary.digest)') \
        || err "Image ${image_ref} not found in registry"
    local pinned="${REGISTRY}/attestor-core@${digest}"
    log "Pinned image: ${pinned}"

    local meta
    meta=$(build_metadata "${pinned}" | tr '\n' '~' | sed 's/~$//')
    local ip
    ip=$(gcloud compute addresses describe "${STATIC_IP_NAME}" \
        --region="${REGION}" --project="${PROJECT_ID}" --format='value(address)')

    log "Creating ${INSTANCE} in ${ZONE} (machine ${MACHINE_TYPE})"
    gcloud compute instances create "${INSTANCE}" \
        --project="${PROJECT_ID}" \
        --zone="${ZONE}" \
        --machine-type="${MACHINE_TYPE}" \
        --confidential-compute-type=SEV \
        --shielded-secure-boot \
        --maintenance-policy=TERMINATE \
        --service-account="${SERVICE_ACCOUNT}" \
        --scopes=cloud-platform \
        --image-family="${IMAGE_FAMILY}" \
        --image-project=confidential-space-images \
        --address="${ip}" \
        --metadata="^~^${meta}" \
        --tags="${NETWORK_TAG}"
}

cmd_update() {
    local tag="${1:-v1}"
    local image_ref="${REGISTRY}/attestor-core:${tag}"
    local digest
    digest=$(gcloud container images describe "${image_ref}" \
        --project="${PROJECT_ID}" --format='value(image_summary.digest)')
    local pinned="${REGISTRY}/attestor-core@${digest}"
    log "Pinned image: ${pinned}"

    local meta
    meta=$(build_metadata "${pinned}" | tr '\n' '~' | sed 's/~$//')

    log "Updating metadata on ${INSTANCE}"
    gcloud compute instances add-metadata "${INSTANCE}" \
        --project="${PROJECT_ID}" --zone="${ZONE}" \
        --metadata="^~^${meta}"

    log "Restarting ${INSTANCE}"
    gcloud compute instances stop "${INSTANCE}" --project="${PROJECT_ID}" --zone="${ZONE}"
    gcloud compute instances start "${INSTANCE}" --project="${PROJECT_ID}" --zone="${ZONE}"
}

cmd_status() {
    log "Instance state"
    gcloud compute instances describe "${INSTANCE}" \
        --project="${PROJECT_ID}" --zone="${ZONE}" \
        --format='value(status,networkInterfaces[0].accessConfigs[0].natIP)'

    log "Recent Cloud Logging entries (last 10 min, ${INSTANCE})"
    gcloud logging read \
        "resource.type=gce_instance AND resource.labels.instance_id=$(gcloud compute instances describe "${INSTANCE}" --project="${PROJECT_ID}" --zone="${ZONE}" --format='value(id)')" \
        --project="${PROJECT_ID}" \
        --freshness=10m \
        --limit=20 \
        --format='table(timestamp,severity,jsonPayload.message)'
}

cmd_recreate() {
    local tag="${1:-v1}"
    log "Deleting ${INSTANCE} (image family is set at create time, so a switch needs delete+create)"
    gcloud compute instances delete "${INSTANCE}" \
        --project="${PROJECT_ID}" --zone="${ZONE}" --quiet 2>&1 | tail -2 || true
    cmd_create "${tag}"
}

case "${1:-}" in
    provision) cmd_provision ;;
    secrets)   cmd_secrets ;;
    create)    cmd_create "${2:-}" ;;
    update)    cmd_update "${2:-}" ;;
    recreate)  cmd_recreate "${2:-}" ;;
    status)    cmd_status ;;
    *) echo "Usage: $0 {provision|secrets|create <tag>|update <tag>|recreate <tag>|status}"; exit 1 ;;
esac
