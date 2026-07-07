/* LoL Companion frontend — vanilla JS, no build step. */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

async function api(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ------------------------------------------------------------ DataDragon */
const DD = {
  version: null,
  champByKey: new Map(),   // "266" -> { id: "Aatrox", name: "Aatrox" }
  champByNorm: new Map(),  // "missfortune" -> same object

  async init() {
    try {
      const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
      this.version = versions[0];
      const champs = await (
        await fetch(`https://ddragon.leagueoflegends.com/cdn/${this.version}/data/en_US/champion.json`)
      ).json();
      for (const c of Object.values(champs.data)) {
        const entry = { id: c.id, name: c.name };
        this.champByKey.set(c.key, entry);
        this.champByNorm.set(c.name.toLowerCase().replace(/[^a-z0-9]/g, ''), entry);
        this.champByNorm.set(c.id.toLowerCase(), entry);
      }
    } catch (err) {
      console.warn('DataDragon unavailable (offline?) — icons will be blank.', err);
    }
  },

  champ(idOrName) {
    if (idOrName == null) return null;
    const asKey = this.champByKey.get(String(idOrName));
    if (asKey) return asKey;
    return this.champByNorm.get(String(idOrName).toLowerCase().replace(/[^a-z0-9]/g, '')) || null;
  },

  champIcon(idOrName) {
    const c = this.champ(idOrName);
    if (!c || !this.version) return '';
    return `https://ddragon.leagueoflegends.com/cdn/${this.version}/img/champion/${c.id}.png`;
  },

  champName(idOrName) {
    return this.champ(idOrName)?.name || String(idOrName ?? '?');
  },

  itemIcon(id) {
    if (!id || !this.version) return '';
    return `https://ddragon.leagueoflegends.com/cdn/${this.version}/img/item/${id}.png`;
  },

  profileIcon(id) {
    if (id == null || !this.version) return '';
    return `https://ddragon.leagueoflegends.com/cdn/${this.version}/img/profileicon/${id}.png`;
  }
};

/* --------------------------------------------------------------- helpers */
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtPoints(points) {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`;
  if (points >= 1000) return `${Math.round(points / 1000)}K`;
  return String(points);
}

function rankBadge(entry, label) {
  const wrap = el('span');
  if (!entry) {
    const badge = el('span', 'rank-badge', label ? `${label}: Unranked` : 'Unranked');
    wrap.appendChild(badge);
    return wrap;
  }
  const badge = el('span', `rank-badge tier-${entry.tier}`, `${entry.tier} ${entry.rank} · ${entry.lp} LP`);
  wrap.appendChild(badge);
  wrap.appendChild(el('span', 'muted', ` ${entry.winrate}% (${entry.wins}W ${entry.losses}L)`));
  return wrap;
}

function wlDots(recent) {
  const wrap = el('span', 'wl-dots');
  for (const g of recent) {
    wrap.appendChild(el('span', `wl-dot ${g.remake ? 'r' : g.win ? 'w' : 'l'}`));
  }
  return wrap;
}

function champImg(idOrName, cls) {
  const img = el('img', cls);
  img.src = DD.champIcon(idOrName);
  img.alt = DD.champName(idOrName);
  img.title = DD.champName(idOrName);
  img.loading = 'lazy';
  return img;
}

// Champ portrait, or a "?" placeholder pre-pick in lobby/champ select.
function portraitEl(idOrName) {
  if (idOrName == null || !DD.champIcon(idOrName)) {
    return el('div', 'champ-portrait champ-unknown', '?');
  }
  return champImg(idOrName, 'champ-portrait');
}

/* ------------------------------------------------------------ navigation */
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    $(`#view-${btn.dataset.view}`).classList.remove('hidden');
  });
});

/* ---------------------------------------------------------------- status */
let appConfig = { platform: 'na1', riotId: '', hasApiKey: false, platforms: [] };

