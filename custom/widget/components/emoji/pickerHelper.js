import emojiGroups from 'shared/components/emoji/emojisGroup.json';

const RECENT_EMOJI_KEY = 'emoji-icon-picker.recent-emojis';
const MAX_RECENT_EMOJIS = 16;

const matchesSearch = (emoji, term) =>
  emoji.slug.replaceAll('_', ' ').includes(term) ||
  emoji.name.toLowerCase().includes(term);

export const buildEmojiSections = (search, recentEmojis, frequentLabel) => {
  const term = search.trim().toLowerCase();
  if (term) {
    return emojiGroups
      .map(({ name, emojis }) => ({
        name,
        emojis: emojis.filter(e => matchesSearch(e, term)),
      }))
      .filter(group => group.emojis.length);
  }
  return [
    ...(recentEmojis.length
      ? [{ name: frequentLabel, emojis: recentEmojis }]
      : []),
    ...emojiGroups,
  ];
};

const emojiTintCache = new Map();
const NEUTRAL_TINT = 'rgba(0,0,0,0.06)';

const sampleEmojiTint = emoji => {
  const canvas = Object.assign(document.createElement('canvas'), {
    width: 16,
    height: 16,
  });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.font = '14px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 8, 9);

  const { data } = ctx.getImageData(0, 0, 16, 16);
  const pixels = Array.from(
    { length: data.length / 4 },
    (_, i) => i * 4
  ).filter(i => data[i + 3] > 16);
  if (!pixels.length) return NEUTRAL_TINT;

  const avg = offset =>
    Math.round(
      pixels.reduce((sum, i) => sum + data[i + offset], 0) / pixels.length
    );

  return `rgba(${avg(0)}, ${avg(1)}, ${avg(2)}, 0.16)`;
};

export const getEmojiTint = emoji => {
  if (!emojiTintCache.has(emoji)) {
    let tint = NEUTRAL_TINT;
    try {
      tint = sampleEmojiTint(emoji);
    } catch {
      /* canvas unavailable */
    }
    emojiTintCache.set(emoji, tint);
  }
  return emojiTintCache.get(emoji);
};

export const getRecentEmojis = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) ?? '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

export const addRecentEmoji = emoji => {
  const updated = [
    emoji,
    ...getRecentEmojis().filter(item => item.slug !== emoji.slug),
  ].slice(0, MAX_RECENT_EMOJIS);
  try {
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(updated));
  } catch {
    /* private mode */
  }
  return updated;
};
