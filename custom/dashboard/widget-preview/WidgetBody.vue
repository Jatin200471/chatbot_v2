<script setup>
import { computed } from 'vue';

const props = defineProps({
  config: {
    type: Object,
    default: () => ({}),
  },
});

const userBubbleStyle = computed(() => {
  const s = {};
  s.background = props.config.userBubbleBgColor || props.config.color || '#1f93ff';
  if (props.config.userBubbleTextColor) s.color = props.config.userBubbleTextColor;
  if (props.config.messageFontSize) s.fontSize = props.config.messageFontSize + 'px';
  return s;
});

const agentBubbleStyle = computed(() => {
  const s = {};
  if (props.config.botBubbleBgColor) s.background = props.config.botBubbleBgColor;
  if (props.config.botBubbleTextColor) s.color = props.config.botBubbleTextColor;
  if (props.config.messageFontSize) s.fontSize = props.config.messageFontSize + 'px';
  return s;
});
</script>

<template>
  <div class="h-[calc(2rem*10)] px-4 overflow-y-auto">
    <div>
      <div>
        <div
          class="items-end flex justify-end ml-auto mb-1 mt-0 max-w-[85%] text-right"
        >
          <div
            class="rounded-[1.25rem] rounded-br-[0.25rem] text-white dark:text-white text-sm px-4 py-3"
            :style="userBubbleStyle"
          >
            <p class="m-0">
              {{ $t('INBOX_MGMT.WIDGET_BUILDER.BODY.USER_MESSAGE') }}
            </p>
          </div>
        </div>
      </div>

      <div
        class="shadow rounded-[1.25rem] rounded-bl-[0.25rem] px-4 py-3 inline-block text-sm text-n-slate-12 bg-n-background dark:bg-n-solid-3"
        :style="agentBubbleStyle"
      >
        <div>
          <p class="m-0">
            {{ $t('INBOX_MGMT.WIDGET_BUILDER.BODY.AGENT_MESSAGE') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
