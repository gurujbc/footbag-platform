#!/usr/bin/env bash
# Self-contained runner for tests/smoke/*.test.ts.
# Reads environment-specific values from terraform output; hardcodes the
# stable ones. No operator-side env setup required.

set -euo pipefail

cd "$(dirname "$0")/.."

JWT_KMS_KEY_ID="$(terraform -chdir=terraform/staging output -raw jwt_signing_key_arn)"
SES_FROM_IDENTITY="$(terraform -chdir=terraform/staging output -raw ses_sender_identity)"
PHOTO_STORAGE_S3_BUCKET="$(terraform -chdir=terraform/staging output -raw media_bucket_name)"

export AWS_PROFILE=footbag-staging-runtime
export AWS_REGION=us-east-1
export JWT_KMS_KEY_ID
export SES_FROM_IDENTITY
export PHOTO_STORAGE_S3_BUCKET
export RUN_STAGING_SMOKE=1

exec node_modules/.bin/vitest run tests/smoke/
