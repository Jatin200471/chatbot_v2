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
      stagedFile: null,
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
    inputBarBg() {
      return window.chatwootWebChannel?.inputBarBgColor || null;
    },
    inputBarTextColor() {
      return window.chatwootWebChannel?.inputBarTextColor || null;
    },
    inputBarStyle() {
      const bg = this.inputBarBg;
      const text = this.inputBarTextColor;
      const style = {};
      if (bg) style.background = bg;
      if (this.isFocused) {
        const c = this.widgetColor || '#1f93ff';
        style.boxShadow = `0 0 0 1.5px ${c}`;
      } else {
        style.boxShadow = bg
          ? `0 0 0 1px ${bg}`
          : `0 0 0 1px var(--n-strong, rgba(0,0,0,0.12))`;
      }
      return style;
    },
    inputTextStyle() {
      const text = this.inputBarTextColor;
      return text ? { color: text } : {};
    },
    showAttachment() {
      return (
        this.shouldShowFilePicker &&
        this.hasAttachmentsEnabled &&
        !this.stagedFile
      );
    },
    showSendButton() {
      return this.userInput.length > 0 || this.stagedFile;
    },
    stagedFileIsImage() {
      return this.stagedFile && this.stagedFile.fileType === 'image';
    },
    stagedFileName() {
      if (!this.stagedFile) return '';
      if (this.stagedFile.file?.name) return this.stagedFile.file.name;
      if (typeof this.stagedFile.file === 'string') return 'Attachment';
      return 'File';
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
      if (this.stagedFile) {
        this.onSendAttachment({
          ...this.stagedFile,
          content: this.userInput.trim() || '',
        });
        this.stagedFile = null;
        this.userInput = '';
        this.focusInput();
        return;
      }
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
    handleFileStaged(fileData) {
      this.stagedFile = fileData;
      this.$nextTick(() => this.focusInput());
    },
    removeStagedFile() {
      if (this.stagedFile?.thumbUrl) {
        window.URL.revokeObjectURL(this.stagedFile.thumbUrl);
      }
      this.stagedFile = null;
      this.focusInput();
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
    emojiOnSelect({ emoji }) {
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
      this.$refs.chatInput?.focus?.();
    },

    async handleRestart() {
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
  <!-- Conversation ended -->
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
  <div v-else class="chat-input-container">
    <!-- Staged file preview -->
    <div v-if="stagedFile" class="staged-file-preview">
      <div class="staged-file-content">
        <img
          v-if="stagedFileIsImage && stagedFile.thumbUrl"
          :src="stagedFile.thumbUrl"
          class="staged-file-thumb"
        />
        <div v-else class="staged-file-icon">
          <FluentIcon icon="document" size="20" />
        </div>
        <span class="staged-file-name">{{ stagedFileName }}</span>
      </div>
      <button class="staged-file-remove" @click="removeStagedFile">
        <FluentIcon icon="dismiss" size="14" />
      </button>
    </div>

    <!-- Input row -->
    <div
      class="input-row items-center flex ltr:pl-3 rtl:pr-3 ltr:pr-2 rtl:pl-2 rounded-[7px] transition-all duration-200"
      :class="{ 'rounded-t-none': stagedFile }"
      :style="inputBarStyle"
      @keydown.esc="hideEmojiPicker"
    >
      <ResizableTextArea
        id="chat-input"
        ref="chatInput"
        v-model="userInput"
        :rows="1"
        :aria-label="$t('CHAT_PLACEHOLDER')"
        :placeholder="stagedFile ? 'Add a message...' : $t('CHAT_PLACEHOLDER')"
        class="user-message-input reset-base"
        :style="inputTextStyle"
        @typing-off="onTypingOff"
        @typing-on="onTypingOn"
        @focus="onFocus"
        @blur="onBlur"
      />
      <div class="flex items-center ltr:pl-2 rtl:pr-2">
        <ChatAttachmentButton
          v-if="showAttachment"
          class="text-n-slate-12"
          :on-attach="handleFileStaged"
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
          @select="emojiOnSelect"
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
  </div>
</template>

<style scoped lang="scss">
.emoji-dialog {
  @apply max-w-full;
}

.user-message-input {
  @apply border-none outline-none w-full placeholder:text-n-slate-10 resize-none h-8 min-h-8 max-h-60 py-1 px-0 my-2 text-n-slate-12 transition-all duration-200;
  background: transparent !important;
  box-shadow: none !important;
}

.chat-input-container {
  display: flex;
  flex-direction: column;
  box-shadow: none !important;
}

.staged-file-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--n-alpha-2, rgba(0, 0, 0, 0.03));
  border: 1px solid var(--n-strong, rgba(0, 0, 0, 0.12));
  border-bottom: none;
  border-radius: 7px 7px 0 0;
}

.staged-file-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.staged-file-thumb {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  object-fit: cover;
}

.staged-file-icon {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: var(--n-alpha-2, rgba(0, 0, 0, 0.06));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--n-slate-11, #64748b);
}

.staged-file-name {
  font-size: 13px;
  color: var(--n-slate-12, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.staged-file-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: var(--n-alpha-2, rgba(0, 0, 0, 0.06));
  color: var(--n-slate-11, #64748b);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
  &:hover {
    background: var(--n-alpha-3, rgba(0, 0, 0, 0.1));
  }
}
</style>
