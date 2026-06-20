#!/usr/bin/env bash
set -euo pipefail

: "${ISECURE_COGNITO_USER_POOL_ID:?Set ISECURE_COGNITO_USER_POOL_ID}"
: "${ISECURE_DYNAMODB_USERS_TABLE:?Set ISECURE_DYNAMODB_USERS_TABLE}"
: "${ISECURE_EMAIL:?Set ISECURE_EMAIL}"

username_email=${ISECURE_EMAIL//@/_at_}
username_email=${username_email//+/_}
username_email=${username_email//./_}

aws cognito-idp admin-delete-user \
  --user-pool-id "$ISECURE_COGNITO_USER_POOL_ID" \
  --username "e_${username_email}__admin" || true

aws cognito-idp admin-delete-user \
  --user-pool-id "$ISECURE_COGNITO_USER_POOL_ID" \
  --username "e_${username_email}__data" || true

aws dynamodb delete-item \
  --table-name "$ISECURE_DYNAMODB_USERS_TABLE" \
  --key "{\"email\":{\"S\":\"$ISECURE_EMAIL\"}}" || true
