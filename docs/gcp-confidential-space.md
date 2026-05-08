# Running attestor-core in GCP Confidential Space

Operator guide for deploying the attestor inside a GCP Confidential Space
VM. The image runs the same code as the standalone deployment plus a TEE
bootstrap that:

- terminates TLS inside the enclave with a Let's Encrypt certificate;
- pulls the signing key and OPRF share material from Secret Manager;
- attaches a GCP attestation JWT to every signed claim
  (`signatures.claimAttestation` on the wire);
- streams logs to Cloud Logging.

All TEE behavior is gated on `ENCLAVE_MODE=true`. Without it, the binary
behaves identically to the existing non-TEE deployment.

## Configuration

`deploy/deploy.sh` reads `deploy/build.env` (gitignored). Required:

- `PROJECT_ID` — GCP project that holds the registry, secrets, and VM.
- `DOMAIN` — the public hostname the attestor terminates TLS on.
- `ACME_EMAIL` — passed to Let's Encrypt during account registration.

Optional overrides (sensible defaults in `deploy.sh`):

| Setting | Default |
|---|---|
| Registry | `gcr.io/${PROJECT_ID}` |
| Service account | `tee-attestor-sa@${PROJECT_ID}.iam.gserviceaccount.com` |
| Zone | `asia-south2-a` |
| Machine type | `n2d-standard-2` |
| Instance name | `attestor-prod` |
| Static IP name | `attestor-prod-ip` |
| Firewall rule | `allow-attestor` (tcp:80,443 on tag `attestor`) |

## One-time prerequisites

```bash
# 1. Create deploy/build.env from the example.
cp deploy/build.env.example deploy/build.env
# (edit if you want non-defaults)

# 2. Provision SA, IAM grants, static IP, firewall.
./deploy/deploy.sh provision
# Note the printed IP — set the DNS A record for the domain to point
# at it BEFORE creating the VM, otherwise the first ACME order fails
# and the VM logs the failure (recoverable: see "First-boot recovery").

# 3. Generate keys locally and upload to Secret Manager.
SIGNING_KEY=$(openssl rand -hex 32)
eval "$(npm run --silent generate:toprf-keys 2>&1 | grep -E '^(TOPRF|TOPRF_SHARE)')"
SIGNING_KEY="0x${SIGNING_KEY}" \
TOPRF_PUBLIC_KEY="${TOPRF_PUBLIC_KEY}" \
TOPRF_SHARE_PRIVATE_KEY="${TOPRF_SHARE_PRIVATE_KEY}" \
TOPRF_SHARE_PUBLIC_KEY="${TOPRF_SHARE_PUBLIC_KEY}" \
    ./deploy/deploy.sh secrets
```

## Build & push the image

The image is reproducible — same git commit + same builder image digest
yields the same OCI tarball sha256, which means the same image digest in
the registry, which is what the GCP attestation pins via
`submods.container.image_digest`.

```bash
# Build, push, and verify reproducibility:
./deploy/build.sh v1 --verify

# Output ends with:
#   Image: gcr.io/${PROJECT_ID}/attestor-core:v1
#   Digest: sha256:...
#   Result: MATCH (bit-for-bit reproducible)
```

Customers can rebuild from the same git commit and confirm the digest
matches what you've deployed.

## Create the VM

```bash
./deploy/deploy.sh create v1
```

This creates the VM (`${INSTANCE}` in `${ZONE}`) with:
- Confidential SEV, shielded secure boot, terminate-on-host-maintenance.
- The static IP from `provision`.
- Image pinned by digest (so the running image cannot be swapped under
  the attestation).
- All `tee-env-*` metadata for the bootstrap.

## First-boot recovery

If DNS isn't ready before VM creation, ACME HTTP-01 fails on first boot.
The attestor logs the failure to Cloud Logging and does not start the
HTTPS listener. To recover:

1. Confirm the DNS A record points at the static IP and has propagated
   (`dig +short ${DOMAIN}`).
2. Restart the VM: `gcloud compute instances reset ${INSTANCE}
   --zone=${ZONE} --project=${PROJECT_ID}`. The bootstrap retries the
   ACME order on every start.

## Updates

```bash
# Build a new tag.
./deploy/build.sh v2

# Re-pin the VM at the new digest and restart.
./deploy/deploy.sh update v2
```

The cert and ACME account state in Secret Manager survive the restart;
the renewal loop picks up where it left off.

## Inspecting

```bash
./deploy/deploy.sh status
```

Or query Cloud Logging directly:

```bash
gcloud logging read \
    "resource.type=\"gce_instance\" AND logName=\"projects/${PROJECT_ID}/logs/attestor-core\"" \
    --project=${PROJECT_ID} \
    --freshness=1h --limit=50 \
    --format='table(timestamp,severity,jsonPayload.message)'
```

## Verifying a TEE-signed claim

A consumer who wants end-to-end trust:

```ts
import { validateGcpAttestationAndExtractKey }
    from '@reclaimprotocol/attestor-core/lib/server/utils/gcp-attestation.js'

const { signatures } = claimTunnelResponse
if (!signatures?.claimAttestation?.report?.length) {
    throw new Error('not a TEE-signed claim')
}

const r = await validateGcpAttestationAndExtractKey(
    signatures.claimAttestation.report
)
if (!r.isValid) throw new Error(r.errors.join(', '))
if (r.userDataType !== 'attestor') throw new Error('wrong nonce kind')
const expected = signatures.attestorAddress.toLowerCase()
const got = '0x' + Buffer.from(r.ethAddress!).toString('hex').toLowerCase()
if (got !== expected) throw new Error('attestation does not match signer')

// r.pcr0 holds submods.container.image_digest. Pin this against the
// image_digest you built and pushed (./deploy/build.sh prints it).
```

## How it works at boot

`src/scripts/start-server.ts` calls `bootstrapTee()` when
`ENCLAVE_MODE=true`. `src/server/tee/bootstrap.ts`:

1. `installCloudLogging` — replaces pino's stdout destination with a
   stream that posts entries to Cloud Logging under `LOG_NAME`. From
   this point on every log line lands in Cloud Logging.
2. `loadSecretsIntoEnv` — fetches `attestor-signing-key`,
   `attestor-toprf-share-private`, `attestor-toprf-share-public`,
   `attestor-toprf-public` from Secret Manager and populates
   `process.env` so the existing `getEnvVariable` consumers see them.
3. `bootstrapCertificate` — tries `attestor-tls-cert-<domain>` first;
   if absent or within 14 days of expiry, runs ACME HTTP-01 against
   `ACME_DIRECTORY_URL` (port 80 bound only for the order, then
   released) and persists the cert + ACME account state.
4. `startRenewalLoop` — daily check, hot-swap via `SNICallback`.
5. `startAttestationRefresh` — calls the launcher socket at
   `/run/container_launcher/teeserver.sock` `/v1/token` with two
   nonces:
   - `attestor_public_key:<eth-address>`
   - `attestor_cert_hash:<sha256-hex of leaf cert>`
   JWT cached 5 minutes, refreshed every 4. Every claim response
   carries the cached JWT in `signatures.claimAttestation`.
