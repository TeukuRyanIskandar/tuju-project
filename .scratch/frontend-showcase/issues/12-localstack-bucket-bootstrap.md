# 12 — Make LocalStack artifact-bucket bootstrap reproducible

Status: ready-for-agent
Type: task
Blocked by: none

## Evidence and temporary recovery

On fresh local startup, `awslocal s3api list-buckets` returned no buckets. LocalStack
logs show permission denied executing `init/ready.d/create-bucket.sh`; git tracks
that hook as non-executable (`100644`). `seed-prospectus` consequently failed with
NoSuchBucket. The audit created the local emulator bucket explicitly, then seeded
all three PDFs/listings successfully. See [readiness.md](../readiness.md).

## Work / acceptance

Fix executable permissions (or provide an equivalent supported executable init
hook) without adding cloud credentials. Confirm creation works on a fresh isolated
LocalStack instance and re-running the hook is idempotent. Preserve existing
operator data: do not tear down/reset the current database or artifact bucket to
test the fix. Record the permission-only/config change and verification.
