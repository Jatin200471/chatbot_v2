import endPoints from 'widget/api/endPoints';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';

// Build a widget conversation API URL that always includes the website_token.
//
// WHY NOT use window.location.search directly?
// ─────────────────────────────────────────────
// window.location.search reflects the iframe's *current* URL query string.
// During exit-chat, clearCurrentUser() calls window.history.replaceState()
// to strip session params from the URL. If website_token were ever stripped
// there, every API call after that would send website_token = null → 404.
//
// Instead we use WEBSITE_TOKEN, which is captured once at module load time
// (in axios.js) from the original iframe URL before any replaceState() runs.
// This makes all API calls immune to URL mutations for the lifetime of the
// iframe.
const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  // Always inject the stable WEBSITE_TOKEN captured at module load time.
  //
  // WHY replace instead of skip:
  // endPoints.createConversation builds its URL via
  // buildSearchParamsWithLocale(window.location.search). If window.location.search
  // has been mutated by replaceState() during session cleanup, the website_token
  // in that URL could be stale or missing → Rails returns 422/404.
  // We strip any existing website_token from the path and re-inject the stable
  // one so the correct token is always sent regardless of URL mutations.
  const cleaned = path.replace(/([?&])website_token=[^&]*/g, '$1').replace(/[?&]$/, '');
  const sep = cleaned.includes('?') ? '&' : '?';
  return `${cleaned}${sep}website_token=${WEBSITE_TOKEN}`;
};

// ─── Conversation API helpers ─────────────────────────────────────────────────

const createConversationAPI = async content => {
  // Validate required parameters
  if (!content || typeof content !== 'object') {
    console.error('[createConversationAPI] Invalid content:', content);
    throw new Error('Invalid conversation parameters');
  }
  
  if (!content.message || content.message.trim() === '') {
    console.error('[createConversationAPI] Message is required but empty:', content);
    throw new Error('Message cannot be empty');
  }
  
  const urlData = endPoints.createConversation(content);
  // endPoints returns { url, params } where url already has its own query string.
  // We need to inject website_token into that url.
  
  console.log('[createConversationAPI] Request URL:', buildConvUrl(urlData.url));
  console.log('[createConversationAPI] Request params:', urlData.params);
  
  try {
    return await API.post(buildConvUrl(urlData.url), urlData.params);
  } catch (error) {
    console.error('[createConversationAPI] Request failed:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    });
    throw error;
  }
};

const sendMessageAPI = async (
  content,
  replyTo = null,
  { customAttributes, labels } = {}
) => {
  // Validate content
  if (!content || content.trim() === '') {
    console.error('[sendMessageAPI] Content is empty:', content);
    throw new Error('Message content cannot be empty');
  }
  
  const urlData = endPoints.sendMessage(content, replyTo, {
    customAttributes,
    labels,
  });
  
  console.log('[sendMessageAPI] Sending message:', {
    url: buildConvUrl(urlData.url),
    content: content.substring(0, 100),
    replyTo,
    customAttributes,
    labels,
  });
  
  try {
    return await API.post(buildConvUrl(urlData.url), urlData.params);
  } catch (error) {
    console.error('[sendMessageAPI] Failed:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    });
    throw error;
  }
};

const sendAttachmentAPI = async (
  attachment,
  { customAttributes, labels } = {}
) => {
  const urlData = endPoints.sendAttachment(attachment, {
    customAttributes,
    labels,
  });
  return API.post(buildConvUrl(urlData.url), urlData.params);
};

const getMessagesAPI = async ({ before, after }) => {
  const urlData = endPoints.getConversation({ before, after });
  return API.get(buildConvUrl(urlData.url), { params: urlData.params });
};

const getConversationAPI = async () => {
  return API.get(buildConvUrl('/api/v1/widget/conversations'));
};

const toggleTyping = async ({ typingStatus }) => {
  return API.post(
    buildConvUrl('/api/v1/widget/conversations/toggle_typing'),
    { typing_status: typingStatus }
  );
};

const setUserLastSeenAt = async ({ lastSeen }) => {
  return API.post(
    buildConvUrl('/api/v1/widget/conversations/update_last_seen'),
    { contact_last_seen_at: lastSeen }
  );
};

const sendEmailTranscript = async () => {
  return API.post(buildConvUrl('/api/v1/widget/conversations/transcript'));
};

const toggleStatus = async () => {
  return API.get(buildConvUrl('/api/v1/widget/conversations/toggle_status'));
};

const setCustomAttributes = async customAttributes => {
  return API.post(
    buildConvUrl('/api/v1/widget/conversations/set_custom_attributes'),
    { custom_attributes: customAttributes }
  );
};

const deleteCustomAttribute = async customAttribute => {
  return API.post(
    buildConvUrl('/api/v1/widget/conversations/destroy_custom_attributes'),
    { custom_attribute: [customAttribute] }
  );
};

export {
  createConversationAPI,
  sendMessageAPI,
  getConversationAPI,
  getMessagesAPI,
  sendAttachmentAPI,
  toggleTyping,
  setUserLastSeenAt,
  sendEmailTranscript,
  toggleStatus,
  setCustomAttributes,
  deleteCustomAttribute,
};