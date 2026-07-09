// Experimental: pull a fully-scouted live game from Porofessor's public
// live page in one request (no Riot API key needed, and it reveals names
// itself). Porofessor is behind Cloudflare, so this may be blocked — the
// probe below reports exactly what comes back so we build against reality,
// not guesses.
import { logError } from './log.js';

// Riot platform → Porofessor region slug.
const REGION = {
  na1: 'na', euw1: 'euw', eun1: 'eune', kr: 'kr', br1: 'br', jp1: 'jp',
  la1: 'lan', la2: 'las', oc1: 'oce', tr1: 'tr', ru: 'ru', me1: 'me',
  sg2: 'sg', tw2: 'tw', vn2: 'vn'
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest'
};

// "GameName#TAG" -> "GameName-TAG" (name percent-encoded, spaces as %20).
export function porofessorSlug(riotId) {
  const [name, tag] = riotId.split('#');
  if (!name || !tag) {
    const err = new Error(`"${riotId}" needs the GameName#TAG format`);
    err.status = 400;
    throw err;
  }
  return `${encodeURIComponent(name)}-${encodeURIComponent(tag)}`;
}

function urls(platform, riotId) {
  const region = REGION[platform] || 'na';
  const slug = porofessorSlug(riotId);
  return {
    partial: `https://porofessor.gg/partial/live-partial/${region}/${slug}`,
    page: `https://porofessor.gg/live/${region}/${slug}`
  };
}

async function get(url, referer) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      headers: referer ? { ...BROWSER_HEADERS, Referer: referer } : BROWSER_HEADERS,
      signal: ctl.signal,
      redirect: 'follow'
    });
    const text = await res.text();
    return { url, status: res.status, length: text.length, text };
  } catch (e) {
    return { url, status: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message) };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch the live partial (and the page as a fallback), returning a small
// sample + a guess at whether we hit a Cloudflare/JS wall.
export async function probe(platform, riotId) {
  const { partial, page } = urls(platform, riotId);
  const pageRes = await get(page, 'https://porofessor.gg/');
  const partialRes = await get(partial, page);
  const summarize = (r) => {
    if (!r.text) return { url: r.url, status: r.status };
    const t = r.text;
    const cloudflare = /cloudflare|challenge-platform|cf-browser-verification|Just a moment/i.test(t);
    const hasPlayers = /summoner|champion|winrate|soloTier|rank/i.test(t);
    return {
      url: r.url,
      status: r.status,
      length: r.length,
      looksLikeCloudflare: cloudflare,
      looksLikePlayerData: hasPlayers && !cloudflare,
      sample: t.slice(0, 1200)
    };
  };
  const result = { platform, riotId, page: summarize(pageRes), partial: summarize(partialRes) };
  if (!result.page.looksLikePlayerData && !result.partial.looksLikePlayerData) {
    logError('porofessor probe', new Error(`no player data: page=${result.page.status} partial=${result.partial.status}`));
  }
  return result;
}
