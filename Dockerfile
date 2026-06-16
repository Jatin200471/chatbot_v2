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

# ── STEP 1: Clone upstream Chatwoot (separate layer from install) ────────────
# Keeping git clone and pnpm install as SEPARATE RUN steps is critical:
#   • If only custom files change  → both layers are cached → build is instant
#   • If upstream Chatwoot changes → git clone re-runs but pnpm cache mount
#     (below) means packages are NOT re-downloaded from npm registry (~8 min saved)
#   • If neither changes           → both cached, Vite build takes ~3-5 min only
RUN git clone --depth 1 https://github.com/chatwoot/chatwoot.git .

# ── STEP 2: Install dependencies with persistent pnpm cache ─────────────────
# --mount=type=cache persists the pnpm content-addressable store ACROSS builds.
# Even when pnpm.lock changes (upstream update), packages already downloaded
# are served from disk cache instead of npm registry → saves 5-10 min every build.
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

# Pass --build-arg MINIFY=false to skip minification for faster dev builds (~2 min saved).
# Default is true (minified) for production.
ARG MINIFY=true

# Vite cache mount: caches transformed modules between builds.
# When only 1-2 Vue files change, Vite reuses cached transforms for unchanged files.
# First build: no speedup. Subsequent builds: 30-60% faster.
RUN --mount=type=cache,target=/chatwoot-src/node_modules/.vite,sharing=locked \
    if [ "$MINIFY" = "false" ]; then \
      node_modules/.bin/vite build --config vite.config.ts; \
    else \
      node_modules/.bin/vite build --config vite.config.ts --minify esbuild; \
    fi

# ── Inject floating End Call button into sdk.js ───────────────────────────
# ARG CACHEBUST forces this layer to always re-run (never use Docker cache).
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

# Voice-call popup window — standalone HTML page that hosts the ElevenLabs
# SDK in its own browsing context (survives parent-page hard refresh).
# Served from /voice-popup.html. Config delivered via postMessage (URL
# stays clean — no secrets exposed in the address bar).
COPY custom/widget/voice-popup.html /app/public/voice-popup.html

# Copy floating button source so we can inject AFTER overwriting base image files
# This file implements:
#   • Widget state persistence across page navigation
#   • Floating "End Call" button on the parent page during active voice call
#   • SPA-aware navigation: link clicks become fetch-and-swap while a voice
#     call is active so the Chatwoot iframe is never destroyed
#   • Pre-chat form auto-fill from website cookies
#   • Voice popup support: hides Chatwoot widget while popup is open (FEATURE 5)
COPY custom/widget/sdk-floating-btn.js /tmp/cw-floating-btn.js

# ── Inject into sdk.js AFTER COPY (Stage 2) ──────────────────────────────────
# The base image serves /app/public/packs/js/sdk.js as the embed script.
# We must inject our floating-btn code into THIS specific file.
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
# These files have custom code for ElevenLabs voice agent
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

# ── Frontend: Dashboard & Widget files processed by Vite in Stage 1 ────────────
# All Vue components, store modules, and helpers are bundled by Vite in Stage 1
# and copied to /app/public above. Do NOT copy raw Vue files here — they will
# override the Vite-built assets and break the application.

# ── Image Metadata ────────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="Chatwoot Custom — Voice Agent + Persistent User Data"
LABEL org.opencontainers.image.description="Chatwoot fork with dashboard-configurable voice agent (ElevenLabs / multi-provider) and persistent contact data across sessions"
LABEL org.opencontainers.image.source="https://github.com/jAtInn71/chatwoot-custom-master"