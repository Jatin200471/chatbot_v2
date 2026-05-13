# ── Stage 1: Node.js build environment ────────────────────────────────────────
FROM node:18-alpine AS node-builder

RUN npm install -g pnpm

WORKDIR /chatwoot-src

RUN apk add --no-cache git && \
    git clone --depth 1 https://github.com/chatwoot/chatwoot.git . && \
    pnpm install --frozen-lockfile

# Copy custom Vue files BEFORE building
COPY custom/widget/components/ChatInputWrap.vue app/javascript/widget/components/ChatInputWrap.vue
COPY custom/widget/components/ElevenLabsVoiceButton.vue app/javascript/widget/components/ElevenLabsVoiceButton.vue
COPY custom/widget/components/HeaderActions.vue app/javascript/widget/components/HeaderActions.vue
COPY custom/widget/components/Form.vue app/javascript/widget/components/Form/Form.vue
COPY custom/widget/store/index.js app/javascript/widget/store/index.js
COPY custom/widget/store/modules/appConfig.js app/javascript/widget/store/modules/appConfig.js
COPY custom/widget/store/modules/elevenlabsVoice.js app/javascript/widget/store/modules/elevenlabsVoice.js
COPY custom/widget/store/modules/contacts.js app/javascript/widget/store/modules/contacts.js
COPY custom/widget/store/modules/conversation/actions.js app/javascript/widget/store/modules/conversation/actions.js
COPY custom/widget/mixins/configMixin.js app/javascript/widget/mixins/configMixin.js
COPY custom/widget/i18n/en.json app/javascript/widget/i18n/locale/en.json
COPY custom/widget/views/Home.vue app/javascript/widget/views/Home.vue
COPY custom/widget/views/App.vue app/javascript/widget/App.vue

ARG VITE_ELEVENLABS_AGENT_ID=agent_6601kc1fqeecfc88s7d52jde0syq
ARG VITE_ELEVENLABS_VOICE_ID=
ARG VITE_ELEVENLABS_AGENT_NAME=AI Assistant

ENV VITE_ELEVENLABS_AGENT_ID=${VITE_ELEVENLABS_AGENT_ID}
ENV VITE_ELEVENLABS_VOICE_ID=${VITE_ELEVENLABS_VOICE_ID}
ENV VITE_ELEVENLABS_AGENT_NAME=${VITE_ELEVENLABS_AGENT_NAME}

RUN NODE_OPTIONS="--max-old-space-size=4096" \
    node_modules/.bin/vite build --config vite.config.ts

RUN echo "=== BUILD OUTPUT ===" && \
    find /chatwoot-src/public -type f | head -30 && \
    echo "==================="

# ── Stage 2: Final Chatwoot image ─────────────────────────────────────────────
FROM chatwoot/chatwoot:latest

ARG VITE_ELEVENLABS_AGENT_ID=agent_6601kc1fqeecfc88s7d52jde0syq
ARG VITE_ELEVENLABS_VOICE_ID=
ARG VITE_ELEVENLABS_AGENT_NAME=AI Assistant

ENV VITE_ELEVENLABS_AGENT_ID=${VITE_ELEVENLABS_AGENT_ID}
ENV VITE_ELEVENLABS_VOICE_ID=${VITE_ELEVENLABS_VOICE_ID}
ENV VITE_ELEVENLABS_AGENT_NAME=${VITE_ELEVENLABS_AGENT_NAME}

# Copy ALL public build output
COPY --from=node-builder /chatwoot-src/public /app/public

# ── Backend Patches: ElevenLabs Integration ────────────────────────────────
# These files have custom code for ElevenLabs voice agent
COPY custom/backend/models/web_widget.rb /app/app/models/channel/web_widget.rb
COPY custom/backend/views/show.html.erb /app/app/views/widgets/show.html.erb
COPY custom/backend/views/_inbox.json.jbuilder /app/app/views/api/v1/models/_inbox.json.jbuilder
COPY custom/backend/controllers/inboxes_controller.rb /app/app/controllers/api/v1/accounts/inboxes_controller.rb
COPY custom/backend/controllers/conversations_controller.rb /app/app/controllers/api/v1/widget/conversations_controller.rb
COPY custom/backend/controllers/concerns/website_token_helper.rb /app/app/controllers/concerns/website_token_helper.rb
COPY custom/backend/migrations/20260408000001_add_elevenlabs_to_channel_web_widgets.rb \
     /app/db/migrate/20260408000001_add_elevenlabs_to_channel_web_widgets.rb

# ── Dashboard Customization ────────────────────────────────────────────────────
# ConfigurationPage.vue with ElevenLabs AI Voice Agent settings
COPY custom/dashboard/ConfigurationPage.vue /app/app/javascript/dashboard/routes/dashboard/settings/inbox/settingsPage/ConfigurationPage.vue

# ── Widget Components with ElevenLabs Integration ──────────────────────────────
# These Vue components have custom ElevenLabs voice button and chat input wrapper
COPY custom/widget/components/ChatInputWrap.vue /app/app/javascript/widget/components/ChatInputWrap.vue
COPY custom/widget/components/ElevenLabsVoiceButton.vue /app/app/javascript/widget/components/ElevenLabsVoiceButton.vue
COPY custom/widget/components/HeaderActions.vue /app/app/javascript/widget/components/HeaderActions.vue

# ── Widget Store & Logic ───────────────────────────────────────────────────────
# Custom Vuex modules for ElevenLabs voice state management
COPY custom/widget/store/index.js /app/app/javascript/widget/store/index.js
COPY custom/widget/store/modules/appConfig.js /app/app/javascript/widget/store/modules/appConfig.js
COPY custom/widget/store/modules/elevenlabsVoice.js /app/app/javascript/widget/store/modules/elevenlabsVoice.js
COPY custom/widget/store/modules/contacts.js /app/app/javascript/widget/store/modules/contacts.js
COPY custom/widget/store/modules/conversation/actions.js /app/app/javascript/widget/store/modules/conversation/actions.js

# ── Widget Mixins & Views ──────────────────────────────────────────────────────
# Custom mixin for ElevenLabs feature detection
COPY custom/widget/mixins/configMixin.js /app/app/javascript/widget/mixins/configMixin.js
# Custom widget views with persistent user data
COPY custom/widget/views/Home.vue /app/app/javascript/widget/views/Home.vue
COPY custom/widget/views/App.vue /app/app/javascript/widget/App.vue
COPY custom/widget/views/PreChatForm.vue /app/app/javascript/widget/views/PreChatForm.vue

# ── Widget API Helpers ─────────────────────────────────────────────────────────
# Custom API helpers with persistent website_token logic
COPY custom/widget/helpers/axios.js /app/app/javascript/widget/helpers/axios.js
COPY custom/widget/api/contacts.js /app/app/javascript/widget/api/contacts.js
COPY custom/widget/api/conversation.js /app/app/javascript/widget/api/conversation.js

# ── Image Metadata ────────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="Chatwoot with ElevenLabs Voice + Persistent User Data"
LABEL org.opencontainers.image.description="Chatwoot custom image with ElevenLabs voice integration and persistent user data across sessions"

# ── Environment Variables ──────────────────────────────────────────────────────
ENV VITE_ELEVENLABS_AGENT_ID=${VITE_ELEVENLABS_AGENT_ID}
ENV VITE_ELEVENLABS_VOICE_ID=${VITE_ELEVENLABS_VOICE_ID}
ENV VITE_ELEVENLABS_AGENT_NAME=${VITE_ELEVENLABS_AGENT_NAME}
