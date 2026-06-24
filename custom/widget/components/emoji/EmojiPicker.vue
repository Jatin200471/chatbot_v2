<script>
import {
  buildEmojiSections,
  getEmojiTint,
  getRecentEmojis,
  addRecentEmoji,
} from 'shared/components/emoji/pickerHelper';

export default {
  name: 'EmojiPicker',
  emits: ['select'],
  data() {
    return {
      emojiSearch: '',
      recentEmojis: [],
    };
  },
  computed: {
    emojiSections() {
      return buildEmojiSections(
        this.emojiSearch,
        this.recentEmojis,
        this.$t('EMOJI_ICON_PICKER.FREQUENTLY_USED')
      );
    },
  },
  mounted() {
    this.recentEmojis = getRecentEmojis();
    this.$nextTick(() => {
      this.$refs.searchInput?.focus();
    });
  },
  methods: {
    applyEmojiTint(event, emoji) {
      event.currentTarget.style.setProperty('--ep-tint', getEmojiTint(emoji));
    },
    selectEmoji(emoji) {
      this.recentEmojis = addRecentEmoji(emoji);
      this.$emit('select', { type: 'emoji', value: emoji.emoji, emoji: emoji.emoji });
    },
  },
};
</script>

<template>
  <div
    role="dialog"
    class="emoji-dialog"
    style="position:fixed;bottom:56px;right:12px;left:auto;top:auto;width:calc(100vw - 24px);max-width:340px;max-height:calc(100vh - 120px);z-index:9999;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 -4px 20px rgba(0,0,0,0.15);border:1px solid rgba(0,0,0,0.08)"
  >
    <div style="display:flex;flex-direction:column;gap:4px;padding-top:8px">
      <div style="padding:0 8px">
        <input
          ref="searchInput"
          v-model="emojiSearch"
          type="text"
          :placeholder="$t('EMOJI_ICON_PICKER.SEARCH_EMOJI')"
          style="display:block;width:100%;height:36px;font-size:14px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:0 12px;background:transparent;color:#1e293b;outline:none;box-sizing:border-box"
        />
      </div>
      <div
        v-if="emojiSections.length"
        style="height:240px;overflow-y:auto;padding:0 8px 8px;scrollbar-width:none"
      >
        <div v-for="section in emojiSections" :key="section.name">
          <h5
            style="padding:8px 4px 4px;margin:0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8"
          >
            {{ section.name }}
          </h5>
          <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px">
            <button
              v-for="emoji in section.emojis"
              :key="`${section.name}-${emoji.slug}`"
              type="button"
              :title="emoji.name"
              style="display:flex;align-items:center;justify-content:center;padding:0;width:100%;font-size:20px;aspect-ratio:1;border:none;border-radius:8px;background:transparent;cursor:pointer"
              @mouseenter="applyEmojiTint($event, emoji.emoji)"
              @click="selectEmoji(emoji)"
            >
              {{ emoji.emoji }}
            </button>
          </div>
        </div>
      </div>
      <div
        v-else
        style="display:flex;align-items:center;justify-content:center;height:240px;color:#94a3b8;font-size:14px"
      >
        {{ $t('EMOJI_ICON_PICKER.NO_EMOJI') }}
      </div>
    </div>
  </div>
</template>
