<script>
import TeamAvailability from 'widget/components/TeamAvailability.vue';
import { mapGetters } from 'vuex';
import { useRouter } from 'vue-router';
import configMixin from 'widget/mixins/configMixin';
import ArticleContainer from '../components/pageComponents/Home/Article/ArticleContainer.vue';

export default {
  name: 'Home',
  components: {
    ArticleContainer,
    TeamAvailability,
  },
  mixins: [configMixin],
  setup() {
    const router = useRouter();
    return { router };
  },
  computed: {
    ...mapGetters({
      availableAgents: 'agent/availableAgents',
      unreadMessageCount: 'conversation/getUnreadMessageCount',
      conversationSize: 'conversation/getConversationSize',
      conversationStatus: 'conversationAttributes/getConversationParams',
    }),
    hasExistingConversation() {
      return this.conversationSize > 0;
    },
    isConversationOpen() {
      // Only continue existing conversation if it's OPEN (not resolved, not pending)
      const params = this.conversationStatus;
      return params && params.status === 'open';
    },
  },
  methods: {
    startConversation() {
      // If an existing conversation was rehydrated on load (refresh / page
      // change) AND it's still OPEN, resume it directly. Pre-chat form runs 
      // only for genuinely fresh sessions or resolved conversations.
      if (this.hasExistingConversation && this.isConversationOpen) {
        return this.router.replace({ name: 'messages' });
      }
      if (this.preChatFormEnabled) {
        return this.router.replace({ name: 'prechat-form' });
      }
      return this.router.replace({ name: 'messages' });
    },
  },
};
</script>

<template>
  <div class="z-50 flex flex-col justify-end flex-1 w-full p-4 gap-4">
    <TeamAvailability
      :available-agents="availableAgents"
      :has-conversation="hasExistingConversation && isConversationOpen"
      :unread-count="unreadMessageCount"
      @start-conversation="startConversation"
    />
    <ArticleContainer />
  </div>
</template>