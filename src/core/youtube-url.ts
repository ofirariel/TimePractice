const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts the 11-character video id from anything a user is likely to paste:
 * watch/share/shorts/embed/live/music links, with or without "https://", or a bare id.
 */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') candidate = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) candidate = parts[1] ?? null;
    else candidate = url.searchParams.get('v');
  }
  return candidate && ID.test(candidate) ? candidate : null;
}
