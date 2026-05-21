# ── Stage 1: Node.js build environment ────────────────────────────────────────
# Use Debian (glibc) instead of Alpine (musl). Vite + esbuild under heavy
# minification load segfault (exit 139) on Alpine in low-memory CI runners.
# glibc gives V8 a much more stable runtime for builds of this size.
FROM node:18-bullseye-slim AS node-builder

# Avoid noisy apt prompts and keep image lean
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates python3 build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g pnpm

WORKDIR /chatwoot-src

RUN git clone --depth 1 https://github.com/chatwoot/chatwoot.git . && \
    pnpm install --frozen-lockfile

# Copy custom Vue files BEFORE building
COPY custom/widget/components/ChatInputWrap.vue app/javascript/widget/components/ChatInputWrap.vue
COPY custom/widget/components/ElevenLabsVoiceButton.vue app/javascript/widget/components/ElevenLabsVoiceButton.vue
COPY custom/widget/components/HeaderActions.vue app/javascript/widget/components/HeaderActions.vue
COPY custom/widget/components/Form.vue app/javascript/widget/components/Form/Form.vue
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

# Voice agent (ElevenLabs / Dograh / etc.) configuration is now done per
# inbox from the Chatwoot dashboard at runtime. No build-time ARG/ENV vars
# are required for the voice integration.

# ── Vite build ────────────────────────────────────────────────────────────────
# Memory tuning rationale:
#   • --max-old-space-size=6144   Raise V8 heap. Total RSS during minification
#                                 spikes past 4 GB on this codebase; 3 GB was
#                                 causing SIGSEGV (exit 139) in CI.
#   • --max-semi-space-size=128   Reduce GC churn for the young-gen heap.
#   • UV_THREADPOOL_SIZE=4        Cap libuv workers so we don't fork too many
#                                 native threads on memory-tight CI runners.
#   • VITE_ESBUILD_TARGET_LIMIT=2 Limit esbuild parallel workers — biggest
#                                 source of OOM during minify. (esbuild reads
#                                 GOMAXPROCS, set it too for safety.)
#
# If your CI runner has < 5 GB free RAM, drop --minify entirely (uncomment
# the alternate command below). Minification can be re-applied as a post-step.
ENV NODE_OPTIONS="--max-old-space-size=6144 --max-semi-space-size=128 --max-http-header-size=16384"
ENV UV_THREADPOOL_SIZE=4
ENV GOMAXPROCS=2

RUN node_modules/.bin/vite build --config vite.config.ts --minify esbuild

# Fallback (no minification) if the line above still OOMs in your CI:
# RUN node_modules/.bin/vite build --config vite.config.ts

RUN echo "=== BUILD OUTPUT ===" && \
    find /chatwoot-src/public -type f | head -30 && \
    echo "==================="

# ── Stage 2: Final Chatwoot image ─────────────────────────────────────────────
FROM chatwoot/chatwoot:latest

# Copy ALL public build output
COPY --from=node-builder /chatwoot-src/public /app/public

# ── Backend Patches: ElevenLabs Integration ────────────────────────────────
# These files have custom code for ElevenLabs voice agent
COPY custom/backend/models/web_widget.rb /app/app/models/channel/web_widget.rb
COPY custom/backend/views/show.html.erb /app/app/views/widgets/show.html.erb
COPY custom/backend/views/_inbox.json.jbuilder /app/app/views/api/v1/models/_inbox.json.jbuilder
COPY custom/backend/views/conversations/create.json.jbuilder /app/app/views/api/v1/widget/conversations/create.json.jbuilder
COPY custom/backend/controllers/inboxes_controller.rb /app/app/controllers/api/v1/accounts/inboxes_controller.rb
COPY custom/backend/controllers/conversations_controller.rb /app/app/controllers/api/v1/widget/conversations_controller.rb
COPY custom/backend/controllers/concerns/website_token_helper.rb /app/app/controllers/concerns/website_token_helper.rb
COPY custom/backend/routes.rb /app/config/routes.rb
COPY custom/backend/migrations/20260520000001_add_elevenlabs_to_channel_web_widgets.rb \
     /app/db/migrate/20260520000001_add_elevenlabs_to_channel_web_widgets.rb
COPY custom/backend/migrations/20260520000002_add_voice_agent_config_to_channel_web_widgets.rb \
     /app/db/migrate/20260520000002_add_voice_agent_config_to_channel_web_widgets.rb

# ── Frontend: Dashboard & Widget files processed by Vite in Stage 1 ────────────
# All Vue components, store modules, and helpers are bundled by Vite in Stage 1
# and copied to /app/public above. Do NOT copy raw Vue files here — they will
# override the Vite-built assets and break the application.

# ── Image Metadata ────────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="Chatwoot Custom — Voice Agent + Persistent User Data"
LABEL org.opencontainers.image.description="Chatwoot fork with dashboard-configurable voice agent (ElevenLabs / multi-provider) and persistent contact data across sessions"
LABEL org.opencontainers.image.source="https://github.com/jAtInn71/chatwoot-custom-master"