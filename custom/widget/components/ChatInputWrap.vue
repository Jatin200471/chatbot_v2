<script>
import { mapGetters, mapActions } from 'vuex';
import { useRouter } from 'vue-router';

import ChatAttachmentButton from 'widget/components/ChatAttachment.vue';
import ChatSendButton from 'widget/components/ChatSendButton.vue';
import ElevenLabsVoiceButton from 'widget/components/ElevenLabsVoiceButton.vue';
import configMixin from '../mixins/configMixin';
import FluentIcon from 'shared/components/FluentIcon/Index.vue';
import ResizableTextArea from 'shared/components/ResizableTextArea.vue';

import EmojiPicker from 'shared/components/emoji/EmojiPicker.vue';

export default {
  name: 'ChatInputWrap',
  components: {
    ChatAttachmentButton,
    ChatSendButton,
    ElevenLabsVoiceButton,
    EmojiPicker,
    FluentIcon,
    ResizableTextArea,
  },
  mixins: [configMixin],
  setup() {
    const router = useRouter();
    return { router };
  },
  props: {
    onSendMessage: {
      type: Function,
      default: () => {},
    },
    onSendAttachment: {
      type: Function,
      default: () => {},
    },
  },
  data() {
    return {
      userInput: '',
      showEmojiPicker: false,
      isFocused: false,
    };
  },

  computed: {
    ...mapGetters({
      widgetColor: 'appConfig/getWidgetColor',
      isWidgetOpen: 'appConfig/getIsWidgetOpen',
      shouldShowFilePicker: 'appConfig/getShouldShowFilePicker',
      shouldShowEmojiPicker: 'appConfig/getShouldShowEmojiPicker',
      conversationEnded: 'appConfig/getConversationEnded',
    }),
    ctaBgColor() {
      return window.chatwootWebChannel?.ctaBgColor || null;
    },
    ctaTextColor() {
      return window.chatwootWebChannel?.ctaTextColor || null;
    },
    showAttachment() {
      return (
        this.shouldShowFilePicker &&
        this.hasAttachmentsEnabled &&
        this.userInput.length === 0
      );
    },
    showSendButton() {
      return this.userInput.length > 0;
    },
  },
  watch: {
    isWidgetOpen(isWidgetOpen) {
      if (isWidgetOpen) {
        this.focusInput();
      }
    },
  },
  unmounted() {
    document.removeEventListener('keypress', this.handleEnterKeyPress);
  },
  mounted() {
    document.addEventListener('keypress', this.handleEnterKeyPress);
    if (this.isWidgetOpen) {
      this.focusInput();
    }
  },

  methods: {
    onBlur() {
      this.isFocused = false;
    },
    onFocus() {
      this.isFocused = true;
    },
    handleButtonClick() {
      if (this.userInput && this.userInput.trim()) {
        this.onSendMessage(this.userInput);
      }
      this.userInput = '';
      this.focusInput();
    },
    handleEnterKeyPress(e) {
      if (e.keyCode === 13 && !e.shiftKey) {
        e.preventDefault();
        this.handleButtonClick();
      }
    },
    toggleEmojiPicker() {
      this.showEmojiPicker = !this.showEmojiPicker;
    },
    hideEmojiPicker(e) {
      if (this.showEmojiPicker) {
        e.stopPropagation();
        this.toggleEmojiPicker();
      }
    },
    emojiOnClick(emoji) {
      this.userInput = `${this.userInput}${emoji} `;
    },
    onTypingOff() {
      this.toggleTyping('off');
    },
    onTypingOn() {
      this.toggleTyping('on');
    },
    toggleTyping(typingStatus) {
      this.$store.dispatch('conversation/toggleUserTyping', { typingStatus });
    },
    focusInput() {
      // Guard: ref is undefined when conversationEnded branch is rendered
      // (the v-if hides the ResizableTextArea).
      this.$refs.chatInput?.focus?.();
    },

    async handleRestart() {
      // Mark restart mode — Form.vue reads this in data() to hide message box
      // and pre-fill name/email/phone from chatwoot_user_data.
      try { localStorage.setItem('cw_restart_mode', '1'); } catch (_) {}
      this.$store.dispatch('appConfig/setConversationEnded', false);
      this.$store.dispatch('conversation/clearConversations');
      this.$store.dispatch('conversationAttributes/clearConversationAttributes');
      this.router.replace({ name: 'prechat-form' });
    },
  },
};
</script>

