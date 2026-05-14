// Fetch inbox configuration including voice agent settings
// This is called by the widget to get voice agent provider, API key, and config data

import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';

const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

// Fetch inbox config with voice agent settings
const getInboxConfigAPI = async () => {
  return API.get(buildConvUrl('/api/v1/widget/inbox/config'));
};

export {
  getInboxConfigAPI,
};
