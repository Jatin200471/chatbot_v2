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
      const conversationStatus = this.$store.getters['conversationAttributes/getConversationParams'];
      if (conversationStatus && conversationStatus.status === 'resolved') {
        this.clearConversations();
        this.clearConversationAttributes();
        // NOTE: we intentionally do NOT removeHeader('X-Auth-Token') here.
        // Keeping the auth token means the customer is recognised as the same
        // contact when they submit the pre-chat form, so no duplicate "Visitor"
        // account is created in Chatwoot.
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

        // Contact fields are sent inside the createConversation POST body
        // (via the contact: { name, email, phone_number } key). The server's
        // process_update_contact runs ContactIdentifyAction with those values
        // inside the same transaction, so there is NO need to fire a separate
        // PATCH /widget/contact here.
        //
        // Previously this dispatched contacts/update concurrently, which caused
        // a race condition: both requests would create separate "Visitor"
        // contacts on a fresh session (no auth token), then ContactIdentifyAction
        // would return a third merged contact → @contact_inbox mismatch → 422.

        await this.$store.dispatch('conversation/createConversation', {
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