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
import { updateWidgetAuthToken } from 'widget/store/modules/contacts';

import {
  ON_CONVERSATION_CREATED,
  ON_AGENT_MESSAGE_RECEIVED,
} from 'widget/constants/widgetBusEvents';
import { playNewMessageNotificationInWidget } from 'widget/helpers/WidgetAudioNotificationHelper';
import { createTemporaryMessage, getNonDeletedMessages } from './helpers';
import { emitter } from 'shared/helpers/mitt';
export const actions = {
  createConversation: async ({ commit, dispatch }, params) => {
    commit('setConversationUIFlag', { isCreating: true });
    try {
      // endPoints.createConversation (widget/api/endPoints.js) expects the raw
      // form field names: { fullName, emailAddress, phoneNumber, message, customAttributes }.
      // It maps them to { contact: {name, email, phone_number}, message: {content} } internally.
      // Passing a pre-transformed { contact, message } object causes fullName/emailAddress
      // to be undefined → backend receives empty contact → "Account can't be blank" 422.
      const apiParams = {
        fullName: params.fullName || params.contact?.name || '',
        emailAddress: params.emailAddress || params.contact?.email || '',
        phoneNumber: params.phoneNumber || params.contact?.phone_number || '',
        message: params.message || '',
        customAttributes: params.customAttributes || {},
      };

      const { data } = await createConversationAPI(apiParams);
      // Set auth token immediately so all subsequent polling uses the correct contact
      if (data.widget_auth_token) {
        updateWidgetAuthToken(data.widget_auth_token);
      }
      const { messages } = data;
      const [message = {}] = messages;
      commit('pushMessageToConversation', message);
      commit('setLastMessageId'); // required so syncLatestMessages can poll for bot replies
      dispatch('conversationAttributes/getAttributes', {}, { root: true });
      emitter.emit(ON_CONVERSATION_CREATED);
    } catch (_) {
      // Silently fail — error is shown via isCreating flag UI state
    } finally {
      commit('setConversationUIFlag', { isCreating: false });
    }
  },
  sendMessage: async ({ dispatch, state: conversationState }, params) => {
    const { content, replyTo } = params;
    if (!content || content.trim() === '') {
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

    commit('pushMessageToConversation', message);
    commit('updateMessageMeta', { id, meta: { ...meta, error: '' } });
    try {
      const { data } = await sendMessageAPI(content, replyTo, {
        customAttributes: hasPendingMetadata ? pendingCustomAttributes : undefined,
        labels: hasPendingMetadata ? pendingLabels : undefined,
      });
      if (hasPendingMetadata) {
        commit('clearPendingConversationMetadata');
      }
      commit('pushMessageToConversation', { ...data, status: 'sent' });
    } catch (error) {
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
    }
  },

  fetchOldConversations: async ({ commit }, { before } = {}) => {
    try {
      commit('setConversationListLoading', true);
      const response = await getMessagesAPI({ before });
      const payload = response?.data?.payload;
      const meta = response?.data?.meta;
      if (!meta || !payload) return;
      const { contact_last_seen_at: lastSeen } = meta;
      const formattedMessages = getNonDeletedMessages({ messages: payload });
      commit('conversation/setMetaUserLastSeenAt', lastSeen, { root: true });
      commit('setMessagesInConversation', formattedMessages);
      commit('setLastMessageId');
    } catch (error) {
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

      // Don't poll if we don't have a conversation yet — avoids 500s on fresh sessions
      if (!lastMessageId) return;

      const response = await getMessagesAPI({ after: lastMessageId });
      const payload = response?.data?.payload;
      const meta = response?.data?.meta;

      // Guard: if the server returned an error body without payload/meta, bail quietly
      if (!meta || !payload) return;

      const { contact_last_seen_at: lastSeen } = meta;
      const formattedMessages = getNonDeletedMessages({ messages: payload });
      const missingMessages = formattedMessages.filter(
        message => conversations?.[message.id] === undefined
      );
      if (!missingMessages.length) return;
      missingMessages.forEach(message => {
        conversations[message.id] = message;
      });
      const updatedConversation = Object.fromEntries(
        Object.entries(conversations).sort(
          (a, b) => a[1].created_at - b[1].created_at
        )
      );
      commit('conversation/setMetaUserLastSeenAt', lastSeen, { root: true });
      commit('setMissingMessagesInConversation', updatedConversation);

      const hasAgentMessage = missingMessages.some(
        m => m.message_type !== 0
      );
      if (hasAgentMessage) {
        emitter.emit(ON_AGENT_MESSAGE_RECEIVED);
        playNewMessageNotificationInWidget();
      }
    } catch (_) {
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

  // FIX: guard against firing toggle_typing when no conversation exists yet.
  // On a fresh session this endpoint returns 404 because the conversation row
  // hasn't been created yet — the request is wasteful and noisy in the console.
  toggleUserTyping: async ({ rootGetters }, data) => {
    const conversationId =
      rootGetters['conversationAttributes/getConversationParams']?.id;
    if (!conversationId) return;
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