async function refreshStatus() {
  try {
    const health = await api('/api/health');
    appConfig = { ...appConfig, ...health };
    $('#dotClient').className = `dot ${health.clientDetected ? 'on' : 'off'}`;
    $('#dotGame').className = `dot ${health.inGame ? 'on' : 'off'}`;
    $('#dotKey').className = `dot ${health.hasApiKey ? 'on' : 'off'}`;
    fillPlatformSelects(health.platforms || []);
  } catch {
    // server unreachable; leave dots as-is
  }
}

let platformsFilled = false;
function fillPlatformSelects(platforms) {
  if (platformsFilled || !platforms.length) return;
  platformsFilled = true;
  for (const sel of [$('#searchPlatform'), $('#cfgPlatform')]) {
    sel.innerHTML = '';
    for (const p of platforms) {
      const opt = el('option', '', p.toUpperCase());
      opt.value = p;
      sel.appendChild(opt);
    }
    sel.value = appConfig.platform;
  }
}

/* -------------------------------------------------------------- live view */
function playerCardSkeleton(p) {
  const card = el('div', 'player-card');
  const champ = p.championId ?? p.championName ?? null;
  card.appendChild(portraitEl(champ));
  const main = el('div', 'player-main');
  main.appendChild(el('div', 'player-name', p.riotId || 'Hidden name'));
  const sub = champ != null && DD.champ(champ)
    ? DD.champName(champ)
    : (p.position ? p.position.charAt(0) + p.position.slice(1).toLowerCase() : 'No pick yet');
  main.appendChild(el('div', 'player-sub', sub));
  main.appendChild(el('div', 'loading-inline', 'Scouting…'));
  card.appendChild(main);
  return card;
}

function fillPlayerCard(card, dossier) {
  const main = card.querySelector('.player-main');
  main.innerHTML = '';
  main.appendChild(el('div', 'player-name', dossier.riotId));
  main.appendChild(el('div', 'player-sub', card.dataset.champLabel || ''));

  const rankLine = el('div', 'rank-line');
  rankLine.appendChild(rankBadge(dossier.solo));
  if (dossier.recent.length) rankLine.appendChild(wlDots(dossier.recent));
  main.appendChild(rankLine);

  if (dossier.masteries.length) {
    const line = el('div', 'rank-line');
    line.appendChild(el('span', 'muted', 'Mains:'));
    const icons = el('span', 'mastery-icons');
    for (const m of dossier.masteries) {
      const img = champImg(m.championId, '');
      img.title = `${DD.champName(m.championId)} — ${fmtPoints(m.points)} pts`;
      icons.appendChild(img);
    }
    line.appendChild(icons);
    main.appendChild(line);
  }

  if (dossier.tags.length) {
    const tags = el('div', 'tag-row');
    for (const t of dossier.tags) tags.appendChild(el('span', `tag ${t.tone}`, t.label));
    main.appendChild(tags);
  }
}

function failPlayerCard(card, message) {
  const loading = card.querySelector('.loading-inline');
  if (loading) loading.textContent = message;
}

