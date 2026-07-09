// Higher-level data products built on the raw Riot endpoints:
//  - summarizeMatch: trim a full match-v5 payload down to what the UI shows
//  - playerDossier: the Porofessor-style card for one player
//  - recommendations: Mobalytics-style "what should I play" scoring
import {
  accountByRiotId, accountByPuuid, summonerByPuuid, leagueEntriesByPuuid,
  topMasteries, matchIds, getMatch
} from './riot.js';

export const QUEUE_NAMES = {
  400: 'Normal Draft', 420: 'Ranked Solo', 430: 'Normal Blind', 440: 'Ranked Flex',
  450: 'ARAM', 490: 'Quickplay', 700: 'Clash', 720: 'ARAM Clash',
  830: 'Co-op vs AI', 840: 'Co-op vs AI', 850: 'Co-op vs AI',
  900: 'URF', 1020: 'One for All', 1300: 'Nexus Blitz', 1400: 'Ultimate Spellbook',
  1700: 'Arena', 1710: 'Arena', 1900: 'URF'
};

export function summarizeMatch(match, puuid) {
  const info = match.info;
  const me = info.participants.find((p) => p.puuid === puuid);
  if (!me) return null;
  const minutes = Math.max(1, info.gameDuration / 60);
  const cs = (me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0);
  return {
    matchId: match.metadata.matchId,
    queueId: info.queueId,
    queue: QUEUE_NAMES[info.queueId] || `Queue ${info.queueId}`,
    gameCreation: info.gameCreation,
    gameDuration: info.gameDuration,
    win: me.win,
    remake: info.gameDuration < 300,
    championId: me.championId,
    championName: me.championName,
    kills: me.kills, deaths: me.deaths, assists: me.assists,
    kda: me.deaths === 0 ? me.kills + me.assists : (me.kills + me.assists) / me.deaths,
    cs,
    csPerMin: cs / minutes,
    visionScore: me.visionScore,
    damage: me.totalDamageDealtToChampions,
    teamPosition: me.teamPosition || '',
    items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6],
    summoners: [me.summoner1Id, me.summoner2Id],
    keystone: me.perks?.styles?.[0]?.selections?.[0]?.perk || null,
    participants: info.participants.map((p) => ({
      puuid: p.puuid,
      riotId: p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagline}` : p.summonerName,
      championId: p.championId,
      championName: p.championName,
      teamId: p.teamId,
      win: p.win
    }))
  };
}

async function recentSummaries(puuid, platform, count, opts = {}) {
  const ids = await matchIds(puuid, platform, { count, ...opts });
  const summaries = [];
  for (const id of ids) {
    try {
      const match = await getMatch(id, platform);
      const s = summarizeMatch(match, puuid);
      if (s) summaries.push(s);
    } catch {
      // skip matches that fail (rate limit blips, unsupported modes)
    }
  }
  return summaries;
}

function buildTags({ solo, recent, masteries, championId, champStats, onChamp }) {
  const tags = [];
  if (solo?.hotStreak) tags.push({ label: 'Hot streak', tone: 'good' });
  const played = recent.filter((m) => !m.remake);
  const last5 = played.slice(0, 5);
  const wins5 = last5.filter((m) => m.win).length;
  if (last5.length >= 5 && wins5 >= 4) tags.push({ label: 'On fire', tone: 'good' });
  if (last5.length >= 5 && wins5 <= 1) tags.push({ label: 'Rough patch', tone: 'bad' });
  if (solo) {
    const total = solo.wins + solo.losses;
    const wr = total ? solo.wins / total : 0;
    if (total >= 40 && wr >= 0.58) tags.push({ label: `${Math.round(wr * 100)}% WR — watch out`, tone: 'warn' });
    if (solo.veteran) tags.push({ label: 'Veteran', tone: 'neutral' });
    if (solo.freshBlood) tags.push({ label: 'New to tier', tone: 'neutral' });
    if (solo.inactive) tags.push({ label: 'Rusty (inactive)', tone: 'warn' });
  } else {
    tags.push({ label: 'Unranked', tone: 'neutral' });
  }
  // One-trick: most of their recent ranked games on a single champ, or huge
  // mastery on the champ they're locked in on.
  const top = champStats?.[0];
  if (top && played.length >= 8 && top.games / played.length >= 0.6) {
    tags.push({ label: `${DDNAME(top)} one-trick`, tone: 'warn' });
  } else if (championId) {
    const m = masteries.find((x) => x.championId === championId);
    if (m && m.points >= 200_000) tags.push({ label: 'One-trick alert', tone: 'warn' });
  }
  if (championId && onChamp) {
    if (onChamp.games >= 5 && onChamp.winrate >= 65) tags.push({ label: 'Comfort pick — respect it', tone: 'warn' });
    if (onChamp.games >= 4 && onChamp.winrate <= 35) tags.push({ label: 'Struggling on this pick', tone: 'good' });
  }
  if (championId && played.length >= 8 && !onChamp) {
    tags.push({ label: 'Off-meta pick for them', tone: 'neutral' });
  }
  const last = played[0];
  if (last && Date.now() - last.gameCreation > 7 * 24 * 3600_000) {
    tags.push({ label: 'First game in a while', tone: 'warn' });
  }
  return tags;
}

// Tag text helper — champ names resolve client-side, so tags carry the raw
// name from match data when we have it.
function DDNAME(stat) {
  return stat.championName || 'Champion';
}

// Per-champion aggregates from a window of ranked games — what they're
// ACTUALLY playing and winning on right now, u.gg-style.
function champStatsFrom(summaries) {
  const byChamp = new Map();
  for (const m of summaries) {
    if (m.remake) continue;
    let c = byChamp.get(m.championId);
    if (!c) {
      c = { championId: m.championId, championName: m.championName, games: 0, wins: 0, kdaSum: 0 };
      byChamp.set(m.championId, c);
    }
    c.games += 1;
    if (m.win) c.wins += 1;
    c.kdaSum += Math.min(m.kda, 12);
  }
  return [...byChamp.values()]
    .map((c) => ({
      championId: c.championId,
      championName: c.championName,
      games: c.games,
      wins: c.wins,
      winrate: Math.round((100 * c.wins) / c.games),
      avgKda: Math.round((c.kdaSum / c.games) * 10) / 10
    }))
    .sort((a, b) => b.games - a.games || b.winrate - a.winrate);
}

// Full scouting card for one player. `championId` = the champ they're
// currently playing (if we know it), used for one-trick detection.
export async function playerDossier({ riotId, puuid, platform, championId = null }) {
  if (riotId) {
    // Prefer name resolution — LCU-sourced puuids are not guaranteed to
    // match the API-key-scoped puuids the Riot API expects.
    const account = await accountByRiotId(riotId, platform);
    puuid = account.puuid;
    riotId = `${account.gameName}#${account.tagLine}`;
  } else if (puuid) {
    try {
      const account = await accountByPuuid(puuid, platform);
      riotId = `${account.gameName}#${account.tagLine}`;
    } catch {
      riotId = 'Unknown player';
    }
  } else {
    const err = new Error('riotId or puuid required');
    err.status = 400;
    throw err;
  }
  // The last 30 days of ranked games (capped at the 25 most recent) power
  // everything below: form dots, per-champion winrates + KDA, and the
  // headline stat on their current pick. Finished matches cache to disk
  // forever, so repeat scouts cost almost nothing.
  const WINDOW_DAYS = 30;
  const SCOUT_WINDOW = 25;
  const startTime = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 24 * 3600;
  const [entries, masteries, recent] = await Promise.all([
    leagueEntriesByPuuid(puuid, platform).catch(() => []),
    topMasteries(puuid, platform, 3).catch(() => []),
    recentSummaries(puuid, platform, SCOUT_WINDOW, { type: 'ranked', startTime }).catch(() => [])
  ]);
  const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') || null;
  const flex = entries.find((e) => e.queueType === 'RANKED_FLEX_SR') || null;
  const masteryList = masteries.map((m) => ({
    championId: m.championId,
    level: m.championLevel,
    points: m.championPoints
  }));
  const champStats = champStatsFrom(recent);
  const onChamp = championId ? champStats.find((c) => c.championId === championId) || null : null;
  return {
    riotId,
    puuid,
    solo: solo && {
      tier: solo.tier, rank: solo.rank, lp: solo.leaguePoints,
      wins: solo.wins, losses: solo.losses,
      winrate: solo.wins + solo.losses ? Math.round((100 * solo.wins) / (solo.wins + solo.losses)) : 0
    },
    flex: flex && {
      tier: flex.tier, rank: flex.rank, lp: flex.leaguePoints,
      wins: flex.wins, losses: flex.losses,
      winrate: flex.wins + flex.losses ? Math.round((100 * flex.wins) / (flex.wins + flex.losses)) : 0
    },
    masteries: masteryList,
    window: recent.filter((m) => !m.remake).length,
    windowDays: WINDOW_DAYS,
    champStats: champStats.slice(0, 5),
    onChamp,
    recent: recent.slice(0, 5).map((m) => ({
      win: m.win, remake: m.remake, championId: m.championId,
      championName: m.championName, kda: Math.round(m.kda * 10) / 10,
      gameCreation: m.gameCreation
    })),
    tags: buildTags({ solo, recent, masteries: masteryList, championId, champStats, onChamp })
  };
}

// u.gg-style profile bundle: identity + ranks + mastery + match history.
export async function summonerBundle(riotId, platform, { count = 10, start = 0 } = {}) {
  const account = await accountByRiotId(riotId, platform);
  const [summoner, entries, masteries, matches] = await Promise.all([
    summonerByPuuid(account.puuid, platform),
    leagueEntriesByPuuid(account.puuid, platform).catch(() => []),
    topMasteries(account.puuid, platform, 8).catch(() => []),
    recentSummaries(account.puuid, platform, count, { start })
  ]);
  return {
    riotId: `${account.gameName}#${account.tagLine}`,
    puuid: account.puuid,
    profileIconId: summoner.profileIconId,
    summonerLevel: summoner.summonerLevel,
    entries,
    masteries,
    matches
  };
}

// -------------------------------------------------- champion recommendations
// Score = how good a pick each champion is FOR YOU, blending:
//   mastery depth (you know the champ), your winrate on it (smoothed so a
//   1/1 doesn't beat a 14/20), recent form, and volume of games.
export async function recommendations(riotId, platform) {
  const account = await accountByRiotId(riotId, platform);
  const [masteries, summaries] = await Promise.all([
    topMasteries(account.puuid, platform, 30).catch(() => []),
    recentSummaries(account.puuid, platform, 30)
  ]);

  const byChamp = new Map();
  for (const m of summaries) {
    if (m.remake) continue;
    let c = byChamp.get(m.championId);
    if (!c) {
      c = { championId: m.championId, championName: m.championName, games: 0, wins: 0, kdaSum: 0, csSum: 0, roles: {} };
      byChamp.set(m.championId, c);
    }
    c.games += 1;
    if (m.win) c.wins += 1;
    c.kdaSum += Math.min(m.kda, 10);
    c.csSum += m.csPerMin;
    if (m.teamPosition) c.roles[m.teamPosition] = (c.roles[m.teamPosition] || 0) + 1;
  }

  const maxPoints = Math.max(1, ...masteries.map((m) => m.championPoints));
  const masteryByChamp = new Map(masteries.map((m) => [m.championId, m]));
  const champIds = new Set([...byChamp.keys(), ...masteryByChamp.keys()]);

  const recs = [];
  for (const championId of champIds) {
    const stats = byChamp.get(championId);
    const mastery = masteryByChamp.get(championId);
    // Laplace-smoothed winrate pulled toward 50% for tiny samples.
    const games = stats?.games || 0;
    const wins = stats?.wins || 0;
    const smoothedWr = (wins + 2.5) / (games + 5);
    const masteryScore = mastery ? Math.sqrt(mastery.championPoints / maxPoints) : 0;
    const volumeScore = Math.min(1, games / 8);
    const kdaScore = games ? Math.min(1, stats.kdaSum / games / 5) : 0;
    const score =
      0.35 * masteryScore +
      0.35 * smoothedWr +
      0.15 * volumeScore +
      0.15 * kdaScore;
    const roles = stats
      ? Object.entries(stats.roles).sort((a, b) => b[1] - a[1]).map(([r]) => r)
      : [];
    recs.push({
      championId,
      championName: stats?.championName || null,
      score: Math.round(score * 1000) / 10,
      games,
      winrate: games ? Math.round((100 * wins) / games) : null,
      avgKda: games ? Math.round((stats.kdaSum / games) * 10) / 10 : null,
      avgCsPerMin: games ? Math.round((stats.csSum / games) * 10) / 10 : null,
      masteryPoints: mastery?.championPoints || 0,
      masteryLevel: mastery?.championLevel || 0,
      roles
    });
  }
  recs.sort((a, b) => b.score - a.score);
  return {
    riotId: `${account.gameName}#${account.tagLine}`,
    sampleSize: summaries.length,
    recs: recs.slice(0, 25)
  };
}
