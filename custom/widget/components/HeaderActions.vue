<script>
import { mapGetters } from 'vuex';
import { IFrameHelper, RNHelper } from 'widget/helpers/utils';
import { popoutChatWindow } from '../helpers/popoutHelper';
import FluentIcon from 'shared/components/FluentIcon/Index.vue';
import ElevenLabsVoiceButton from 'widget/components/ElevenLabsVoiceButton.vue';
import configMixin from 'widget/mixins/configMixin';
import { CONVERSATION_STATUS } from 'shared/constants/messages';
import { toggleStatus } from 'widget/api/conversation';

export default {
  name: 'HeaderActions',
  components: { FluentIcon, ElevenLabsVoiceButton },
  mixins: [configMixin],
  props: {
    showPopoutButton: {
      type: Boolean,
      default: false,
    },
    showEndConversationButton: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      isEndingChat: false,
      showConfirmExitChat: false,
    };
  },
  computed: {
    ...mapGetters({
      conversationAttributes: 'conversationAttributes/getConversationParams',
      canUserEndConversation: 'appConfig/getCanUserEndConversation',
      widgetColor: 'appConfig/getWidgetColor',
      elevenLabsEnabled: 'appConfig/getElevenLabsEnabled',
    }),
    conversationStatus() {
      return this.conversationAttributes.status;
    },
    isIframe() {
      return IFrameHelper.isIFrame();
    },
    isRNWebView() {
      return RNHelper.isRNWebView();
    },
    showHeaderActions() {
      return this.isIframe || this.isRNWebView || this.hasWidgetOptions;
    },
    hasWidgetOptions() {
      return this.showPopoutButton || this.conversationStatus === 'open';
    },
    canEndChat() {
      return [
        CONVERSATION_STATUS.OPEN,
        CONVERSATION_STATUS.SNOOZED,
        CONVERSATION_STATUS.PENDING,
      ].includes(this.conversationStatus);
    },
    showCallButton() {
      // Check the new voiceAgentEnabled flag (set in show.html.erb) first,
      // then fall back to the legacy elevenLabsEnabled getter.
      const channel = window.chatwootWebChannel || {};
      return channel.voiceAgentEnabled === true || this.elevenLabsEnabled;
    },
  },
  methods: {
    popoutWindow() {
      this.sendCloseMessage();
      const {
        location: { origin },
        chatwootWebChannel: { websiteToken },
        authToken,
      } = window;
      popoutChatWindow(origin, websiteToken, this.$root.$i18n.locale, authToken);
    },

    sendCloseMessage() {
      if (IFrameHelper.isIFrame()) {
        IFrameHelper.sendMessage({ event: 'closeWindow' });
      } else if (RNHelper.isRNWebView) {
        RNHelper.sendMessage({ type: 'close-widget' });
      }
    },

    requestExitChat() {
      this.showConfirmExitChat = !this.showConfirmExitChat;
    },

    dismissConfirms() {
      this.showConfirmExitChat = false;
    },

    async endChat() {
      if (this.isEndingChat) return;
      this.isEndingChat = true;
      this.showConfirmExitChat = false;

      try {
        // ── STEP 1: RESOLVE the conversation (intentional exit by user).
        // Must happen BEFORE clearing auth headers in step 2.
        if (
          [
            CONVERSATION_STATUS.OPEN,
            CONVERSATION_STATUS.SNOOZED,
            CONVERSATION_STATUS.PENDING,
          ].includes(this.conversationStatus)
        ) {
          try { await toggleStatus(); } catch (_) {}
        }

        // ── STEP 2: Wipe iframe-domain auth/storage/cookies, then reload iframe.
        // We deliberately do NOT depend on parent-page code, so this works on
        // ANY site that embeds the Chatwoot SDK (clients don't need to add a
        // custom postMessage listener).
        //
        // contacts/clearCurrentUser:
        //   • resets Vuex contact state to blank
        //   • removes auth headers
        //   • clearSessionStorage() — wipes localStorage/sessionStorage/cookies
        //     scoped to the Chatwoot iframe origin (the only place that can
        //     clear them, since the parent page is on a different origin)
        //   • posts { event: 'exitChat' } to the parent (harmless if unhandled)
        //
        // After that, reloading window.location refreshes the iframe contents
        // only. The iframe re-requests its config without any contact cookies
        // → Chatwoot creates a brand-new contact → contact_created fires →
        // n8n receives the new form data on every Exit Chat cycle.
        if (IFrameHelper.isIFrame()) {
          this.$store.dispatch('contacts/clearCurrentUser');
          // Small delay so the postMessage and storage writes flush before reload
          setTimeout(() => { window.location.reload(); }, 50);
        } else if (RNHelper.isRNWebView()) {
          RNHelper.sendMessage({ type: 'exit-chat' });
        } else {
          this._localFallbackExit();
        }

      } catch (_) {
        // Safety net: always try to fire exitChat so parent can recover
        try {
          if (IFrameHelper.isIFrame()) {
            IFrameHelper.sendMessage({ event: 'exitChat' });
          }
        } catch (__) {}
      } finally {
        this.isEndingChat = false;
      }
    },

    // Only used when the widget is NOT inside an iframe (rare / popout mode).
    async _localFallbackExit() {
      try { this.$store.commit('conversation/clearConversations'); } catch (_) {}
      try { await this.$store.dispatch('contacts/clearCurrentUser'); } catch (_) {}
      this.sendCloseMessage();
      setTimeout(() => { window.location.reload(); }, 300);
    },
  },
};
</script>