let scouting = false;
async function scoutGame() {
  if (scouting) return;
  scouting = true;
  const status = $('#liveStatus');
  const board = $('#liveBoard');
  $('#scoutBtn').disabled = true;
  status.classList.remove('hidden', 'error');
  status.textContent = 'Looking for a live game…';
  try {
    const spectateId = $('#spectateInput').value.trim();
    const game = await api(`/api/scout${spectateId ? `?riotId=${encodeURIComponent(spectateId)}` : ''}`);
    const sourceLabels = {
      'local-client': 'your running game',
      champselect: 'champ select',
      lobby: 'your pregame lobby',
      spectator: 'the spectator API'
    };
    status.textContent = `Found ${game.participants.length} player(s) via ${sourceLabels[game.source] || game.source} — scouting…`;
    board.classList.remove('hidden');
    const order = $('#teamOrder');
    const chaos = $('#teamChaos');
    order.innerHTML = '';
    chaos.innerHTML = '';

    // Pregame sources may only know your own side — relabel and collapse.
    const pregame = game.source === 'lobby' || game.source === 'champselect';
    const hasEnemies = game.participants.some((p) => p.team === 'CHAOS');
    order.closest('.team').querySelector('h2').textContent =
      pregame ? (game.source === 'lobby' ? 'Your Lobby' : 'Your Team') : 'Blue Team';
    chaos.closest('.team').querySelector('h2').textContent = pregame ? 'Enemy Team' : 'Red Team';
    chaos.closest('.team').classList.toggle('hidden', !hasEnemies);

    const cards = [];
    for (const p of game.participants) {
      const card = playerCardSkeleton(p);
      card.dataset.champLabel = DD.champName(p.championId ?? p.championName);
      (p.team === 'ORDER' ? order : chaos).appendChild(card);
      cards.push({ p, card });
    }

    // Scout sequentially — keeps us politely inside Riot rate limits.
    let failures = 0;
    for (const { p, card } of cards) {
      if (!p.riotId && !p.puuid) {
        failPlayerCard(card, 'Name hidden — cannot scout');
        continue;
      }
      try {
        const params = new URLSearchParams();
        if (p.puuid) params.set('puuid', p.puuid);
        else params.set('riotId', p.riotId);
        const champ = DD.champ(p.championId ?? p.championName);
        if (champ) {
          const key = [...DD.champByKey.entries()].find(([, v]) => v === champ)?.[0];
          if (key) params.set('championId', key);
        }
        const dossier = await api(`/api/scout/player?${params}`);
        fillPlayerCard(card, dossier);
      } catch (err) {
        failures += 1;
        failPlayerCard(card, err.message);
      }
    }
    status.textContent = failures
      ? `Scouting done — ${failures} player(s) could not be fully scouted.`
      : 'Scouting complete.';
  } catch (err) {
    board.classList.add('hidden');
    status.classList.add('error');
    status.textContent = err.message;
  } finally {
    scouting = false;
    $('#scoutBtn').disabled = false;
  }
}

$('#scoutBtn').addEventListener('click', scoutGame);
$('#spectateInput').addEventListener('keydown', (e) => e.key === 'Enter' && scoutGame());

/* ---------------------------------------------------------- summoner view */
let currentProfile = null;
let matchOffset = 0;

function renderProfile(data) {
  const card = $('#profileCard');
  card.innerHTML = '';
  const icon = el('img', 'profile-icon');
  icon.src = DD.profileIcon(data.profileIconId);
  icon.alt = '';
  card.appendChild(icon);
  const idBox = el('div');
  idBox.appendChild(el('div', 'profile-name', data.riotId));
  idBox.appendChild(el('div', 'profile-level', `Level ${data.summonerLevel}`));
  card.appendChild(idBox);

  const ranks = el('div', 'rank-cards');
  const queueLabels = { RANKED_SOLO_5x5: 'Ranked Solo/Duo', RANKED_FLEX_SR: 'Ranked Flex' };
  for (const q of ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']) {
    const entry = data.entries.find((e) => e.queueType === q);
    const rc = el('div', 'rank-card');
    rc.appendChild(el('div', 'q', queueLabels[q]));
    if (entry) {
      const total = entry.wins + entry.losses;
      rc.appendChild(el('div', `t tier-${entry.tier}`, `${entry.tier} ${entry.rank} · ${entry.leaguePoints} LP`));
      rc.appendChild(el('div', 's', `${entry.wins}W ${entry.losses}L (${total ? Math.round((100 * entry.wins) / total) : 0}%)`));
    } else {
      rc.appendChild(el('div', 't', 'Unranked'));
    }
    ranks.appendChild(rc);
  }
  card.appendChild(ranks);
}

