import {
  createConversationAPI,
  sendMessageAPI,
  getMessagesAPI,
  sendAttachmentAPI,
  toggleTyping,
  setUserLastSeenAt,
  toggleStatus,
  setCustomAttributes,
  deleteCustomAttribute,
} from 'widget/api/conversation';

import { ON_CONVERSATION_CREATED } from 'widget/constants/widgetBusEvents';
import { createTemporaryMessage, getNonDeletedMessages } from './helpers';
import { emitter } from 'shared/helpers/mitt';
export const actions = {
  createConversation: async ({ commit, dispatch }, params) => {
    commit('setConversationUIFlag', { isCreating: true });
    try {
      console.log('[createConversation] Starting with params:', params);
      const { data } = await createConversationAPI(params);
      const { messages } = data;
      const [message = {}] = messages;
      commit('pushMessageToConversation', message);
      dispatch('conversationAttributes/getAttributes', {}, { root: true });
      // Emit event to notify that conversation is created and show the chat screen
      emitter.emit(ON_CONVERSATION_CREATED);
    } catch (error) {
      console.error('[createConversation] Failed:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });
      // Show error to user
      const errorMsg = error.response?.data?.error || error.message || 'Failed to create conversation';
      console.error('[createConversation] Error message:', errorMsg);
      // You could dispatch an error notification here if needed
      // e.g., dispatch('notifications/showError', errorMsg, { root: true });
    } finally {
      commit('setConversationUIFlag', { isCreating: false });
    }
  },
  sendMessage: async ({ dispatch, state: conversationState }, params) => {
    const { content, replyTo } = params;
    console.log('[sendMessage] Starting with:', { content: content?.substring(0, 50), replyTo });
    
    if (!content || content.trim() === '') {
      console.error('[sendMessage] Content is empty');
      return;
    }
    
    const message = createTemporaryMessage({ content, replyTo });
    const { pendingCustomAttributes, pendingLabels } = conversationState;
    dispatch('sendMessageWithData', {
      message,
      pendingCustomAttributes,
      pendingLabels,
    });
  },
  sendMessageWithData: async (
    { commit },
    { message, pendingCustomAttributes = {}, pendingLabels = [] }
  ) => {
    const { id, content, replyTo, meta = {} } = message;
    const hasPendingMetadata =
      Object.keys(pendingCustomAttributes).length > 0 ||
      pendingLabels.length > 0;

    console.log('[sendMessageWithData] Adding message to store:', { id, content: content?.substring(0, 50) });
    commit('pushMessageToConversation', message);
    commit('updateMessageMeta', { id, meta: { ...meta, error: '' } });
    try {
      console.log('[sendMessageWithData] Calling API...');
      const { data } = await sendMessageAPI(content, replyTo, {
        customAttributes: hasPendingMetadata
          ? pendingCustomAttributes
          : undefined,
        labels: hasPendingMetadata ? pendingLabels : undefined,
      });
      console.log('[sendMessageWithData] API response:', { id: data.id, status: data.status });
      
      if (hasPendingMetadata) {
        commit('clearPendingConversationMetadata');
      }

      // [VITE] Don't delete this manually, since `pushMessageToConversation` does the replacement for us anyway
      // commit('deleteMessage', message.id);
      commit('pushMessageToConversation', { ...data, status: 'sent' });
    } catch (error) {
      console.error('[sendMessageWithData] Error:', {
        messageId: id,
        status: error.response?.status,
        errorData: error.response?.data,
        message: error.message,
      });
      commit('pushMessageToConversation', { ...message, status: 'failed' });
      commit('updateMessageMeta', {
        id,
        meta: { ...meta, error: error.message || 'Failed to send message' },
      });
    }
  },

  setLastMessageId: async ({ commit }) => {
    commit('setLastMessageId');
  },

  sendAttachment: async ({ commit, state: conversationState }, params) => {
    const {
      attachment: { thumbUrl, fileType },
      meta = {},
    } = params;
    const attachment = {
      thumb_url: thumbUrl,
      data_url: thumbUrl,
      file_type: fileType,
      status: 'in_progress',
    };
    const tempMessage = createTemporaryMessage({
      attachments: [attachment],
      replyTo: params.replyTo,
    });
    const { pendingCustomAttributes, pendingLabels } = conversationState;
    const hasPendingMetadata =
      Object.keys(pendingCustomAttributes).length > 0 ||
      pendingLabels.length > 0;

    commit('pushMessageToConversation', tempMessage);
    try {
      const { data } = await sendAttachmentAPI(params, {
        customAttributes: hasPendingMetadata
          ? pendingCustomAttributes
          : undefined,
        labels: hasPendingMetadata ? pendingLabels : undefined,
      });
      if (hasPendingMetadata) {
        commit('clearPendingConversationMetadata');
      }
      commit('updateAttachmentMessageStatus', {
        message: data,
        tempId: tempMessage.id,
      });
      commit('pushMessageToConversation', { ...data, status: 'sent' });
    } catch (error) {
      commit('pushMessageToConversation', { ...tempMessage, status: 'failed' });
      commit('updateMessageMeta', {
        id: tempMessage.id,
        meta: { ...meta, error: '' },
      });
      // Show error
    }
  },

  fetchOldConversations: async ({ commit }, { before } = {}) => {
    try {
      commit('setConversationListLoading', true);
      const {
        data: { payload, meta },
      } = await getMessagesAPI({ before });
      const { contact_last_seen_at: lastSeen } = meta;
      const formattedMessages = getNonDeletedMessages({ messages: payload });
      commit('conversation/setMetaUserLastSeenAt', lastSeen, { root: true });
      commit('setMessagesInConversation', formattedMessages);
    } catch (error) {
      // On 404 the conversation no longer exists (resolved/deleted after exit-chat).
      // Treat this as "no conversation" — the store stays empty, and Home.vue's
      // startConversation() will route to prechat-form because conversationSize === 0.
      // No storage clearing needed here — clearCurrentUser() already wiped everything
      // when the user clicked Exit Chat.
      if (error.response?.status === 404) {
        commit('clearConversations');
      }
    } finally {
      commit('setConversationListLoading', false);
    }
  },

  syncLatestMessages: async ({ state, commit }) => {
    try {
      const { lastMessageId, conversations } = state;

      const {
        data: { payload, meta },
      } = await getMessagesAPI({ after: lastMessageId });

      const { contact_last_seen_at: lastSeen } = meta;
      const formattedMessages = getNonDeletedMessages({ messages: payload });
      const missingMessages = formattedMessages.filter(
        message => conversations?.[message.id] === undefined
      );
      if (!missingMessages.length) return;
      missingMessages.forEach(message => {
        conversations[message.id] = message;
      });
      // Sort conversation messages by created_at
      const updatedConversation = Object.fromEntries(
        Object.entries(conversations).sort(
          (a, b) => a[1].created_at - b[1].created_at
        )
      );
      commit('conversation/setMetaUserLastSeenAt', lastSeen, { root: true });
      commit('setMissingMessagesInConversation', updatedConversation);
    } catch (error) {
      // IgnoreError
    }
  },

  clearConversations: ({ commit }) => {
    commit('clearConversations');
  },

  addOrUpdateMessage: async ({ commit }, data) => {
    const { id, content_attributes } = data;
    if (content_attributes && content_attributes.deleted) {
      commit('deleteMessage', id);
      return;
    }
    commit('pushMessageToConversation', data);
  },

  toggleAgentTyping({ commit }, data) {
    commit('toggleAgentTypingStatus', data);
  },

  toggleUserTyping: async (_, data) => {
    try {
      await toggleTyping(data);
    } catch (error) {
      // IgnoreError
    }
  },

  setUserLastSeen: async ({ commit, getters: appGetters }) => {
    if (!appGetters.getConversationSize) {
      return;
    }

    const lastSeen = Date.now() / 1000;
    try {
      commit('setMetaUserLastSeenAt', lastSeen);
      await setUserLastSeenAt({ lastSeen });
    } catch (error) {
      // IgnoreError
    }
  },

  resolveConversation: async () => {
    await toggleStatus();
  },

  setCustomAttributes: async (
    { commit, rootGetters },
    customAttributes = {}
  ) => {
    if (!rootGetters['conversationAttributes/getConversationParams']?.id) {
      commit('setPendingCustomAttributes', customAttributes);
      return;
    }
    try {
      await setCustomAttributes(customAttributes);
    } catch (error) {
      // IgnoreError
    }
  },

  deleteCustomAttribute: async ({ commit, rootGetters }, customAttribute) => {
    if (!rootGetters['conversationAttributes/getConversationParams']?.id) {
      commit('removePendingCustomAttribute', customAttribute);
      return;
    }
    try {
      await deleteCustomAttribute(customAttribute);
    } catch (error) {
      // IgnoreError
    }
  },
};