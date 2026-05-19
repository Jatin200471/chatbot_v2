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
  // Skip if the path already carries a website_token — endPoints.createConversation
  // builds its URL via buildSearchParamsWithLocale(window.location.search), which
  // copies the token from the iframe URL. Adding it again here was producing
  // duplicate query params (`?website_token=X&...&website_token=X`) and Rails
  // intermittently 500'd on those requests.
  if (/[?&]website_token=/.test(path)) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

// ─── Conversation API helpers ─────────────────────────────────────────────────

const createConversationAPI = async content => {
  const urlData = endPoints.createConversation(content);
  // endPoints returns { url, params } where url already has its own query string.
  // We need to inject website_token into that url.
  return API.post(buildConvUrl(urlData.url), urlData.params);
};

const sendMessageAPI = async (
  content,
  replyTo = null,
  { customAttributes, labels } = {}
) => {
  const urlData = endPoints.sendMessage(content, replyTo, {
    customAttributes,
    labels,
  });
  return API.post(buildConvUrl(urlData.url), urlData.params);
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