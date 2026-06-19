# ── Stage 1: Node.js build environment ────────────────────────────────────────
FROM node:20-bullseye-slim AS node-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates python3 build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g pnpm

WORKDIR /chatwoot-src

RUN git clone --depth 1 https://github.com/chatwoot/chatwoot.git .

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# Copy floating button code (appended to sdk.js after build)
COPY custom/widget/sdk-floating-btn.js /tmp/cw-floating-btn.js

# Copy custom Vue files BEFORE building
COPY custom/widget/components/ChatInputWrap.vue app/javascript/widget/components/ChatInputWrap.vue
COPY custom/widget/components/ElevenLabsVoiceButton.vue app/javascript/widget/components/ElevenLabsVoiceButton.vue
COPY custom/widget/components/HeaderActions.vue app/javascript/widget/components/HeaderActions.vue
COPY custom/widget/components/Form.vue app/javascript/widget/components/PreChat/Form.vue
COPY custom/widget/components/Branding.vue app/javascript/shared/components/Branding.vue
COPY custom/widget/store/index.js app/javascript/widget/store/index.js
COPY custom/widget/store/modules/appConfig.js app/javascript/widget/store/modules/appConfig.js
COPY custom/widget/store/modules/elevenlabsVoice.js app/javascript/widget/store/modules/elevenlabsVoice.js
COPY custom/widget/store/modules/voiceAgentConfig.js app/javascript/widget/store/modules/voiceAgentConfig.js
COPY custom/widget/store/modules/contacts.js app/javascript/widget/store/modules/contacts.js
COPY custom/widget/store/modules/conversation/actions.js app/javascript/widget/store/modules/conversation/actions.js
COPY custom/widget/mixins/configMixin.js app/javascript/widget/mixins/configMixin.js
COPY custom/widget/i18n/en.json app/javascript/widget/i18n/locale/en.json
COPY custom/widget/views/Home.vue app/javascript/widget/views/Home.vue
COPY custom/widget/views/App.vue app/javascript/widget/App.vue
COPY custom/widget/views/PreChatForm.vue app/javascript/widget/views/PreChatForm.vue
COPY custom/widget/helpers/axios.js app/javascript/widget/helpers/axios.js
COPY custom/widget/api/contacts.js app/javascript/widget/api/contacts.js
COPY custom/widget/api/conversation.js app/javascript/widget/api/conversation.js
COPY custom/widget/api/endpoint.js app/javascript/widget/api/endPoints.js
COPY custom/widget/api/inboxConfig.js app/javascript/widget/api/inboxConfig.js
COPY custom/dashboard/ConfigurationPage.vue app/javascript/dashboard/routes/dashboard/settings/inbox/settingsPage/ConfigurationPage.vue
COPY custom/dashboard/ResolveAction.vue app/javascript/dashboard/components/buttons/ResolveAction.vue
COPY custom/dashboard/ColorPicker.vue app/javascript/dashboard/components-next/colorpicker/ColorPicker.vue
COPY custom/sdk/IFrameHelper.js app/javascript/sdk/IFrameHelper.js

# ── Memory settings safe for GitHub Actions Docker BuildKit ──────────────────
# 3072MB = safe limit inside Docker container on free GitHub runner (~7GB total)
# esbuild/terser minification removed — causes OOM in CI
ENV NODE_OPTIONS="--max-old-space-size=3072 --max-semi-space-size=64 --max-http-header-size=16384"
ENV UV_THREADPOOL_SIZE=2
ENV GOMAXPROCS=1

ARG MINIFY=false

# ── Vite build (no minification for CI stability) ────────────────────────────
RUN --mount=type=cache,target=/chatwoot-src/node_modules/.vite,sharing=locked \
    node_modules/.bin/vite build --config vite.config.ts

# ── Inject floating End Call button into sdk.js ───────────────────────────
ARG CACHEBUST=1
RUN echo "=== SDK files found ===" && \
    find /chatwoot-src/public -name "sdk*.js" && \
    SDK_FILE=$(find /chatwoot-src/public -name "sdk*.js" | head -1) && \
    if [ -z "$SDK_FILE" ]; then echo "ERROR: sdk*.js not found!" && exit 1; fi && \
    echo "Injecting into: $SDK_FILE" && \
    cat /tmp/cw-floating-btn.js >> "$SDK_FILE" && \
    echo "=== Verifying injection ===" && \
    grep -c "_cwVoiceInstalled" "$SDK_FILE" && \
    echo "=== Injection verified OK ==="

