# ── Stage 1: Node.js build environment ────────────────────────────────────────
FROM node:18-bullseye-slim AS node-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates python3 build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g pnpm

WORKDIR /chatwoot-src

RUN git clone --depth 1 https://github.com/chatwoot/chatwoot.git .

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

COPY custom/widget/sdk-floating-btn.js /tmp/cw-floating-btn.js

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

COPY custom/widget/workers/ app/public/workers/

ENV NODE_OPTIONS="--max-old-space-size=6144 --max-semi-space-size=128 --max-http-header-size=16384"
ENV UV_THREADPOOL_SIZE=4
ENV GOMAXPROCS=2

RUN node_modules/.bin/vite build --config vite.config.ts --minify esbuild


# ── Stage 2: Final image (single — used for both Rails + Sidekiq) ─────────────
FROM chatwoot/chatwoot:latest

COPY --from=node-builder /chatwoot-src/public /app/public

COPY custom/widget/sdk-floating-btn.js /tmp/cw-floating-btn.js

RUN test -d /app/public/workers && echo "✅ Workers directory copied" || echo "⚠️ Workers directory not found"

# CACHEBUST forces sdk injection to always re-run (never cached)
ARG CACHEBUST=1
RUN SDK_FILE="/app/public/packs/js/sdk.js" && \
    if [ ! -f "$SDK_FILE" ]; then echo "ERROR: $SDK_FILE not found!" && exit 1; fi && \
    cat /tmp/cw-floating-btn.js >> "$SDK_FILE" && \
    grep -c "_cwVoiceInstalled" "$SDK_FILE" && \
    echo "=== sdk.js injection verified OK ==="

COPY custom/backend/entrypoints/rails.sh /app/docker/entrypoints/rails.sh
RUN chmod +x /app/docker/entrypoints/rails.sh

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

LABEL org.opencontainers.image.title="Chatwoot Custom — Voice Agent"
LABEL org.opencontainers.image.description="Chatwoot with ElevenLabs voice agent. Single image for both Rails server and Sidekiq worker."
LABEL org.opencontainers.image.source="https://github.com/jAtInn71/chatwoot-custom-master"