#!/bin/bash
# LocalStack init hook (ticket 06, ADR-0006). Runs once LocalStack is READY and
# creates the S3 bucket the AI worker's claim-check writes to (ADR-0004 §4).
#
# LocalStack executes every executable script in /etc/localstack/init/ready.d
# after the S3 service is available. The bucket name comes from the environment
# (S3_BUCKET) — connection/config-by-env, no hardcoded value (ADR-0006).
#
# NB LocalStack's S3 default endpoint presents as us-east-1. Passing a
# LocationConstraint for any *other* region against that endpoint raises
# IllegalLocationConstraintException, so we create the bucket in us-east-1
# (region-agnostic for a local emulator). The worker addresses the bucket by
# name only, so the emulator region is irrelevant to the round-trip.
set -euo pipefail

BUCKET="${S3_BUCKET:-tuju-local}"
export AWS_DEFAULT_REGION="us-east-1"

echo "[localstack-init] ensuring S3 bucket exists: ${BUCKET}"

# Idempotent: create only if absent (re-running the init hook must not fail).
if awslocal s3api head-bucket --bucket "${BUCKET}" 2>/dev/null; then
  echo "[localstack-init] bucket already present: ${BUCKET}"
else
  awslocal s3api create-bucket --bucket "${BUCKET}"
  echo "[localstack-init] bucket created: ${BUCKET}"
fi

awslocal s3api list-buckets
