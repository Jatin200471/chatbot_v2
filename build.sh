#!/bin/bash

# Build script for Chatwoot Custom
# Usage: ./build.sh [image_tag]
#
# NOTE: ElevenLabs Agent ID and API Key are configured from the Chatwoot
# dashboard (Inbox → Configuration → Voice Agent) — NOT at build time.
# This keeps secrets out of the Docker image entirely.

set -e

IMAGE_TAG="${1:-latest}"

echo "🔨 Building Chatwoot Custom"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Image Tag: $IMAGE_TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DOCKER_BUILDKIT=1 docker build \
  -t chatwoot-custom:$IMAGE_TAG \
  -f Dockerfile \
  .

echo "✅ Build complete!"
echo ""
echo "Run locally:"
echo "  docker compose up -d"
echo ""
echo "Push to registry (AWS ECR):"
echo "  docker tag chatwoot-custom:$IMAGE_TAG <your-ecr-url>/chatwoot-custom:$IMAGE_TAG"
echo "  docker push <your-ecr-url>/chatwoot-custom:$IMAGE_TAG"
