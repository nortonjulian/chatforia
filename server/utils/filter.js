import BadWords from 'bad-words-next';

const filter = new BadWords();

/**
 * Check if a string contains profanity.
 * @param {string | undefined} text
 * @returns {boolean}
 */
export function isExplicit(text) {
  if (!text) return false;
  const hits = filter.check(text);
  return Array.isArray(hits) && hits.length > 0;
}

/**
 * Clean profanity by replacing with asterisks or replacing entire message.
 * @param {string | undefined} text
 * @param {boolean} strict - If true, replaces entire message with a warning.
 * @returns {string | undefined}
 */
export function cleanText(text, strict = false) {
  if (text === undefined || text === null) return text;
  if (text === '') return '';

  if (strict && isExplicit(text)) {
    return '[Message removed due to explicit content]';
  }

  return filter.filter(text);
}
