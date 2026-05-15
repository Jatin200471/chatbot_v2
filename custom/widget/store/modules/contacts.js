import { sendMessage } from 'widget/helpers/utils';
import ContactsAPI from '../../api/contacts';
import { SET_USER_ERROR } from '../../constants/errorTypes';
import { setHeader, removeHeader } from '../../helpers/axios';

const state = {
  currentUser: {},
};

const SET_CURRENT_USER = 'SET_CURRENT_USER';

const parseErrorData = error =>
  error && error.response && error.response.data ? error.response.data : error;

export const updateWidgetAuthToken = widgetAuthToken => {
  if (widgetAuthToken) {
    setHeader(widgetAuthToken);
    sendMessage({
      event: 'setAuthCookie',
      data: { widgetAuthToken },
    });
  }
};

// ─── SESSION STORAGE CLEANUP ───────────────────────────────────────────────
// This helper wipes all session/auth/conversation data on exit or 404.
//
// ⚠️  DO NOT add 'website_token' here.
//     website_token is NOT session data — it is configuration data embedded
//     in the iframe URL by the SDK to identify which inbox this widget belongs
//     to. Every API call the widget makes passes it as a URL query param.
//     If you delete it, the server receives website_token = NULL and throws:
//       "Couldn't find Channel::WebWidget with website_token IS NULL → 404"
//     The SDK re-embeds it on every fresh iframe load, so you never need to
//     preserve or clear it manually.
// ──────────────────────────────────────────────────────────────────────────
const clearSessionStorage = () => {
  // Explicit session/auth keys to remove
  const SESSION_KEYS = [
    'cwc-unique-id',
    'cwc-session',
    'cw_contact_uuid',
    'cw_conversation',
    'cw_conversation_id',
    'chatwoot_contact_id',
    'chatwoot_conversation_id',
    'chatwootContactIdentity',
    'user_color',
    'user_uuid',
    'cw_d',
    'cw_auth_token',
    'widget_auth_token',
  ];

  SESSION_KEYS.forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });

  // Pattern-based sweep — keep chatwoot_user_data for form pre-fill
  [localStorage, sessionStorage].forEach(storage => {
    Object.keys(storage)
      .filter(
        k =>
          (k.includes('chatwoot') ||
            k.includes('cw_') ||
            k.includes('cwc') ||
            k.includes('widget_auth')) &&
          k !== 'chatwoot_user_data'
      )
      .forEach(k => storage.removeItem(k));
  });

  // Clear session cookies
  document.cookie.split(';').forEach(cookie => {
    const name = cookie.split('=')[0].trim();
    if (
      name.includes('chatwoot') ||
      name.includes('cw_') ||
      name.includes('cwc') ||
      name === 'cw_d'
    ) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${location.hostname}`;
    }
  });

  // Strip session params from the iframe URL.
  // ⚠️  'website_token' is intentionally NOT in this list — see note above.
  try {
    const url = new URL(window.location.href);
    ['cw_conversation', 'cw_contact', 'cw_d'].forEach(p =>
      url.searchParams.delete(p)
    );
    // Also sweep any remaining cw_* / cwc* params (but not website_token)
    [...url.searchParams.keys()]
      .filter(k => k.startsWith('cw_') || k.startsWith('cwc'))
      .forEach(k => url.searchParams.delete(k));
    window.history.replaceState({}, '', url.toString());
  } catch (_) {}
};

const EMPTY_USER = {
  has_email: false,
  has_phone_number: false,
  identifier: null,
  name: '',
  email: '',
  phone_number: '',
};

export const getters = {
  getCurrentUser(_state) {
    return _state.currentUser;
  },
};

export const actions = {
  get: async ({ commit }) => {
    try {
      const { data } = await ContactsAPI.get();
      commit(SET_CURRENT_USER, data);
    } catch (error) {
      // 404 means the contact/conversation was deleted (e.g. after exit-chat).
      // Clear stale session data and reset to a blank user so the pre-chat
      // form is shown on next open.
      if (error.response?.status === 404) {
        clearSessionStorage();
        removeHeader('X-Auth-Token');
        commit(SET_CURRENT_USER, EMPTY_USER);
      }
      // All other errors are silently ignored.
    }
  },

  // Load user data saved during a previous session so the form can be pre-filled.
  loadSavedUserData: ({ commit }) => {
    try {
      const savedUserData = localStorage.getItem('chatwoot_user_data');
      if (savedUserData) {
        const userData = JSON.parse(savedUserData);
        if (userData.name || userData.email) {
          commit(SET_CURRENT_USER, {
            has_email: !!userData.email,
            has_phone_number: !!userData.phone_number,
            identifier: null,
            name: userData.name || '',
            email: userData.email || '',
            phone_number: userData.phone_number || '',
          });
        }
      }
    } catch (error) {
      // Ignore corrupted localStorage
    }
  },

  update: async ({ commit, dispatch }, { user }) => {
    try {
      await ContactsAPI.update(user);
      // Immediately update Vuex store with new user data so any greeting
      // or UI element reflecting the name uses the current session's input.
      commit(SET_CURRENT_USER, {
        ...user,
        has_email: !!user.email,
        has_phone_number: !!user.phone_number,
      });
      dispatch('get');
    } catch (error) {
      // Ignore error
    }
  },

  setUser: async ({ dispatch }, { identifier, user: userObject }) => {
    try {
      const {
        email,
        name,
        avatar_url,
        identifier_hash: identifierHash,
        phone_number,
        company_name,
        city,
        country_code,
        description,
        custom_attributes,
        social_profiles,
      } = userObject;
      const user = {
        email,
        name,
        avatar_url,
        identifier_hash: identifierHash,
        phone_number,
        additional_attributes: {
          company_name,
          city,
          description,
          country_code,
          social_profiles,
        },
        custom_attributes,
      };
      const {
        data: { widget_auth_token: widgetAuthToken },
      } = await ContactsAPI.setUser(identifier, user);
      updateWidgetAuthToken(widgetAuthToken);
      dispatch('get');
      if (identifierHash || widgetAuthToken) {
        dispatch('conversation/clearConversations', {}, { root: true });
        dispatch('conversation/fetchOldConversations', {}, { root: true });
        dispatch('conversationAttributes/getAttributes', {}, { root: true });
      }
    } catch (error) {
      const data = parseErrorData(error);
      sendMessage({ event: 'error', errorType: SET_USER_ERROR, data });
    }
  },

  setCustomAttributes: async (_, customAttributes = {}) => {
    try {
      await ContactsAPI.setCustomAttributes(customAttributes);
    } catch (error) {
      // Ignore error
    }
  },

  deleteCustomAttribute: async (_, customAttribute) => {
    try {
      await ContactsAPI.deleteCustomAttribute(customAttribute);
    } catch (error) {
      // Ignore error
    }
  },

  /**
   * Called by HeaderActions.endChat().
   *
   * Order of operations:
   *   1. Reset Vuex contact state to blank
   *   2. Remove axios auth headers
   *   3. Clear session/auth storage (keep chatwoot_user_data for form pre-fill)
   *   4. Send exitChat to parent — SDK destroys + reloads the iframe
   *
   * HeaderActions navigates to prechat-form BEFORE calling this action,
   * so the user never sees the blank messages screen during the reload.
   */
  clearCurrentUser: ({ commit }) => {
    // 1. Reset Vuex contact state
    commit(SET_CURRENT_USER, EMPTY_USER);

    // 2. Remove axios auth headers
    removeHeader('X-Auth-Token');
    removeHeader('api_access_token');
    removeHeader('user_access_token');

    // 3. Wipe session/auth storage — website_token is preserved (see clearSessionStorage note)
    clearSessionStorage();

    // 4. Tell the parent to fully tear down and reload the SDK iframe.
    sendMessage({ event: 'exitChat' });
  },

  resetOnApiError: ({ commit }) => {
    // Called when an API call returns 404 — clear stale session and reset.
    clearSessionStorage();
    removeHeader('X-Auth-Token');
    commit(SET_CURRENT_USER, EMPTY_USER);
  },

  /**
   * Soft exit — same teardown as `clearCurrentUser` but WITHOUT the
   * `{ event: 'exitChat' }` postMessage and WITHOUT a window.location.reload().
   *
   * Use this when the widget should stay alive and just reset to a fresh state
   * (e.g. user clicks Exit Chat, or the dashboard/auto-resolver closes the
   * conversation). The caller is responsible for navigating the router back
   * to `home` and posting `closeWindow` to the parent if it wants the iframe
   * panel hidden.
   */
  softExitChat: ({ commit, dispatch }) => {
    commit(SET_CURRENT_USER, EMPTY_USER);
    removeHeader('X-Auth-Token');
    removeHeader('api_access_token');
    removeHeader('user_access_token');
    clearSessionStorage();
    try { dispatch('conversation/clearConversations', null, { root: true }); } catch (_) {}
  },
};

export const mutations = {
  [SET_CURRENT_USER]($state, user) {
    $state.currentUser = { ...user };
  },
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations,
};