function matchRow(m) {
  const row = el('div', `match-row ${m.remake ? 'remake' : m.win ? 'win' : 'loss'}`);
  row.appendChild(champImg(m.championId, 'match-champ'));

  const meta = el('div', 'match-meta');
  meta.appendChild(el('div', 'q', `${m.queue} · ${timeAgo(m.gameCreation)}`));
  meta.appendChild(el('div', 'res', m.remake ? 'Remake' : m.win ? 'Victory' : 'Defeat'));
  meta.appendChild(el('div', 'q', `${Math.floor(m.gameDuration / 60)}:${String(m.gameDuration % 60).padStart(2, '0')}`));
  row.appendChild(meta);

  const kda = el('div', 'match-kda');
  kda.appendChild(el('div', 'k', `${m.kills} / ${m.deaths} / ${m.assists}`));
  kda.appendChild(el('div', 'ratio', `${m.kda.toFixed(2)} KDA`));
  row.appendChild(kda);

  const stats = el('div', 'match-stats');
  stats.appendChild(el('div', '', `${m.cs} CS (${m.csPerMin.toFixed(1)}/m)`));
  stats.appendChild(el('div', '', `${fmtPoints(m.damage)} dmg`));
  row.appendChild(stats);

  const items = el('div', 'match-items');
  for (const it of m.items.slice(0, 7)) {
    if (it) {
      const img = el('img');
      img.src = DD.itemIcon(it);
      img.loading = 'lazy';
      img.alt = '';
      items.appendChild(img);
    } else {
      items.appendChild(el('span', 'item-empty'));
    }
  }
  row.appendChild(items);
  return row;
}

function renderMastery(masteries) {
  const list = $('#masteryList');
  list.innerHTML = '';
  for (const m of masteries) {
    const row = el('div', 'mastery-row');
    row.appendChild(champImg(m.championId, ''));
    row.appendChild(el('span', 'n', DD.champName(m.championId)));
    row.appendChild(el('span', 'p', `Lv ${m.championLevel ?? m.level} · ${fmtPoints(m.championPoints ?? m.points)} pts`));
    list.appendChild(row);
  }
}

async function searchSummoner(reset = true) {
  const status = $('#summonerStatus');
  const riotId = $('#searchInput').value.trim();
  if (!riotId.includes('#')) {
    status.classList.remove('hidden');
    status.classList.add('error');
    status.textContent = 'Enter a full Riot ID like GameName#TAG';
    return;
  }
  const platform = $('#searchPlatform').value || appConfig.platform;
  status.classList.remove('hidden', 'error');
  status.textContent = 'Loading (first lookup fetches each match — takes a few seconds)…';
  $('#searchBtn').disabled = true;
  try {
    if (reset) matchOffset = 0;
    const data = await api(
      `/api/summoner?riotId=${encodeURIComponent(riotId)}&platform=${platform}&count=10&start=${matchOffset}`
    );
    currentProfile = data;
    matchOffset += data.matches.length;
    status.classList.add('hidden');
    $('#summonerResult').classList.remove('hidden');
    if (reset) {
      renderProfile(data);
      renderMastery(data.masteries);
      $('#matchList').innerHTML = '';
    }
    for (const m of data.matches) $('#matchList').appendChild(matchRow(m));
    $('#moreMatches').classList.toggle('hidden', data.matches.length === 0);
  } catch (err) {
    status.classList.remove('hidden');
    status.classList.add('error');
    status.textContent = err.message;
  } finally {
    $('#searchBtn').disabled = false;
  }
}

$('#searchBtn').addEventListener('click', () => searchSummoner(true));
$('#searchInput').addEventListener('keydown', (e) => e.key === 'Enter' && searchSummoner(true));
$('#moreMatches').addEventListener('click', () => searchSummoner(false));

/* -------------------------------------------------------------- recs view */
let recsData = null;

