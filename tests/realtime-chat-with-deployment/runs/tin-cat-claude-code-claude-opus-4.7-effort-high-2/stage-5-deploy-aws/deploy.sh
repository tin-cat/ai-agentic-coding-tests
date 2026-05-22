#!/usr/bin/env bash
#
# deploy.sh — deploy the real-time chat app to AWS with one command.
#
# It builds the app's Docker image, provisions all infrastructure with AWS CDK
# (VPC, EFS, Fargate, ALB, CloudFront), and prints the public HTTPS URL. Run it
# again after code changes to update the app in place; persisted message history
# on EFS is preserved across deploys.
#
# Usage:
#   ./deploy.sh                 # deploy / update
#   ./deploy.sh --destroy       # tear down (EFS data is RETAINED, not deleted)
#
# Prerequisites: AWS credentials configured, Docker running, Node.js >= 18.
# See README.md ("Deploying to AWS") for the full list and environment variables.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${SCRIPT_DIR}/deploy"
STACK_NAME="RealtimeChatStack"

# --- pretty output ----------------------------------------------------------
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- prerequisite checks ----------------------------------------------------
info "Checking prerequisites"

command -v node  >/dev/null 2>&1 || fail "Node.js is required but not found. Install Node >= 18."
command -v npm   >/dev/null 2>&1 || fail "npm is required but not found."
command -v aws   >/dev/null 2>&1 || fail "AWS CLI is required but not found. Install the AWS CLI v2."
command -v docker >/dev/null 2>&1 || fail "Docker is required but not found. Install Docker."

# Docker daemon must be running (CDK builds the container image locally).
docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon isn't running. Start Docker and retry."

# Credentials must be valid.
if ! CALLER="$(aws sts get-caller-identity --output text --query 'Account' 2>/dev/null)"; then
	fail "AWS credentials are not configured or are invalid. Run 'aws configure' (or set AWS_PROFILE / env vars)."
fi
ACCOUNT_ID="${CALLER}"

# Resolve the region from the usual sources.
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
[ -n "${REGION}" ] || fail "No AWS region set. Export AWS_REGION=<region> or run 'aws configure'."

ok "AWS account ${ACCOUNT_ID}, region ${REGION}"

# Make the account/region available to the CDK toolkit (bootstrap/deploy).
export CDK_DEFAULT_ACCOUNT="${ACCOUNT_ID}"
export CDK_DEFAULT_REGION="${REGION}"

# --- handle teardown --------------------------------------------------------
if [ "${1:-}" = "--destroy" ]; then
	info "Destroying stack ${STACK_NAME} (EFS data is retained)"
	( cd "${DEPLOY_DIR}" && npx cdk destroy "${STACK_NAME}" --force )
	ok "Stack destroyed. The EFS file system holding chat history was retained."
	warn "Delete it manually from the EFS console if you no longer need the data."
	exit 0
fi

# --- install CDK toolchain --------------------------------------------------
info "Installing CDK dependencies"
( cd "${DEPLOY_DIR}" && npm install --no-audit --no-fund >/dev/null )
ok "Dependencies installed"

# --- look up the CloudFront origin-facing prefix list -----------------------
# Used to lock the ALB security group to CloudFront's IP ranges so the origin
# can't be reached directly. Best-effort: if we can't resolve it, the stack
# falls back to a public ALB ingress and warns.
info "Resolving CloudFront origin-facing prefix list for ${REGION}"
PREFIX_LIST_ID="$(aws ec2 describe-managed-prefix-lists \
	--region "${REGION}" \
	--filters "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing" \
	--query 'PrefixLists[0].PrefixListId' --output text 2>/dev/null || true)"

CONTEXT_ARGS=()
if [ -n "${PREFIX_LIST_ID}" ] && [ "${PREFIX_LIST_ID}" != "None" ]; then
	ok "Prefix list ${PREFIX_LIST_ID}"
	CONTEXT_ARGS+=(--context "cloudfrontPrefixListId=${PREFIX_LIST_ID}")
else
	warn "Could not resolve the CloudFront prefix list; the ALB will accept public HTTP."
fi

# --- forward optional app configuration as CDK context ----------------------
# Any of these set in the environment are passed through to the container.
for pair in \
	"bannedWords:BANNED_WORDS" \
	"allowedOrigins:ALLOWED_ORIGINS" \
	"maxMessageLength:MAX_MESSAGE_LENGTH" \
	"rateLimitMax:RATE_LIMIT_MAX" \
	"rateLimitWindowMs:RATE_LIMIT_WINDOW_MS"; do
	ctx_key="${pair%%:*}"
	env_key="${pair##*:}"
	value="${!env_key:-}"
	if [ -n "${value}" ]; then
		CONTEXT_ARGS+=(--context "${ctx_key}=${value}")
	fi
done

# --- bootstrap the environment (idempotent) ---------------------------------
info "Ensuring the CDK environment is bootstrapped"
( cd "${DEPLOY_DIR}" && npx cdk bootstrap "aws://${ACCOUNT_ID}/${REGION}" >/dev/null )
ok "Environment bootstrapped"

# --- deploy -----------------------------------------------------------------
info "Building the image and deploying ${STACK_NAME} (this can take several minutes)"
( cd "${DEPLOY_DIR}" && npx cdk deploy "${STACK_NAME}" \
	--require-approval never \
	${CONTEXT_ARGS[@]+"${CONTEXT_ARGS[@]}"} )

# --- report -----------------------------------------------------------------
PUBLIC_URL="$(aws cloudformation describe-stacks \
	--region "${REGION}" --stack-name "${STACK_NAME}" \
	--query "Stacks[0].Outputs[?OutputKey=='PublicUrl'].OutputValue" --output text 2>/dev/null || true)"
TOKEN_CMD="$(aws cloudformation describe-stacks \
	--region "${REGION}" --stack-name "${STACK_NAME}" \
	--query "Stacks[0].Outputs[?OutputKey=='GetAdminTokenCommand'].OutputValue" --output text 2>/dev/null || true)"

echo
ok "Deploy complete."
[ -n "${PUBLIC_URL}" ] && printf '\n  Public URL:  \033[1;36m%s\033[0m\n' "${PUBLIC_URL}"
if [ -n "${TOKEN_CMD}" ]; then
	printf '\n  Admin token: run\n      %s\n' "${TOKEN_CMD}"
fi
echo
warn "A brand-new CloudFront distribution can take 5-15 minutes to become reachable worldwide."
