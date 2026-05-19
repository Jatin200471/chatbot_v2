import endPoints from 'widget/api/endPoints';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';

// Build a widget conversation API URL that always includes the website_token.
//
// WEBSITE_TOKEN is captured once at module load from the original iframe URL,
// making all API calls immune to later window.history.replaceState() mutations.
const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  // Skip if the path already carries a website_token to avoid duplicates.
  if (/[?&]website_token=/.test(path)) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

// ─── Conversation API helpers ─────────────────────────────────────────────────

const createConversationAPI = async content => {
  // content shape expected by endPoints.createConversation:
  //   {
  //     message: "string",              ← plain string, endPoints wraps it into { content }
  //     contact: { name, email, phone_number },
  //     customAttributes: {}
  //   }

  if (!content || typeof content !== 'object') {
    throw new Error('Invalid conversation parameters');
  }

  // message is a plain string here
  const messageStr = typeof content.message === 'string'
    ? content.message
    : content.message?.content || '';

  if (!messageStr.trim()) {
    throw new Error('Message cannot be empty');
  }

  console.log('[createConversationAPI] Sending payload:', {
    message: messageStr.substring(0, 50),
    contact: content.contact,
  });

  const urlData = endPoints.createConversation(content);

  console.log('[createConversationAPI] Built URL:', buildConvUrl(urlData.url));
  console.log('[createConversationAPI] Request params:', urlData.params);

  try {
    const response = await API.post(buildConvUrl(urlData.url), urlData.params);
    console.log('[createConversationAPI] Success:', response.data);
    return response;
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