RUN echo "=== BUILD OUTPUT ===" && \
    find /chatwoot-src/public -type f | head -30 && \
    echo "==================="

# ── Stage 2: Final Chatwoot image ─────────────────────────────────────────────
FROM chatwoot/chatwoot:latest

# Copy ALL public build output
COPY --from=node-builder /chatwoot-src/public /app/public

COPY custom/widget/voice-popup.html /app/public/voice-popup.html

COPY custom/widget/sdk-floating-btn.js /tmp/cw-floating-btn.js

ARG CACHEBUST=1
RUN SDK_FILE="/app/public/packs/js/sdk.js" && \
    if [ ! -f "$SDK_FILE" ]; then echo "ERROR: $SDK_FILE not found!" && exit 1; fi && \
    echo "Injecting into: $SDK_FILE" && \
    cat /tmp/cw-floating-btn.js >> "$SDK_FILE" && \
    grep -c "_cwVoiceInstalled" "$SDK_FILE" && \
    echo "=== Stage 2 injection verified OK ==="

# ── Auto-migrate entrypoint ───────────────────────────────────────────────────
COPY custom/backend/entrypoints/rails.sh /app/docker/entrypoints/rails.sh
RUN chmod +x /app/docker/entrypoints/rails.sh

# ── Backend Patches: ElevenLabs Integration ────────────────────────────────
COPY custom/backend/models/web_widget.rb /app/app/models/channel/web_widget.rb
COPY custom/backend/views/show.html.erb /app/app/views/widgets/show.html.erb
COPY custom/backend/views/_inbox.json.jbuilder /app/app/views/api/v1/models/_inbox.json.jbuilder
COPY custom/backend/views/conversations/create.json.jbuilder /app/app/views/api/v1/widget/conversations/create.json.jbuilder
COPY custom/backend/controllers/inboxes_controller.rb /app/app/controllers/api/v1/accounts/inboxes_controller.rb
COPY custom/backend/controllers/conversations_controller.rb /app/app/controllers/api/v1/widget/conversations_controller.rb
COPY custom/backend/controllers/concerns/website_token_helper.rb /app/app/controllers/concerns/website_token_helper.rb
COPY custom/backend/controllers/security_headers_concern.rb /app/app/controllers/concerns/security_headers_concern.rb
COPY custom/backend/initializers/rack_attack.rb /app/config/initializers/rack_attack.rb
COPY custom/backend/routes.rb /app/config/routes.rb
COPY custom/backend/migrations/20260520000001_add_elevenlabs_to_channel_web_widgets.rb \
     /app/db/migrate/20260520000001_add_elevenlabs_to_channel_web_widgets.rb
COPY custom/backend/migrations/20260520000002_add_voice_agent_config_to_channel_web_widgets.rb \
     /app/db/migrate/20260520000002_add_voice_agent_config_to_channel_web_widgets.rb
COPY custom/backend/migrations/20260521000001_add_branding_to_channel_web_widgets.rb \
     /app/db/migrate/20260521000001_add_branding_to_channel_web_widgets.rb
COPY custom/backend/migrations/20260521000002_add_bubble_icon_to_channel_web_widgets.rb \
     /app/db/migrate/20260521000002_add_bubble_icon_to_channel_web_widgets.rb
COPY custom/backend/migrations/20260521000003_add_bubble_icon_size_to_channel_web_widgets.rb \
     /app/db/migrate/20260521000003_add_bubble_icon_size_to_channel_web_widgets.rb

# ── Image Metadata ────────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="Chatwoot Custom — Voice Agent + Persistent User Data"
LABEL org.opencontainers.image.description="Chatwoot fork with dashboard-configurable voice agent (ElevenLabs / multi-provider) and persistent contact data across sessions"
LABEL org.opencontainers.image.source="https://github.com/jAtInn71/chatwoot-custom-master"