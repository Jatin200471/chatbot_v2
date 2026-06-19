<script setup>
import { ref, computed } from 'vue';
import ResizableTextArea from 'shared/components/ResizableTextArea.vue';
import Avatar from 'next/avatar/Avatar.vue';
import FluentIcon from 'shared/components/FluentIcon/Index.vue';

const props = defineProps({
  config: {
    type: Object,
    default: () => ({}),
  },
});

const isInputFocused = ref(false);

const getStatusText = computed(() => {
  if (props.config.isOnline) {
    return props.config.availableMessage || 'We are online';
  }
  return props.config.unavailableMessage || 'We are offline';
});

const onlineStatusStyle = computed(() => {
  const s = {};
  if (props.config.onlineStatusColor) s.color = props.config.onlineStatusColor;
  return s;
});

const replyTimeStyle = computed(() => {
  const s = {};
  if (props.config.replyTimeColor) s.color = props.config.replyTimeColor;
  return s;
});

const ctaButtonStyle = computed(() => {
  const s = {};
  if (props.config.ctaBgColor) s.background = props.config.ctaBgColor;
  if (props.config.ctaTextColor) s.color = props.config.ctaTextColor;
  return s;
});

const ctaTextStyle = computed(() => {
  if (!props.config.ctaBgColor && !props.config.ctaTextColor) {
    return { color: props.config.color };
  }
  return {};
});

const inputFocusStyle = computed(() => {
  if (isInputFocused.value && props.config.inputFocusColor) {
    return {
      boxShadow: `0 0 0 2px ${props.config.inputFocusColor}`,
      borderColor: props.config.inputFocusColor,
    };
  }
  return {};
});
</script>

<template>
  <div class="relative flex flex-col w-full px-4">
    <div
      v-if="config.isDefaultScreen"
      class="p-4 rounded-md shadow-sm bg-n-background dark:bg-n-solid-2"
    >
      <div class="flex items-center justify-between">
        <div>
          <div
            class="text-sm font-medium leading-4 text-n-slate-12 dark:text-n-slate-50"
            :style="onlineStatusStyle"
          >
            {{ getStatusText }}
          </div>
          <div class="mt-1 text-xs text-n-slate-11" :style="replyTimeStyle">
            {{ config.replyTime }}
          </div>
        </div>
        <Avatar name="C" :size="34" rounded-full />
      </div>
      <button
        v-if="config.isDefaultScreen"
        class="inline-flex items-center justify-between px-2 py-1 mt-1 -ml-2 font-medium leading-6 bg-transparent rounded-md text-n-slate-12 dark:bg-transparent"
        :style="ctaTextStyle"
      >
        <span class="pr-2 text-xs" :style="ctaButtonStyle">
          {{
            $t(
              'INBOX_MGMT.WIDGET_BUILDER.FOOTER.START_CONVERSATION_BUTTON_TEXT'
            )
          }}
        </span>
        <FluentIcon icon="arrow-right" size="14" />
      </button>
    </div>
    <div
      v-else
      class="flex items-center h-10 bg-white rounded-md dark:!bg-n-slate-3"
      :class="{ 'ring-2 ring-n-brand dark:ring-n-brand': isInputFocused && !config.inputFocusColor }"
      :style="inputFocusStyle"
    >
      <ResizableTextArea
        id="chat-input"
        :rows="1"
        :placeholder="
          $t('INBOX_MGMT.WIDGET_BUILDER.FOOTER.CHAT_INPUT_PLACEHOLDER')
        "
        class="flex-grow !bg-white border-0 outline-none !outline-0 border-none h-8 text-sm dark:!bg-n-slate-3 pb-0 !pt-1.5 resize-none px-3 !mb-0 focus:outline-none rounded-md"
        @focus="isInputFocused = true"
        @blur="isInputFocused = false"
      />
      <div class="flex items-center gap-2 px-2">
        <FluentIcon icon="emoji" />
        <FluentIcon class="icon-send" icon="send" />
      </div>
    </div>
  </div>
</template>