<template>
  <div v-if="showHeaderActions" class="actions flex items-center gap-1">

    <ElevenLabsVoiceButton
      v-if="showCallButton"
      :color="widgetColor"
      size="medium"
      class="header-call-btn"
    />

    <div v-if="canEndChat && showEndConversationButton" class="relative">
      <button
        class="header-action-btn exit-chat-btn"
        :class="{ active: showConfirmExitChat }"
        :disabled="isEndingChat"
        title="Exit & Close Chat"
        @click="requestExitChat"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 17L21 12L16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div v-if="showConfirmExitChat" class="confirm-popover">
        <p class="confirm-text">
          End and close this chat?
          <span class="confirm-sub">
            Conversation will be resolved.<br/>
            Next open will start fresh.
          </span>
        </p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel" @click="dismissConfirms">
            Cancel
          </button>
          <button
            class="confirm-btn confirm-ok confirm-ok--exit"
            :disabled="isEndingChat"
            @click="endChat"
          >
            <span v-if="isEndingChat" class="spinner" />
            <span v-else>Exit Chat</span>
          </button>
        </div>
      </div>
    </div>

    <button
      v-if="showPopoutButton"
      class="header-action-btn new-window--button"
      @click="popoutWindow"
    >
      <FluentIcon icon="open" size="20" class="text-n-slate-12" />
    </button>

  </div>
</template>

<style scoped lang="scss">
.actions { position: relative; }

.header-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-body);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
  padding: 0;
  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.07); transform: scale(1.05); }
  &:active:not(:disabled) { transform: scale(0.95); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &.active { background: rgba(0, 0, 0, 0.1); }
}

.exit-chat-btn {
  color: #ef4444;
  &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.1); }
  &.active { background: rgba(239, 68, 68, 0.12); }
  svg path { stroke: currentColor; }
}

.close-button { display: flex; }
.rn-close-button { display: flex !important; }
.header-call-btn { display: flex; align-items: center; justify-content: center; }
.relative { position: relative; }

.confirm-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 9999;
  min-width: 220px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 10px 24px -4px rgba(0,0,0,0.14);
  padding: 14px 16px 12px;
  border: 1px solid rgba(0,0,0,0.08);
  animation: popoverIn 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  &::before {
    content: '';
    position: absolute;
    top: -6px;
    right: 10px;
    width: 12px;
    height: 12px;
    background: #ffffff;
    border-left: 1px solid rgba(0,0,0,0.08);
    border-top: 1px solid rgba(0,0,0,0.08);
    transform: rotate(45deg);
    border-radius: 2px 0 0 0;
  }
}

@keyframes popoverIn {
  from { opacity: 0; transform: translateY(-6px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.confirm-text {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.45;
}

.confirm-sub {
  display: block;
  font-size: 11.5px;
  font-weight: 400;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}

.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

.confirm-btn {
  border: none;
  border-radius: 7px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
  &:active { transform: scale(0.97); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.confirm-cancel {
  background: #f1f5f9;
  color: #475569;
  &:hover { background: #e2e8f0; }
}

.confirm-ok {
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
}

.confirm-ok--exit {
  background: #ef4444;
  &:hover:not(:disabled) { background: #dc2626; }
}

.spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.dark {
  .confirm-popover {
    background: #1e293b;
    border-color: rgba(255,255,255,0.1);
    &::before { background: #1e293b; border-color: rgba(255,255,255,0.1); }
  }
  .confirm-text { color: #f1f5f9; }
  .confirm-sub { color: #94a3b8; }
  .confirm-cancel { background: #334155; color: #cbd5e1; &:hover { background: #475569; } }
  .header-action-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
}
</style>