<template>
  <!-- Conversation ended — show last messages above, restart button here -->
  <div
    v-if="conversationEnded"
    class="flex flex-col items-center gap-2 px-4 py-3 border border-n-weak rounded-[7px] bg-n-background"
  >
    <p class="text-sm text-n-slate-11 text-center">
      {{ $t('CONVERSATION_RESOLVED.TITLE') }}
    </p>
    <button
      class="px-4 py-2 rounded-md text-sm font-medium text-white transition-opacity hover:opacity-90"
      :style="{ background: ctaBgColor || widgetColor, color: ctaTextColor || undefined }"
      @click="handleRestart"
    >
      {{ $t('CONVERSATION_RESOLVED.RESTART_BUTTON') }}
    </button>
  </div>

  <!-- Normal input -->
  <div
    v-else
    class="items-center flex ltr:pl-3 rtl:pr-3 ltr:pr-2 rtl:pl-2 rounded-[7px] transition-all duration-200 bg-n-background !shadow-[0_0_0_1px,0_0_2px_3px]"
    :class="{
      '!shadow-n-brand dark:!shadow-n-brand': isFocused,
      '!shadow-n-strong dark:!shadow-n-strong': !isFocused,
    }"
    @keydown.esc="hideEmojiPicker"
  >
    <ResizableTextArea
      id="chat-input"
      ref="chatInput"
      v-model="userInput"
      :rows="1"
      :aria-label="$t('CHAT_PLACEHOLDER')"
      :placeholder="$t('CHAT_PLACEHOLDER')"
      class="user-message-input reset-base"
      @typing-off="onTypingOff"
      @typing-on="onTypingOn"
      @focus="onFocus"
      @blur="onBlur"
    />
    <div class="flex items-center ltr:pl-2 rtl:pr-2">
      <ChatAttachmentButton
        v-if="showAttachment"
        class="text-n-slate-12"
        :on-attach="onSendAttachment"
      />
      <button
        v-if="shouldShowEmojiPicker && hasEmojiPickerEnabled"
        class="flex items-center justify-center min-h-8 min-w-8"
        :aria-label="$t('EMOJI.ARIA_LABEL')"
        @click="toggleEmojiPicker"
      >
        <FluentIcon
          icon="emoji"
          class="transition-all duration-150"
          :class="{
            'text-n-slate-12': !showEmojiPicker,
            'text-n-brand': showEmojiPicker,
          }"
        />
      </button>
      <EmojiPicker
        v-if="shouldShowEmojiPicker && showEmojiPicker"
        v-on-clickaway="hideEmojiPicker"
        :on-click="emojiOnClick"
        @keydown.esc="hideEmojiPicker"
      />
      <ElevenLabsVoiceButton
        class="text-n-slate-12"
        size="medium"
      />
      <ChatSendButton
        v-if="showSendButton"
        :color="widgetColor"
        @click="handleButtonClick"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.emoji-dialog {
  @apply max-w-full ltr:right-5 rtl:right-[unset] rtl:left-5 -top-[302px] before:ltr:right-2.5 before:rtl:right-[unset] before:rtl:left-2.5;
}

.user-message-input {
  @apply border-none outline-none w-full placeholder:text-n-slate-10 resize-none h-8 min-h-8 max-h-60 py-1 px-0 my-2 bg-n-background text-n-slate-12 transition-all duration-200;
}
</style>