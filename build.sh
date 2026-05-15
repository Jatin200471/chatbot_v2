{
  "agent_id": "agent_6601kc1fqeecfc88s7d52jde0syq"
}#!/bin/bash

# Build script for Chatwoot with configurable ElevenLabs agent ID
# Usage: ./build.sh [agent_id] [voice_id] [agent_name]

set -e

# Default values
AGENT_ID="${1:-agent_6601kc1fqeecfc88s7d52jde0syq}"
VOICE_ID="${2:-}"
AGENT_NAME="${3:-AI Assistant}"
IMAGE_TAG="${4:-latest}"

echo "🔨 Building Chatwoot with ElevenLabs Voice Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Agent ID:     $AGENT_ID"
echo "Voice ID:     ${VOICE_ID:-(default)}"
echo "Agent Name:   $AGENT_NAME"
echo "Image Tag:    $IMAGE_TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Build Docker image
docker build \
  --build-arg VITE_ELEVENLABS_AGENT_ID="$AGENT_ID" \
  --build-arg VITE_ELEVENLABS_VOICE_ID="$VOICE_ID" \
  --build-arg VITE_ELEVENLABS_AGENT_NAME="$AGENT_NAME" \
  -t chatwoot-custom:$IMAGE_TAG \
  -f Dockerfile \
  .

echo "✅ Build complete!"
echo ""
echo "Run container with:"
echo "  docker compose up -d"
echo ""
echo "Or push to registry:"
echo "  docker tag chatwoot-custom:$IMAGE_TAG <registry>/chatwoot-custom:$IMAGE_TAG"
echo "  docker push <registry>/chatwoot-custom:$IMAGE_TAG"
