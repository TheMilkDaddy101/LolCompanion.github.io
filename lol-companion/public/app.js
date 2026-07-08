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
  },

  // ---- lazily loaded static data for the Builds tab ----
  items: null,        // id -> { name }
  perks: null,        // perkId -> { name, icon }  (styles + runes)
  spellsByKey: null,  // numeric key -> { id, name }
  shardNames: {
    5001: 'Health Scaling', 5002: 'Armor', 5003: 'Magic Resist', 5005: 'Attack Speed',
    5007: 'Ability Haste', 5008: 'Adaptive Force', 5010: 'Move Speed',
    5011: 'Health', 5013: 'Tenacity & Slow Resist'
  },

  async loadStatics() {
    if (this.items || !this.version) return;
    const base = `https://ddragon.leagueoflegends.com/cdn/${this.version}/data/en_US`;
    const [items, runes, spells] = await Promise.all([
      fetch(`${base}/item.json`).then((r) => r.json()),
      fetch(`${base}/runesReforged.json`).then((r) => r.json()),
      fetch(`${base}/summoner.json`).then((r) => r.json())
    ]);
    this.items = items.data;
    this.perks = new Map();
    for (const style of runes) {
      this.perks.set(style.id, { name: style.name, icon: style.icon });
      for (const slot of style.slots) {
        for (const rune of slot.runes) this.perks.set(rune.id, { name: rune.name, icon: rune.icon });
      }
    }
    this.spellsByKey = new Map();
    for (const s of Object.values(spells.data)) this.spellsByKey.set(Number(s.key), { id: s.id, name: s.name });
  },

  itemName(id) { return this.items?.[id]?.name || `Item ${id}`; },
  perkInfo(id) { return this.perks?.get(Number(id)) || null; },
  perkIcon(id) {
    const p = this.perkInfo(id);
    return p ? `https://ddragon.leagueoflegends.com/cdn/img/${p.icon}` : '';
  },
  spellInfo(key) { return this.spellsByKey?.get(Number(key)) || null; },
  spellIcon(key) {
    const s = this.spellInfo(key);
    return s && this.version
      ? `https://ddragon.leagueoflegends.com/cdn/${this.version}/img/spell/${s.id}.png`
      : '';
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
let liveQueueHint = 'ranked_solo';

function playerCardSkeleton(p) {
  const card = el('div', 'player-card');
  const champ = p.championId ?? p.championName ?? null;
  const portrait = portraitEl(champ);
  if (champ != null && DD.champ(champ)) {
    portrait.classList.add('clickable');
    portrait.title = `${DD.champName(champ)} — click for build & matchups`;
    portrait.addEventListener('click', () => openBuildFor(champ, liveQueueHint));
  }
  card.appendChild(portrait);
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
    const mode = (game.gameMode || '').toUpperCase();
    liveQueueHint = mode.includes('ARAM') ? 'aram' : mode.includes('CHERRY') || mode.includes('ARENA') ? 'arena' : 'ranked_solo';
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

/* -------------------------------------------------------------- builds view */
function switchView(name) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${name}`).classList.remove('hidden');
}

function fillChampDatalist() {
  const dl = $('#champList');
  if (dl.options.length) return;
  const names = [...new Set([...DD.champByKey.values()].map((c) => c.name))].sort();
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    dl.appendChild(opt);
  }
}

// Jump to the Builds tab pre-loaded — used by Live-tab portrait clicks.
function openBuildFor(championIdOrName, queueHint) {
  const champ = DD.champ(championIdOrName);
  if (!champ) return;
  switchView('builds');
  fillChampDatalist();
  $('#buildChamp').value = champ.name;
  if (queueHint) $('#buildQueue').value = queueHint;
  loadBuild();
}

function iconRow(entries) {
  const row = el('div', 'icon-row');
  for (const { src, label, sub, dim } of entries) {
    const cell = el('div', `icon-cell${dim ? ' dim' : ''}`);
    if (src) {
      const img = el('img');
      img.src = src;
      img.alt = label || '';
      img.title = label || '';
      img.loading = 'lazy';
      cell.appendChild(img);
    }
    if (label) cell.appendChild(el('div', 'icon-label', label));
    if (sub) cell.appendChild(el('div', 'icon-sub', sub));
    row.appendChild(cell);
  }
  return row;
}

function renderBuild(data) {
  const champ = DD.champ($('#buildChamp').value);
  // summary strip
  const sum = $('#buildSummary');
  sum.innerHTML = '';
  if (champ) sum.appendChild(champImg(champ.name, 'build-champ'));
  const head = el('div');
  head.appendChild(el('div', 'build-title', `${champ ? champ.name : '?'} — ${data.role === 'NONE' ? data.queue.replace(/_/g, ' ') : data.role}`));
  const bits = [];
  if (data.stats?.winrate != null) bits.push(`${data.stats.winrate}% WR`);
  if (data.stats?.matches) bits.push(`${data.stats.matches.toLocaleString()} games`);
  bits.push(`patch ${data.patch.replace('_', '.')}`);
  head.appendChild(el('div', 'muted', bits.join(' · ')));
  if (data.availableRoles?.length > 1) {
    head.appendChild(el('div', 'icon-sub', `Roles with data: ${data.availableRoles.join(', ')}`));
  }
  sum.appendChild(head);

  // runes
  const runes = $('#runesCard .card-body');
  runes.innerHTML = '';
  if (data.runes?.perks?.length) {
    const styleName = (id) => DD.perkInfo(id)?.name || '';
    if (data.runes.primaryStyle) runes.appendChild(el('div', 'sub-h', `Primary: ${styleName(data.runes.primaryStyle)}`));
    runes.appendChild(iconRow(data.runes.perks.slice(0, 4).map((id) => ({ src: DD.perkIcon(id), label: DD.perkInfo(id)?.name || id }))));
    if (data.runes.subStyle) runes.appendChild(el('div', 'sub-h', `Secondary: ${styleName(data.runes.subStyle)}`));
    runes.appendChild(iconRow(data.runes.perks.slice(4, 6).map((id) => ({ src: DD.perkIcon(id), label: DD.perkInfo(id)?.name || id }))));
    if (data.shards?.length) {
      const chips = el('div', 'tag-row');
      for (const s of data.shards) chips.appendChild(el('span', 'tag', DD.shardNames[s] || `Shard ${s}`));
      runes.appendChild(el('div', 'sub-h', 'Shards'));
      runes.appendChild(chips);
    }
  } else {
    runes.appendChild(el('div', 'muted', 'No rune data for this queue.'));
  }

  // items
  const items = $('#itemsCard .card-body');
  items.innerHTML = '';
  const itemEntries = (ids) => (ids || []).map((id) => ({ src: DD.itemIcon(id), label: DD.itemName(id) }));
  if (data.startItems?.length) {
    items.appendChild(el('div', 'sub-h', 'Start'));
    items.appendChild(iconRow(itemEntries(data.startItems)));
  }
  if (data.coreItems?.length) {
    items.appendChild(el('div', 'sub-h', 'Core'));
    items.appendChild(iconRow(itemEntries(data.coreItems)));
  }
  (data.itemOptions || []).forEach((slot, i) => {
    if (!slot?.length) return;
    items.appendChild(el('div', 'sub-h', `${i + 4}th item options`));
    items.appendChild(iconRow(slot.map((it) => ({
      src: DD.itemIcon(it.id), label: DD.itemName(it.id),
      sub: it.winrate != null ? `${it.winrate}%` : ''
    }))));
  });
  if (!items.children.length) items.appendChild(el('div', 'muted', 'No item data.'));

  // skills + spells
  const skills = $('#skillsCard .card-body');
  skills.innerHTML = '';
  if (data.spells?.length) {
    skills.appendChild(el('div', 'sub-h', 'Summoner spells'));
    skills.appendChild(iconRow(data.spells.map((k) => ({ src: DD.spellIcon(k), label: DD.spellInfo(k)?.name || `Spell ${k}` }))));
  }
  if (data.skills?.priority) {
    skills.appendChild(el('div', 'sub-h', 'Skill priority'));
    skills.appendChild(el('div', 'skill-priority', data.skills.priority));
  }
  if (data.skills?.order?.length) {
    skills.appendChild(el('div', 'sub-h', 'First levels'));
    const seq = el('div', 'skill-seq');
    data.skills.order.forEach((k, i) => {
      const box = el('span', `skill-box skill-${k}`, k);
      box.title = `Level ${i + 1}`;
      seq.appendChild(box);
    });
    skills.appendChild(seq);
  }
  if (!skills.children.length) skills.appendChild(el('div', 'muted', 'No skill data.'));
}

function renderMatchups(data) {
  const body = $('#matchupsCard .card-body');
  body.innerHTML = '';
  const rows = data?.matchups || [];
  if (!rows.length) {
    body.appendChild(el('div', 'muted', 'No matchup data for this queue.'));
    return;
  }
  const section = (title, list, tone) => {
    body.appendChild(el('div', 'sub-h', title));
    for (const m of list) {
      const row = el('div', 'matchup-row');
      row.appendChild(champImg(m.championId, 'matchup-icon'));
      row.appendChild(el('span', 'matchup-name', DD.champName(m.championId)));
      row.appendChild(el('span', `matchup-wr ${tone}`, `${m.winrate}% WR`));
      row.appendChild(el('span', 'icon-sub', `${m.matches.toLocaleString()}g`));
      body.appendChild(row);
    }
  };
  // winrate here = OUR champ's winrate vs that enemy; never show the same
  // matchup in both lists when the sample is small
  const half = Math.max(1, Math.min(5, Math.floor(rows.length / 2)));
  section('Toughest counters', rows.slice(0, half), 'bad');
  if (rows.length > 1) section('Best targets', rows.slice(-half).reverse(), 'good');
}

async function loadBuild() {
  const status = $('#buildStatus');
  const champ = DD.champ($('#buildChamp').value);
  if (!champ) {
    status.classList.remove('hidden');
    status.classList.add('error');
    status.textContent = 'Pick a champion first.';
    return;
  }
  const key = [...DD.champByKey.entries()].find(([, v]) => v === champ)?.[0];
  const queue = $('#buildQueue').value;
  const role = queue === 'aram' || queue === 'arena' ? '' : $('#buildRole').value;
  status.classList.remove('hidden', 'error');
  status.textContent = 'Fetching current meta data…';
  $('#buildBtn').disabled = true;
  try {
    await DD.loadStatics();
    const params = `championId=${key}&queue=${queue}${role ? `&role=${role}` : ''}`;
    const build = await api(`/api/meta/build?${params}`);
    renderBuild(build);
    $('#buildResult').classList.remove('hidden');
    status.classList.add('hidden');
    try {
      renderMatchups(await api(`/api/meta/matchups?${params}`));
    } catch (err) {
      $('#matchupsCard .card-body').innerHTML = '';
      $('#matchupsCard .card-body').appendChild(el('div', 'muted', err.message));
    }
  } catch (err) {
    status.classList.remove('hidden');
    status.classList.add('error');
    status.textContent = err.message;
    $('#buildResult').classList.add('hidden');
  } finally {
    $('#buildBtn').disabled = false;
  }
}

$('#buildBtn').addEventListener('click', loadBuild);
$('#buildChamp').addEventListener('keydown', (e) => e.key === 'Enter' && loadBuild());
$('#buildQueue').addEventListener('change', () => {
  const q = $('#buildQueue').value;
  $('#buildRole').classList.toggle('hidden', q === 'aram' || q === 'arena');
});

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
  fillChampDatalist();
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
