<script>
import { mapActions } from 'vuex';
import { useRouter } from 'vue-router';
import PreChatForm from '../components/PreChat/Form.vue';
import configMixin from '../mixins/configMixin';
import { isEmptyObject } from 'widget/helpers/utils';
import { ON_CONVERSATION_CREATED } from '../constants/widgetBusEvents';
import { emitter } from 'shared/helpers/mitt';

export default {
  components: {
    PreChatForm,
  },
  mixins: [configMixin],
  setup() {
    const router = useRouter();
    return { router };
  },
  mounted() {
    // Register event listener for conversation creation
    emitter.on(ON_CONVERSATION_CREATED, this.handleConversationCreated);
    
    // If there's a resolved conversation, clear it so we can start fresh
    this.checkAndClearResolvedConversation();
  },
  beforeUnmount() {
    emitter.off(ON_CONVERSATION_CREATED, this.handleConversationCreated);
  },
  methods: {
    ...mapActions('conversation', ['clearConversations']),
    ...mapActions('conversationAttributes', ['clearConversationAttributes']),
    handleConversationCreated() {
      // Redirect to messages page after conversation is created
      this.router.replace({ name: 'messages' });
    },
    async checkAndClearResolvedConversation() {
      // Get conversation status from store
      const conversationStatus = this.$store.getters['conversationAttributes/getConversationParams'];
      if (conversationStatus && conversationStatus.status === 'resolved') {
        console.log('[PreChatForm] Clearing resolved conversation');
        this.clearConversations();
        this.clearConversationAttributes();
      }
    },

    async onSubmit({
      fullName,
      emailAddress,
      message,
      activeCampaignId,
      phoneNumber,
      contactCustomAttributes,
      conversationCustomAttributes,
    }) {
      if (activeCampaignId) {
        emitter.emit('execute-campaign', {
          campaignId: activeCampaignId,
          customAttributes: conversationCustomAttributes,
        });
        this.$store.dispatch('contacts/update', {
          user: {
            email: emailAddress,
            name: fullName,
            phone_number: phoneNumber,
          },
        });
      } else {
        this.clearConversations();
        this.clearConversationAttributes();

        // ── Fire-and-forget contact update.
        //    Form.vue already dispatched the same update before emitting
        //    submitPreChat, so this is a safety net. We intentionally do NOT
        //    `await` it here — if the contact-update API hangs (slow network,
        //    backend lag) it would block createConversation and the visitor
        //    would see "Start Conversation" do nothing forever. The AI bot
        //    greeting uses the cached name in that edge case; correctness of
        //    the greeting is a smaller cost than a stuck form.
        try {
          this.$store.dispatch('contacts/update', {
            user: {
              email: emailAddress,
              name: fullName,
              phone_number: phoneNumber,
            },
          });
        } catch (_) {}

        this.$store.dispatch('conversation/createConversation', {
          fullName: fullName,
          emailAddress: emailAddress,
          message: message,
          phoneNumber: phoneNumber,
          customAttributes: conversationCustomAttributes,
        });
      }
      if (!isEmptyObject(contactCustomAttributes)) {
        this.$store.dispatch(
          'contacts/setCustomAttributes',
          contactCustomAttributes
        );
      }
    },
  },
};
</script>

<template>
  <div class="flex flex-1 overflow-auto">
    <PreChatForm :options="preChatFormOptions" @submit-pre-chat="onSubmit" />
  </div>
</template>