function renderRecs() {
  const list = $('#recsList');
  list.innerHTML = '';
  if (!recsData) return;
  const role = $('#recsRole').value;
  const filtered = role ? recsData.recs.filter((r) => r.roles.includes(role)) : recsData.recs;
  if (!filtered.length) {
    list.appendChild(el('div', 'notice', 'No data for this role yet — play a few games there and re-analyze.'));
    return;
  }
  const topScore = filtered[0].score || 1;
  filtered.forEach((r, i) => {
    const row = el('div', 'rec-row');
    row.appendChild(el('div', 'rec-rank', `#${i + 1}`));
    row.appendChild(champImg(r.championId, ''));
    const nameBox = el('div');
    nameBox.appendChild(el('div', 'rec-name', DD.champName(r.championId)));
    if (r.roles.length) nameBox.appendChild(el('div', 'rec-roles', r.roles.join(' · ')));
    row.appendChild(nameBox);
    const barWrap = el('div', 'rec-bar-wrap');
    const bar = el('div', 'rec-bar');
    bar.style.width = `${Math.max(4, Math.round((r.score / topScore) * 100))}%`;
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
    const stats = el('div', 'rec-stats');
    const statHtml = (label, value) => {
      const span = el('span');
      span.append(label + ' ');
      const b = el('b', '', value);
      span.appendChild(b);
      return span;
    };
    stats.appendChild(statHtml('Score', String(r.score)));
    stats.appendChild(statHtml('WR', r.winrate != null ? `${r.winrate}% (${r.games}g)` : '—'));
    stats.appendChild(statHtml('KDA', r.avgKda != null ? String(r.avgKda) : '—'));
    stats.appendChild(statHtml('Mastery', fmtPoints(r.masteryPoints)));
    row.appendChild(stats);
    list.appendChild(row);
  });
}

async function loadRecs() {
  const status = $('#recsStatus');
  status.classList.remove('hidden', 'error');
  status.textContent = 'Analyzing your last 30 games (first run takes ~30s due to rate limits)…';
  $('#recsBtn').disabled = true;
  try {
    recsData = await api('/api/recommendations');
    status.textContent = `Analyzed ${recsData.sampleSize} recent games for ${recsData.riotId}.`;
    renderRecs();
  } catch (err) {
    status.classList.add('error');
    status.textContent = err.message;
  } finally {
    $('#recsBtn').disabled = false;
  }
}

$('#recsBtn').addEventListener('click', loadRecs);
$('#recsRole').addEventListener('change', renderRecs);

/* ---------------------------------------------------------- settings view */
async function loadSettings() {
  const cfg = await api('/api/config');
  appConfig = { ...appConfig, ...cfg };
  $('#cfgRiotId').value = cfg.riotId || '';
  $('#cfgLeaguePath').value = cfg.leaguePath || '';
  $('#cfgKey').placeholder = cfg.hasApiKey ? '•••••••• (key saved — paste to replace)' : 'RGAPI-xxxxxxxx-…';
  if ($('#cfgPlatform').options.length) $('#cfgPlatform').value = cfg.platform;
}

$('#saveCfg').addEventListener('click', async () => {
  const body = {
    platform: $('#cfgPlatform').value,
    riotId: $('#cfgRiotId').value,
    leaguePath: $('#cfgLeaguePath').value
  };
  if ($('#cfgKey').value.trim()) body.riotApiKey = $('#cfgKey').value.trim();
  const res = await fetch('/api/config', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) {
    $('#cfgKey').value = '';
    $('#cfgSaved').classList.remove('hidden');
    setTimeout(() => $('#cfgSaved').classList.add('hidden'), 2500);
    await refreshStatus();
    await loadSettings();
  }
});

/* ------------------------------------------------------------------ boot */
(async function boot() {
  await DD.init();
  await refreshStatus();
  await loadSettings();
  setInterval(refreshStatus, 15_000);

  // Kick off an initial check — if you're already in a lobby, champ select,
  // or game, scout it immediately.
  try {
    await api('/api/scout');
    if (appConfig.hasApiKey) {
      scoutGame();
    } else {
      $('#liveStatus').textContent =
        'Game or lobby detected — add your Riot API key in Settings to scout it.';
    }
  } catch (err) {
    $('#liveStatus').textContent = appConfig.hasApiKey
      ? 'Nothing to scout yet. Join a lobby, queue up, or enter a Riot ID to spectate, then hit Scout.'
      : 'Welcome! Add your free Riot API key in Settings to unlock scouting and lookups.';
  }
})();
