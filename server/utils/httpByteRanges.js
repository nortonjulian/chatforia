/**
 * Parse an RFC 7233 single byte range for streaming audio/video.
 * Multi-ranges are intentionally unsupported (reply 416), never fetch beyond
 * the file bounds and never accept unsafe/ambiguous byte specifications.
 */
export function parseSingleByteRange(header, size) {
  if (!Number.isSafeInteger(size) || size <= 0 ||
      typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start >= size || start > end) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
