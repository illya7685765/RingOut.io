const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let state = null;
let myId = null;
let joined = false;
let selectedSkin = "green";
let selectedServer = "EU-1";

let camX = 0;
let camY = 0;
let particles = [];
let shockwaves = [];
let floatingTexts = [];
let screenShake = 0;
let lastAlive = true;
let prevMe = null;
let localStreakBanner = null;
let localStreakBannerUntil = 0;
let killFeedTimes = {};
let lastKillFeedSig = "";
let eventPulse = 0;
let menuConnected = false;

let predictedPos = { x: 0, y: 0, vx: 0, vy: 0 };
let lastServerPos = { x: 0, y: 0 };
let playerInterpolation = new Map();

const skinList = ["green", "fire", "ice", "toxic", "shadow", "gold", "neon"];
const skinUnlockKills = { green: 0, fire: 3, ice: 7, toxic: 12, shadow: 20, gold: 35, neon: 9999 };
const skinLabels = {
  green: "GREEN",
  fire: "FIRE",
  ice: "ICE",
  toxic: "TOXIC",
  shadow: "SHADOW",
  gold: "GOLD",
  neon: "NEON",
};
let skinIndex = 0;

const keys = { up: false, down: false, left: false, right: false, dash: false };

const UI = {
  font: '"Rajdhani", Arial, sans-serif',
  fontDisplay: '"Orbitron", Arial, sans-serif',
  panel: "rgba(8, 6, 22, 0.78)",
  panelBorder: "rgba(168, 85, 247, 0.45)",
  cyan: "#22d3ee",
  blue: "#38bdf8",
  purple: "#a855f7",
  violet: "#7c3aed",
  text: "#e2e8f0",
  dim: "#94a3b8",
};

const RANK_COLORS = {
  Bronze: "#cd7f32",
  Silver: "#c0c0c0",
  Gold: "#facc15",
  Diamond: "#67e8f9",
  Master: "#a855f7",
  Legend: "#f472b6",
};

const STORAGE_KEYS = {
  stats: "ringout_stats",
  quests: "ringout_quests",
  playerId: "ringout_player_id",
  pendingRef: "ringout_pending_ref",
  inviteRewards: "ringout_invite_rewards",
};

let inviteCount = 0;
let inviteRewards = loadInviteRewards();

function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.stats)) || {
      totalKills: 0,
      bestMass: 0,
      highestLevel: 1,
      totalGames: 0,
    };
  } catch {
    return { totalKills: 0, bestMass: 0, highestLevel: 1, totalGames: 0 };
  }
}

function saveStats(stats) {
  localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function defaultQuests() {
  return { date: todayKey(), food: 0, kills: 0, events: 0 };
}

function loadQuests() {
  try {
    const q = JSON.parse(localStorage.getItem(STORAGE_KEYS.quests));
    if (!q || q.date !== todayKey()) return defaultQuests();
    return q;
  } catch {
    return defaultQuests();
  }
}

function saveQuests(q) {
  localStorage.setItem(STORAGE_KEYS.quests, JSON.stringify(q));
}

let playerStats = loadStats();
let dailyQuests = loadQuests();

function getPersistentPlayerId() {
  let id = localStorage.getItem(STORAGE_KEYS.playerId);
  if (!id) {
    id = "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(STORAGE_KEYS.playerId, id);
  }
  return id;
}

function loadInviteRewards() {
  try {
    return (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.inviteRewards)) || {
        claimedTiers: [],
        bonusXp: 0,
        neonSkin: false,
        founderTitle: false,
      }
    );
  } catch {
    return { claimedTiers: [], bonusXp: 0, neonSkin: false, founderTitle: false };
  }
}

function saveInviteRewards() {
  localStorage.setItem(STORAGE_KEYS.inviteRewards, JSON.stringify(inviteRewards));
}

function captureReferralFromUrl() {
  const params = new URLSearchParams(location.search);
  const ref = (params.get("ref") || "").trim().slice(0, 64);
  if (!ref) return;
  const selfId = getPersistentPlayerId();
  if (ref !== selfId) {
    localStorage.setItem(STORAGE_KEYS.pendingRef, ref);
  }
  const url = new URL(location.href);
  url.searchParams.delete("ref");
  const clean = url.pathname + (url.search || "") + url.hash;
  history.replaceState({}, "", clean);
}

function getInviteShareUrl() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("ref", getPersistentPlayerId());
  return url.toString();
}

async function fetchInviteCount() {
  const id = getPersistentPlayerId();
  try {
    const res = await fetch(`/api/referral/count/${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      inviteCount = Math.max(0, data.count || 0);
      return;
    }
  } catch (e) {}
  inviteCount = 0;
}

function applyInviteRewards(count) {
  const tiers = [
    { n: 1, xp: 100 },
    { n: 3, neon: true },
    { n: 5, xp: 500 },
    { n: 10, founder: true },
  ];
  let changed = false;

  for (const tier of tiers) {
    if (count < tier.n || inviteRewards.claimedTiers.includes(tier.n)) continue;
    inviteRewards.claimedTiers.push(tier.n);
    if (tier.xp) inviteRewards.bonusXp += tier.xp;
    if (tier.neon) inviteRewards.neonSkin = true;
    if (tier.founder) inviteRewards.founderTitle = true;
    changed = true;
    if (tier.founder) showToast("Legend Founder title unlocked!");
    else if (tier.neon) showToast("Neon skin unlocked!");
    else if (tier.xp) showToast(`+${tier.xp} XP reward unlocked!`);
  }

  if (changed) saveInviteRewards();
}

function updateInviteUI() {
  const el = id => document.getElementById(id);
  if (el("statInvited")) el("statInvited").textContent = String(inviteCount);
  if (el("statBonusXp")) el("statBonusXp").textContent = String(inviteRewards.bonusXp || 0);

  document.querySelectorAll(".invite-milestone").forEach(node => {
    const tier = Number(node.dataset.tier);
    node.classList.toggle("is-done", inviteCount >= tier);
  });

  const founderRow = el("founderTitleRow");
  if (founderRow) founderRow.hidden = !inviteRewards.founderTitle;
}

async function refreshInviteStats() {
  await fetchInviteCount();
  applyInviteRewards(inviteCount);
  updateInviteUI();
  updateSkinPreview();
}

async function registerReferralJoin() {
  const referrerId = localStorage.getItem(STORAGE_KEYS.pendingRef);
  if (!referrerId) return;

  const guestId = getPersistentPlayerId();
  if (!referrerId || referrerId === guestId) return;

  const doneKey = `ringout_ref_done_${referrerId}_${guestId}`;
  if (localStorage.getItem(doneKey)) return;

  try {
    const res = await fetch("/api/referral/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrerId, guestId }),
    });
    if (res.ok) {
      localStorage.setItem(doneKey, "1");
      localStorage.removeItem(STORAGE_KEYS.pendingRef);
    }
  } catch (e) {}
}

function showToast(message) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  stack.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("is-visible"));
  });

  setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 280);
  }, 2400);
}

function openInviteModal() {
  const modal = document.getElementById("inviteModal");
  const urlEl = document.getElementById("inviteUrl");
  if (!modal) return;
  if (urlEl) urlEl.textContent = getInviteShareUrl();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeInviteModal() {
  const modal = document.getElementById("inviteModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

async function copyInviteLink() {
  const link = getInviteShareUrl();
  try {
    await navigator.clipboard.writeText(link);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = link;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  showToast("Invite link copied!");
}

function setupInviteSystem() {
  captureReferralFromUrl();

  const inviteBtn = document.getElementById("inviteBtn");
  const copyBtn = document.getElementById("inviteCopyBtn");
  const closeBtn = document.getElementById("inviteCloseBtn");
  const backdrop = document.getElementById("inviteModalBackdrop");

  if (inviteBtn) inviteBtn.addEventListener("click", openInviteModal);
  if (copyBtn) copyBtn.addEventListener("click", copyInviteLink);
  if (closeBtn) closeBtn.addEventListener("click", closeInviteModal);
  if (backdrop) backdrop.addEventListener("click", closeInviteModal);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeInviteModal();
  });

  refreshInviteStats();

  setInterval(() => {
    if (!joined) refreshInviteStats();
  }, 20000);
}

function isSkinUnlocked(skin) {
  if (skin === "neon") return inviteRewards.neonSkin || inviteCount >= 3;
  return playerStats.totalKills >= (skinUnlockKills[skin] || 0);
}

function findFirstUnlockedIndex() {
  for (let i = 0; i < skinList.length; i++) {
    if (isSkinUnlocked(skinList[i])) return i;
  }
  return 0;
}

function updateStatsUI() {
  const el = id => document.getElementById(id);
  if (el("statKills")) el("statKills").textContent = playerStats.totalKills;
  if (el("statMass")) el("statMass").textContent = Math.floor(playerStats.bestMass);
  if (el("statLevel")) el("statLevel").textContent = playerStats.highestLevel;
  if (el("statGames")) el("statGames").textContent = playerStats.totalGames;
  updateInviteUI();
}

function updateQuestUI() {
  const el = id => document.getElementById(id);
  if (el("questFood")) el("questFood").textContent = `${Math.min(dailyQuests.food, 50)}/50`;
  if (el("questKills")) el("questKills").textContent = `${Math.min(dailyQuests.kills, 3)}/3`;
  if (el("questEvents")) el("questEvents").textContent = `${Math.min(dailyQuests.events, 2)}/2`;

  const hud = document.getElementById("hudQuests");
  if (hud) {
    hud.innerHTML =
      `Q: ${Math.min(dailyQuests.food, 50)}/50 food · ` +
      `${Math.min(dailyQuests.kills, 3)}/3 KO · ` +
      `${Math.min(dailyQuests.events, 2)}/2 events`;
  }
}

function refreshDailyQuests() {
  if (dailyQuests.date !== todayKey()) dailyQuests = defaultQuests();
  updateQuestUI();
}

function trackMeProgress(me) {
  if (!me || !prevMe) {
    prevMe = me ? { ...me } : null;
    return;
  }

  const foodDelta = me.foodCollected - (prevMe.foodCollected || 0);
  if (foodDelta > 0) {
    dailyQuests.food = Math.min(50, dailyQuests.food + foodDelta);
    saveQuests(dailyQuests);
    addFloatingText(me.x, me.y - me.r - 8, `+${foodDelta} mass`, UI.cyan);
    screenShake = Math.min(6, screenShake + foodDelta * 0.5);
  }

  const killDelta = me.kills - (prevMe.kills || 0);
  if (killDelta > 0) {
    addFloatingText(me.x, me.y - me.r - 24, "RING OUT!", "#f87171");
    screenShake = 14;
    playerStats.totalKills += killDelta;
    dailyQuests.kills = Math.min(3, dailyQuests.kills + killDelta);
    saveStats(playerStats);
    saveQuests(dailyQuests);
  }

  if (me.mass > playerStats.bestMass) {
    playerStats.bestMass = me.mass;
    saveStats(playerStats);
  }

  if ((me.level || 1) > playerStats.highestLevel) {
    playerStats.highestLevel = me.level;
    saveStats(playerStats);
  }

  prevMe = { ...me };
  updateStatsUI();
  updateQuestUI();
}

let lastEventActive = false;
let wasAliveDuringEvent = false;

function trackEventSurvival() {
  const eventActive = !!(state && state.event);
  const me = state && state.players.find(p => p.id === myId);

  if (eventActive && me && me.alive) {
    wasAliveDuringEvent = true;
  }

  if (lastEventActive && !eventActive && wasAliveDuringEvent) {
    dailyQuests.events = Math.min(2, dailyQuests.events + 1);
    saveQuests(dailyQuests);
    updateQuestUI();
    wasAliveDuringEvent = false;
  }

  lastEventActive = eventActive;
}

function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function requestLandscapeMode() {
  if (!isTouchDevice()) return;

  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch (e) {}

  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (e) {}
}

function getSkinColors(skin) {
  if (skin === "fire") return ["#fed7aa", "#ea580c", "#dc2626"];
  if (skin === "ice") return ["#e0f2fe", "#38bdf8", "#2563eb"];
  if (skin === "toxic") return ["#d9f99d", "#84cc16", "#15803d"];
  if (skin === "shadow") return ["#9ca3af", "#1f2937", "#020617"];
  if (skin === "gold") return ["#fef08a", "#facc15", "#ca8a04"];
  if (skin === "neon") return ["#e0f2fe", "#22d3ee", "#a855f7"];
  return ["#86efac", "#22c55e", "#16a34a"];
}

function updateSkinPreview() {
  selectedSkin = skinList[skinIndex];
  const colors = getSkinColors(selectedSkin);
  const bg = `radial-gradient(circle at 35% 28%, ${colors[0]}, ${colors[1]} 55%, ${colors[2]})`;
  const locked = !isSkinUnlocked(selectedSkin);
  const saveBtn = document.getElementById("skinSaveBtn");

  const preview = document.querySelector(".skin-preview");
  const big = document.getElementById("bigSkinBall");
  const nameEl = document.getElementById("skinName");
  const lockEl = document.getElementById("skinLock");

  if (preview) {
    preview.style.background = bg;
    preview.style.opacity = locked ? "0.45" : "1";
  }
  if (big) {
    big.style.background = bg;
    big.style.opacity = locked ? "0.45" : "1";
    big.style.filter = locked ? "grayscale(0.6)" : "none";
  }
  if (nameEl) nameEl.textContent = skinLabels[selectedSkin] || selectedSkin.toUpperCase();
  if (lockEl) {
    if (locked) {
      lockEl.classList.remove("unlocked");
      const need = skinUnlockKills[selectedSkin];
      if (selectedSkin === "neon") {
        lockEl.textContent = `🔒 LOCKED — invite 3 friends (${inviteCount}/3)`;
      } else {
        lockEl.textContent = `🔒 LOCKED — ${need} total kills required (${playerStats.totalKills}/${need})`;
      }
      lockEl.style.display = "block";
    } else {
      lockEl.textContent = "✓ UNLOCKED";
      lockEl.style.display = "block";
      lockEl.classList.add("unlocked");
    }
  }
  if (saveBtn) {
    saveBtn.disabled = locked;
    saveBtn.style.opacity = locked ? "0.55" : "1";
    saveBtn.textContent = locked ? "LOCKED" : "SAVE";
  }
}

function openSkinMenu() {
  refreshDailyQuests();
  document.getElementById("skinMenu").style.display = "block";
  updateSkinPreview();
}

function closeSkinMenu() {
  if (!isSkinUnlocked(selectedSkin)) {
    skinIndex = findFirstUnlockedIndex();
  }
  document.getElementById("skinMenu").style.display = "none";
  updateSkinPreview();
}

function nextSkin() {
  skinIndex = (skinIndex + 1) % skinList.length;
  updateSkinPreview();
  if (!isSkinUnlocked(selectedSkin) && navigator.vibrate) navigator.vibrate(12);
}

function prevSkin() {
  skinIndex = (skinIndex - 1 + skinList.length) % skinList.length;
  updateSkinPreview();
  if (!isSkinUnlocked(selectedSkin) && navigator.vibrate) navigator.vibrate(12);
}

document.querySelectorAll(".server-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".server-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedServer = btn.dataset.server;
    socket.emit("spectate", { serverCode: selectedServer });
  });
});

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
resize();
addEventListener("resize", resize);

function joinGame() {
  refreshDailyQuests();

  if (!isSkinUnlocked(selectedSkin)) {
    selectedSkin = "green";
    skinIndex = findFirstUnlockedIndex();
    updateSkinPreview();
    setMenuStatus("That skin is locked — pick an unlocked skin in CUSTOMIZE");
    return;
  }

  const name = document.getElementById("name").value || "Player";

  playerStats.totalGames++;
  saveStats(playerStats);
  updateStatsUI();

  registerReferralJoin();

  socket.emit("join", {
    name,
    skin: selectedSkin,
    serverCode: selectedServer
  });

  document.getElementById("menu").style.display = "none";
  document.getElementById("skinMenu").style.display = "none";
  document.getElementById("hud").style.display = "block";
  document.getElementById("roomText").textContent = selectedServer;

  joined = true;
  prevMe = null;
  lastEventActive = false;
  wasAliveDuringEvent = false;

  if (isTouchDevice()) {
    document.body.classList.add("playing-mobile");
    requestLandscapeMode();
  }
}

function setMenuStatus(text) {
  const el = document.getElementById("menuStatus");
  if (el) el.textContent = text;
}

socket.on("connect", () => {
  myId = socket.id;
  menuConnected = true;
  setMenuStatus("Arena online — pick a server and jump in");
  socket.emit("spectate", { serverCode: selectedServer });
  if (!joined) refreshInviteStats();
});

socket.on("disconnect", () => {
  menuConnected = false;
  setMenuStatus("Reconnecting to arena…");
});

function showStreakBanner(text) {
  localStreakBanner = text;
  localStreakBannerUntil = Date.now() + 2000;

  const el = document.getElementById("streakBanner");
  if (el) {
    el.textContent = text;
    el.classList.remove("hidden");
    el.classList.remove("streak-pop");
    void el.offsetWidth;
    el.classList.add("streak-pop");
  }
}

socket.on("state", s => {
  const normalizedState = {
    players: s.p.map(p => ({
      id: p.i,
      name: p.n,
      skin: p.s,
      x: p.x,
      y: p.y,
      r: p.r,
      mass: p.m,
      kills: p.k,
      alive: p.a,
      level: p.l,
      rank: p.rk,
      xp: p.xp,
      dangerTimeLeft: p.d,
      streakBanner: p.sb,
      streakBannerUntil: p.sbu
    })),
    foods: s.f,
    arena: s.ar,
    arenaRadius: s.arr,
    killFeed: s.kf,
    event: s.ev,
    eventMessage: s.em,
    eventTimer: s.et,
    megaWarning: s.mw,
    meteors: s.met,
    hitEffects: s.he,
    online: s.on,
    servers: s.srv
  };

  state = normalizedState;
  eventPulse += 0.08;

  if (s.he && s.he.length) {
    for (const hit of s.he) {
      const power = hit.power || 4;
      makeShockwave(hit.x, hit.y, power);
      if (hit.victimId === myId) {
        screenShake = Math.min(22, screenShake + power * 1.4);
      } else if (joined) {
        screenShake = Math.min(12, screenShake + power * 0.35);
      }
    }
  }

  if (screenShake > 0) screenShake *= 0.82;

  syncKillFeedTimes(s.kf);
  updateServerButtons();
  updateMenuStatusFromState();
  trackEventSurvival();

  const me = state.players.find(p => p.id === myId);

  if (me) {
    if (me.streakBanner && (!prevMe || prevMe.streakBanner !== me.streakBanner)) {
      showStreakBanner(me.streakBanner);
    }

    const hudXp = document.getElementById("hudXp");
    if (hudXp) {
      const rank = me.rank || "Bronze";
      const rankColor = RANK_COLORS[rank] || UI.cyan;
      hudXp.innerHTML =
        `LV <b>${me.level || 1}</b> · ` +
        `<span style="color:${rankColor}">${rank}</span> · ` +
        `${Math.floor(me.xp || 0)} XP`;
    }

    trackMeProgress(me);

    if (lastAlive && !me.alive) {
      makeExplosion(me.x, me.y);
      screenShake = 16;
    }
    lastAlive = me.alive;

    lastServerPos = { x: me.x, y: me.y };
    predictedPos = { x: me.x, y: me.y, vx: 0, vy: 0 };
  }

  for (const p of state.players) {
    if (p.id === myId) continue;
    const interp = playerInterpolation.get(p.id) || { prevX: p.x, prevY: p.y, targetX: p.x, targetY: p.y, t: 1 };
    interp.prevX = interp.targetX;
    interp.prevY = interp.targetY;
    interp.targetX = p.x;
    interp.targetY = p.y;
    interp.t = 0;
    playerInterpolation.set(p.id, interp);
  }
});

function syncKillFeedTimes(feed) {
  const list = feed || [];
  const sig = list.join("\n");
  const now = Date.now();

  if (sig !== lastKillFeedSig) {
    list.forEach((text, i) => {
      const key = `${i}|${text}`;
      if (!killFeedTimes[key]) killFeedTimes[key] = now;
    });
    lastKillFeedSig = sig;
  }

  for (const key of Object.keys(killFeedTimes)) {
    if (now - killFeedTimes[key] > 4000) delete killFeedTimes[key];
  }
}

function updateMenuStatusFromState() {
  if (joined || !state) return;
  const online = state.online || 0;
  if (!menuConnected) return;
  if (online === 0) {
    setMenuStatus("Arena empty — be the first fighter in the ring");
  } else if (online === 1) {
    setMenuStatus("1 player in ring — jump in or watch the fight");
  } else {
    setMenuStatus(`${online} players fighting — ENTER RING to join`);
  }
}

function drawEventArrow() {
  if (!state || !state.event || state.event.x == null) return;

  const me = state.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  const dx = state.event.x - me.x;
  const dy = state.event.y - me.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 120) return;

  const angle = Math.atan2(dy, dx);
  const mobile = isTouchDevice();
  const margin = 52;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = Math.min(cx, cy) - margin - (mobile ? 40 : 0);
  const edge = Math.min(maxR, 95 + dist * 0.02);
  const x = cx + Math.cos(angle) * edge;
  const y = cy + Math.sin(angle) * edge;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = UI.cyan;
  ctx.shadowColor = UI.purple;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(-14, 14);
  ctx.lineTo(14, 14);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function updateServerButtons() {
  if (!state || !state.servers) return;

  for (const server of state.servers) {
    const btn = document.querySelector(`.server-btn[data-server="${server.code}"]`);
    if (!btn) continue;
    const span = btn.querySelector("span");
    if (span) span.textContent = server.online;
  }
}

addEventListener("keydown", e => {
  if (e.code === "KeyW") keys.up = true;
  if (e.code === "KeyS") keys.down = true;
  if (e.code === "KeyA") keys.left = true;
  if (e.code === "KeyD") keys.right = true;
  if (e.code === "Space") keys.dash = true;
});

addEventListener("keyup", e => {
  if (e.code === "KeyW") keys.up = false;
  if (e.code === "KeyS") keys.down = false;
  if (e.code === "KeyA") keys.left = false;
  if (e.code === "KeyD") keys.right = false;
  if (e.code === "Space") keys.dash = false;
});

const INPUT_RATE = 15;
setInterval(() => {
  if (joined) {
    socket.emit("input", keys);
    updateClientPrediction();
  }
}, 1000 / INPUT_RATE);

function updateClientPrediction() {
  if (!state) return;
  const me = state.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  let speed = Math.max(0.2, 5.2 - me.mass * 0.015);
  let ax = 0;
  let ay = 0;

  if (keys.up) ay -= 1;
  if (keys.down) ay += 1;
  if (keys.left) ax -= 1;
  if (keys.right) ax += 1;

  const len = Math.hypot(ax, ay);
  if (len > 0) {
    ax /= len;
    ay /= len;
    predictedPos.vx += ax * speed * 0.22;
    predictedPos.vy += ay * speed * 0.22;
  }

  if (keys.dash && len > 0) {
    predictedPos.vx += ax * 16;
    predictedPos.vy += ay * 16;
  }

  predictedPos.vx *= 0.93;
  predictedPos.vy *= 0.93;
  predictedPos.x += predictedPos.vx;
  predictedPos.y += predictedPos.vy;
}

function makeExplosion(x, y) {
  for (let i = 0; i < 55; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 18,
      vy: (Math.random() - 0.5) * 18,
      life: 70,
      r: Math.random() * 6 + 3
    });
  }
}

function addFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y, text, color, life: 55, vy: -1.2 });
  if (floatingTexts.length > 24) floatingTexts.shift();
}

function makeShockwave(x, y, power = 4) {
  if (shockwaves.length > 16) shockwaves.shift();
  shockwaves.push({
    x, y, r: 8 + power * 0.5, life: 14 + Math.min(10, power),
    power
  });
}

function drawShockwaves() {
  for (const s of shockwaves) {
    const maxLife = 14 + Math.min(10, s.power || 4);
    s.r += 4 + (s.power || 4) * 0.4;
    s.life--;
    ctx.globalAlpha = Math.max(0, s.life / maxLife) * 0.85;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.lineWidth = 2 + (s.power || 4) * 0.35;
    ctx.strokeStyle = s.power > 6 ? UI.cyan : "rgba(248, 250, 252, 0.9)";
    ctx.shadowColor = UI.purple;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  shockwaves = shockwaves.filter(s => s.life > 0);
}

function drawFloatingTexts() {
  for (const t of floatingTexts) {
    t.y += t.vy;
    t.life--;
    ctx.globalAlpha = Math.max(0, t.life / 55);
    ctx.fillStyle = t.color;
    ctx.font = `bold 16px ${UI.fontDisplay}`;
    ctx.textAlign = "center";
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 14;
    ctx.fillText(t.text, t.x, t.y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  floatingTexts = floatingTexts.filter(t => t.life > 0);
}

function roundRect(x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawPanel(x, y, w, h, radius) {
  roundRect(x, y, w, h, radius);
  ctx.fillStyle = UI.panel;
  ctx.fill();
  ctx.strokeStyle = UI.panelBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.shadowColor = "rgba(124, 58, 237, 0.35)";
  ctx.shadowBlur = 14;
  roundRect(x, y, w, h, radius);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawGrid() {
  ctx.strokeStyle = "rgba(124, 58, 237, 0.06)";
  ctx.lineWidth = 1;

  for (let x = -2000; x <= 2000; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, -2000);
    ctx.lineTo(x, 2000);
    ctx.stroke();
  }

  for (let y = -2000; y <= 2000; y += 60) {
    ctx.beginPath();
    ctx.moveTo(-2000, y);
    ctx.lineTo(2000, y);
    ctx.stroke();
  }
}

function topPlayerId() {
  if (!state) return null;
  const alive = state.players.filter(p => p.alive);
  alive.sort((a, b) => b.mass - a.mass || b.kills - a.kills);
  return alive[0]?.id || null;
}

function drawFood() {
  if (!state || !state.foods) return;

  for (const f of state.foods) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(f.x - 2, f.y - 2, 1, f.x, f.y, f.r);
    g.addColorStop(0, "#e0f2fe");
    g.addColorStop(1, UI.purple);
    ctx.fillStyle = g;
    ctx.shadowColor = UI.purple;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawEventMarkerLabel(x, y, text, color) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `bold 13px ${UI.fontDisplay}`;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillText(text, x, y - 8);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawEvent(e) {
  if (!e) return;

  const pulse = 1 + Math.sin(eventPulse * 3) * 0.08;

  if (e.type === "king") {
    const r = e.r * pulse;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, r + i * 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.35 - i * 0.1})`;
      ctx.lineWidth = 4 - i;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(e.x, e.y, 10, e.x, e.y, r);
    g.addColorStop(0, "rgba(250, 204, 21, 0.95)");
    g.addColorStop(1, "rgba(124, 58, 237, 0.15)");
    ctx.fillStyle = g;
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = 45;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 4;
    ctx.stroke();
    drawEventMarkerLabel(e.x, e.y - r, "RING MASTER ZONE", "#facc15");
  }

  if (e.type === "gold") {
    const r = e.r * pulse;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r + 14, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.55)";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(e.x - 6, e.y - 6, 2, e.x, e.y, r);
    g.addColorStop(0, "#fef9c3");
    g.addColorStop(1, "#ca8a04");
    ctx.fillStyle = g;
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = 50;
    ctx.fill();
    ctx.shadowBlur = 0;
    drawEventMarkerLabel(e.x, e.y - r - 10, "GOLDEN CORE", "#fde047");
  }

  if (e.type === "blackhole") {
    const r = e.r * pulse;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r + 20, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(168, 85, 247, 0.5)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(e.x, e.y, 5, e.x, e.y, r);
    g.addColorStop(0, "#020617");
    g.addColorStop(0.65, "#4c1d95");
    g.addColorStop(1, "rgba(168, 85, 247, 0.35)");
    ctx.fillStyle = g;
    ctx.shadowColor = UI.purple;
    ctx.shadowBlur = 45;
    ctx.fill();
    ctx.shadowBlur = 0;
    drawEventMarkerLabel(e.x, e.y - r, "VOID RIFT", UI.purple);
  }

  if (e.type === "mega_gravity") {
    const r = 120 + Math.sin(eventPulse * 2) * 15;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(34, 211, 238, 0.55)";
    ctx.lineWidth = 5;
    ctx.setLineDash([14, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = UI.cyan;
    ctx.shadowBlur = 28;
    ctx.stroke();
    ctx.shadowBlur = 0;
    drawEventMarkerLabel(0, -r - 20, "MEGA: GRAVITY PULSE", UI.cyan);
  }

  if (e.type === "mega_meteor") {
    drawEventMarkerLabel(0, -140, "MEGA: METEOR SHOWER", "#f97316");
  }
}

function drawMeteors() {
  if (!state || !state.meteors) return;

  for (const m of state.meteors) {
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(m.x - 4, m.y - 4, 2, m.x, m.y, m.r);
    g.addColorStop(0, "#fef08a");
    g.addColorStop(0.5, "#f97316");
    g.addColorStop(1, "#dc2626");
    ctx.fillStyle = g;
    ctx.shadowColor = "#f97316";
    ctx.shadowBlur = 25;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * 3, m.y - m.vy * 3);
    ctx.strokeStyle = "rgba(249, 115, 22, 0.6)";
    ctx.lineWidth = m.r * 0.5;
    ctx.stroke();
  }
}

function drawPlayer(p) {
  const speed = Math.hypot(p.vx, p.vy);
  const squash = Math.min(speed * 0.018, 0.2);
  const isTop = p.id === topPlayerId() && (p.kills > 0 || p.mass > 0);
  const rankColor = RANK_COLORS[p.rank] || UI.dim;
  const skinKey = p.skin;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1 + squash, 1 - squash);

  const g = ctx.createRadialGradient(-8, -10, 5, 0, 0, p.r);

  if (p.dangerTimeLeft > 0) {
    g.addColorStop(0, "#fecaca");
    g.addColorStop(1, "#dc2626");
  } else {
    const colors = getSkinColors(skinKey);
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.55, colors[1]);
    g.addColorStop(1, colors[2]);
  }

  ctx.beginPath();
  ctx.arc(0, 0, p.r, 0, Math.PI * 2);
  ctx.fillStyle = g;

  const colors = getSkinColors(skinKey);
  ctx.shadowColor = p.dangerTimeLeft > 0 ? "#ef4444" : colors[1];
  ctx.shadowBlur = p.dangerTimeLeft > 0 ? 35 : skinKey === "neon" ? 32 : 22;
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = p.id === myId ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.65)";
  ctx.stroke();
  ctx.restore();
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";

  const displayName =
    p.id === myId && inviteRewards.founderTitle ? `${p.name} ★` : p.name;

  if (isTop) {
    ctx.font = "24px Arial";
    ctx.fillStyle = UI.cyan;
    ctx.shadowColor = UI.cyan;
    ctx.shadowBlur = 12;
    ctx.fillText("👑", p.x, p.y - p.r - 48);
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = rankColor;
  ctx.font = `bold 11px ${UI.fontDisplay}`;
  ctx.fillText(`LV ${p.level || 1} · ${p.rank || "Bronze"}`, p.x, p.y - p.r - 28);

  ctx.fillStyle = UI.text;
  ctx.font = 'bold 16px ' + UI.font;
  ctx.fillText(displayName, p.x, p.y - p.r - 12);

  ctx.fillStyle = UI.dim;
  ctx.font = '13px ' + UI.font;
  ctx.fillText(`${p.kills} kills`, p.x, p.y + p.r + 18);
  ctx.fillText(`mass ${Math.floor(p.mass)}`, p.x, p.y + p.r + 34);
}

function drawParticles() {
  for (const part of particles) {
    part.x += part.vx;
    part.y += part.vy;
    part.vx *= .94;
    part.vy *= .94;
    part.life--;
    ctx.globalAlpha = part.life / 70;
    ctx.beginPath();
    ctx.arc(part.x, part.y, part.r, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  particles = particles.filter(p => p.life > 0);
}

function drawWorld() {
  ctx.fillStyle = "#04040f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state) return;

  let targetX = 0;
  let targetY = 0;

  if (joined) {
    const me = state.players.find(p => p.id === myId);
    if (me) {
      targetX = me.x;
      targetY = me.y;
    }
  } else {
    const top = [...state.players].sort((a, b) => b.mass - a.mass || b.kills - a.kills)[0];
    if (top) {
      targetX = top.x;
      targetY = top.y;
    }
  }

  camX += (targetX - camX) * .04;
  camY += (targetY - camY) * .04;

  const shake = screenShake > 0.3
    ? (Math.random() - 0.5) * screenShake * 2
    : 0;
  const shakeY = screenShake > 0.3
    ? (Math.random() - 0.5) * screenShake * 2
    : 0;

  ctx.save();
  ctx.translate(canvas.width / 2 - camX + shake, canvas.height / 2 - camY + shakeY);

  drawGrid();

  const arenaR = state.arenaRadius || state.arena;

  ctx.beginPath();
  ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
  ctx.fillStyle = "#0c0a1c";
  ctx.fill();

  ctx.lineWidth = 10;
  ctx.strokeStyle = UI.blue;
  ctx.shadowColor = UI.purple;
  ctx.shadowBlur = 28;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.55)";
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (state.event && state.event.type === "mega_shrink") {
    ctx.beginPath();
    ctx.arc(0, 0, arenaR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
    ctx.lineWidth = 8;
    ctx.setLineDash([12, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.shadowBlur = 0;
    drawEventMarkerLabel(0, -arenaR - 24, "MEGA: SHRINKING RING", "#f87171");
  }

  drawFood();
  drawEvent(state.event);
  drawMeteors();

  for (const p of state.players) {
    if (p.alive) drawPlayer(p);
  }

  drawParticles();
  drawShockwaves();
  drawFloatingTexts();

  ctx.restore();

  if (!joined) {
    const vignette = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.55
    );
    vignette.addColorStop(0, "rgba(4, 4, 15, 0.15)");
    vignette.addColorStop(1, "rgba(4, 4, 15, 0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawMenuSpectateHint();
  }
}

function drawMenuSpectateHint() {
  if (!state || joined) return;

  const online = state.online || 0;
  let line1 = "Watching the arena";
  let line2 = menuConnected
    ? "Pick a server and press ENTER RING"
    : "Connecting to RingOut.io…";

  if (online === 0) {
    line1 = "Waiting for fighters";
    line2 = "You can still enter and start the brawl";
  } else if (online === 1) {
    line1 = "1 player in the ring";
    line2 = "Jump in — events spawn faster with company";
  }

  const y = canvas.height * 0.72;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(4, 4, 15, 0.55)";
  roundRect(canvas.width / 2 - 200, y - 28, 400, 72, 14);
  ctx.fill();
  ctx.strokeStyle = UI.panelBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = UI.cyan;
  ctx.font = `bold 18px ${UI.fontDisplay}`;
  ctx.fillText(line1, canvas.width / 2, y + 4);
  ctx.fillStyle = UI.dim;
  ctx.font = `600 15px ${UI.font}`;
  ctx.fillText(line2, canvas.width / 2, y + 28);
}

function drawLeaderboard() {
  if (!state) return;

  const players = [...state.players].sort((a, b) => b.xp - a.xp || b.mass - a.mass || b.kills - a.kills);
  const mobile = isTouchDevice();

  const pad = 14;
  const rowH = mobile ? 22 : 26;
  const headerH = mobile ? 36 : 44;
  const footerH = mobile ? 22 : 26;
  const rows = mobile ? 5 : 10;
  const boxW = mobile ? 210 : 290;
  const boxH = headerH + rows * rowH + footerH + pad;
  const x = canvas.width - boxW - (mobile ? 8 : 18);
  const y = mobile ? 8 : 16;
  const radius = mobile ? 10 : 14;

  drawPanel(x, y, boxW, boxH, radius);

  const title = mobile ? "TOP RING" : "ARENA RANK";
  const grad = ctx.createLinearGradient(x, y, x + boxW, y + headerH);
  grad.addColorStop(0, UI.purple);
  grad.addColorStop(1, UI.cyan);
  ctx.fillStyle = grad;
  ctx.font = `bold ${mobile ? 13 : 16}px ${UI.fontDisplay}`;
  ctx.textAlign = "left";
  ctx.fillText(title, x + pad, y + (mobile ? 22 : 28));

  ctx.textAlign = "left";
  players.slice(0, rows).forEach((p, i) => {
    const rowY = y + headerH + i * rowH;
    const isMe = p.id === myId;
    const isFirst = i === 0 && (p.kills > 0 || p.mass > 0);
    const rankColor = RANK_COLORS[p.rank] || UI.dim;

    if (isMe) {
      roundRect(x + 6, rowY - 15, boxW - 12, rowH - 2, 6);
      ctx.fillStyle = "rgba(124, 58, 237, 0.22)";
      ctx.fill();
    }

    ctx.fillStyle = isFirst ? UI.cyan : UI.dim;
    ctx.font = `bold ${mobile ? 11 : 13}px ${UI.fontDisplay}`;
    ctx.fillText(String(i + 1).padStart(2, "0"), x + pad, rowY);

    const crown = isFirst ? "👑 " : "";
    const dead = p.alive ? "" : " 💀";
    const maxLen = mobile ? 7 : 9;
    const name = p.name.length > maxLen ? p.name.slice(0, maxLen) + "…" : p.name;

    ctx.fillStyle = isMe ? "#f8fafc" : UI.text;
    ctx.font = `${mobile ? 11 : 14}px ${UI.font}`;
    ctx.fillText(`${crown}${name}`, x + pad + (mobile ? 26 : 32), rowY);

    ctx.fillStyle = rankColor;
    ctx.font = `${mobile ? 9 : 10}px ${UI.fontDisplay}`;
    ctx.fillText(`${p.rank || "Bronze"} L${p.level || 1}`, x + pad + (mobile ? 26 : 32), rowY + (mobile ? 10 : 12));

    ctx.fillStyle = UI.dim;
    ctx.font = `${mobile ? 10 : 12}px ${UI.font}`;
    ctx.textAlign = "right";
    ctx.fillText(`K${p.kills}${dead}`, x + boxW - pad, rowY);
    ctx.textAlign = "left";
  });

  ctx.fillStyle = UI.blue;
  ctx.font = `${mobile ? 10 : 12}px ${UI.font}`;
  ctx.fillText(`● ${state.online || 0} online`, x + pad, y + boxH - (mobile ? 10 : 12));
}

function drawKillFeed() {
  if (!state || !state.killFeed) return;

  const mobile = isTouchDevice();
  const now = Date.now();
  const feedMaxAge = 2200;

  const visibleFeed = (state.killFeed || [])
    .map((text, i) => ({ text, key: `${i}|${text}`, at: killFeedTimes[`${i}|${text}`] || 0 }))
    .filter(entry => entry.at && now - entry.at < feedMaxAge)
    .sort((a, b) => b.at - a.at);

  ctx.textAlign = "left";

  visibleFeed.slice(0, mobile ? 2 : 4).forEach((entry, i) => {
    const text = entry.text;
    const age = now - entry.at;
    const fade = Math.min(1, (feedMaxAge - age) / 500);
    const padX = 12;
    const h = mobile ? 28 : 34;
    const xPos = mobile ? 8 : 18;
    const yPos = mobile ? 52 + i * (h + 6) : 100 + i * (h + 8);
    const shortText = mobile && text.length > 28 ? text.slice(0, 28) + "…" : text;

    ctx.font = `${mobile ? 12 : 15}px ${UI.font}`;
    const textW = ctx.measureText(shortText).width;
    const w = Math.min(textW + padX * 2 + 8, mobile ? 240 : 360);

    ctx.globalAlpha = fade;
    drawPanel(xPos, yPos, w, h, 8);

    ctx.fillStyle = UI.cyan;
    ctx.font = `bold ${mobile ? 10 : 11}px ${UI.fontDisplay}`;
    ctx.fillText("RING", xPos + padX, yPos + (mobile ? 11 : 13));

    ctx.fillStyle = UI.text;
    ctx.font = `${mobile ? 12 : 15}px ${UI.font}`;
    ctx.fillText(shortText, xPos + padX, yPos + (mobile ? 23 : 27));
    ctx.globalAlpha = 1;
  });
}

function drawEventTimer() {
  if (!state) return;

  const mobile = isTouchDevice();

  if (state.megaWarning) {
    const left = Math.max(0, Math.ceil((state.megaWarning.endsAt - Date.now()) / 1000));
    const w = mobile ? 280 : 380;
    const h = mobile ? 52 : 58;
    const x = canvas.width / 2 - w / 2;
    const y = mobile ? 58 : 14;

    drawPanel(x, y, w, h, 10);

    ctx.textAlign = "center";
    ctx.fillStyle = "#f97316";
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 20;
    ctx.font = `bold ${mobile ? 13 : 16}px ${UI.fontDisplay}`;
    ctx.fillText("⚠ MEGA EVENT INCOMING", canvas.width / 2, y + (mobile ? 20 : 22));
    ctx.fillStyle = UI.cyan;
    ctx.font = `900 ${mobile ? 16 : 22}px ${UI.fontDisplay}`;
    ctx.fillText(state.megaWarning.label || "MEGA EVENT", canvas.width / 2, y + (mobile ? 40 : 46));
    ctx.shadowBlur = 0;
    ctx.fillStyle = UI.text;
    ctx.font = `${mobile ? 12 : 14}px ${UI.font}`;
    ctx.fillText(`${left}s`, canvas.width / 2, y + h - 6);
    return;
  }

  if (state.eventMessage && state.event) {
    const w = mobile ? 260 : 340;
    const h = 36;
    const x = canvas.width / 2 - w / 2;
    const y = mobile ? 58 : 14;

    drawPanel(x, y, w, h, 10);
    ctx.textAlign = "center";
    ctx.fillStyle = state.event.type.startsWith("mega_") ? "#f97316" : UI.cyan;
    ctx.font = `bold ${mobile ? 12 : 15}px ${UI.fontDisplay}`;
    ctx.fillText(state.eventMessage, canvas.width / 2, y + 24);
  }

  if (state.eventTimer == null || state.eventTimer <= 0) return;

  const seconds = Math.ceil(state.eventTimer / 1000);
  const w = 240;
  const h = 36;
  const x = canvas.width / 2 - w / 2;
  const y = state.event ? (mobile ? 100 : 58) : (mobile ? 58 : 14);

  drawPanel(x, y, w, h, 10);
  ctx.textAlign = "center";
  ctx.fillStyle = UI.cyan;
  ctx.font = `bold ${mobile ? 12 : 16}px ${UI.fontDisplay}`;
  ctx.fillText(`EVENT IN ${seconds}s`, canvas.width / 2, y + 24);
}

function drawDashBar() {
  const me = state && state.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  const mobile = isTouchDevice();
  const w = mobile ? 170 : 260;
  const h = mobile ? 12 : 18;
  const x = canvas.width / 2 - w / 2;
  const y = mobile ? 12 : canvas.height - 48;
  const ready = 1 - Math.min(me.dashCooldown / 72, 1);

  drawPanel(x, y, w, h, 8);

  roundRect(x + 3, y + 3, (w - 6) * ready, h - 6, 5);
  const barGrad = ctx.createLinearGradient(x, y, x + w, y);
  barGrad.addColorStop(0, UI.violet);
  barGrad.addColorStop(1, ready >= 1 ? UI.cyan : UI.blue);
  ctx.fillStyle = barGrad;
  ctx.fill();

  ctx.fillStyle = ready >= 1 ? UI.cyan : UI.text;
  ctx.font = `bold ${mobile ? 10 : 12}px ${UI.fontDisplay}`;
  ctx.textAlign = "center";
  ctx.fillText(ready >= 1 ? "DASH READY" : "DASH CHARGING", canvas.width / 2, y + (mobile ? 26 : -6));
}

function drawRespawn() {
  const me = state && state.players.find(p => p.id === myId);
  if (!me || me.alive) return;

  const mobile = isTouchDevice();
  const left = Math.max(0, Math.ceil((me.respawnAt - Date.now()) / 1000));

  ctx.fillStyle = "rgba(4, 4, 15, 0.88)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cardW = mobile ? 300 : 380;
  const cardH = mobile ? 200 : 220;
  const cx = canvas.width / 2 - cardW / 2;
  const cy = canvas.height / 2 - cardH / 2 - 20;
  drawPanel(cx, cy, cardW, cardH, 16);

  ctx.textAlign = "center";
  ctx.fillStyle = UI.purple;
  ctx.shadowColor = UI.cyan;
  ctx.shadowBlur = 24;
  ctx.font = `bold ${mobile ? 42 : 56}px ${UI.fontDisplay}`;
  ctx.fillText("RING OUT!", canvas.width / 2, cy + (mobile ? 58 : 72));
  ctx.shadowBlur = 0;

  ctx.shadowBlur = 0;
  ctx.fillStyle = UI.text;
  ctx.font = `600 ${mobile ? 18 : 22}px ${UI.font}`;
  ctx.fillText(`Respawn in ${left}s`, canvas.width / 2, cy + (mobile ? 92 : 108));

  if (me.lastKillerName) {
    ctx.fillStyle = "#f87171";
    ctx.font = `bold ${mobile ? 15 : 18}px ${UI.fontDisplay}`;
    ctx.fillText(`Knocked out by ${me.lastKillerName}`, canvas.width / 2, cy + (mobile ? 118 : 132));
  } else {
    ctx.fillStyle = UI.dim;
    ctx.font = `600 ${mobile ? 14 : 16}px ${UI.font}`;
    ctx.fillText("You left the ring", canvas.width / 2, cy + (mobile ? 118 : 132));
  }

  ctx.fillStyle = UI.cyan;
  ctx.font = `bold ${mobile ? 13 : 15}px ${UI.fontDisplay}`;
  ctx.fillText(`Kills ${me.kills} · Mass ${Math.floor(me.mass)}`, canvas.width / 2, cy + cardH - 28);

  ctx.fillStyle = RANK_COLORS[me.rank] || UI.dim;
  ctx.font = `${mobile ? 11 : 13}px ${UI.font}`;
  ctx.fillText(`LV ${me.level || 1} · ${me.rank || "Bronze"} · ${Math.floor(me.xp || 0)} XP`, canvas.width / 2, cy + cardH - 10);
}

function drawStreakBanner() {
  const now = Date.now();
  if (!localStreakBanner || now >= localStreakBannerUntil) {
    const el = document.getElementById("streakBanner");
    if (el) el.classList.add("hidden");
    localStreakBanner = null;
    return;
  }

  const t = 1 - (localStreakBannerUntil - now) / 2000;
  const scale = 1 + Math.sin(t * Math.PI) * 0.12;
  const alpha = t < 0.85 ? 1 : (1 - t) / 0.15;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.translate(canvas.width / 2, canvas.height / 2 - 60);
  ctx.scale(scale, scale);

  const colors = {
    "DOUBLE KILL": ["#38bdf8", "#22d3ee"],
    "TRIPLE KILL": ["#a855f7", "#c084fc"],
    "GODLIKE": ["#facc15", "#f97316"],
  };
  const c = colors[localStreakBanner] || [UI.cyan, UI.purple];

  ctx.font = `900 52px ${UI.fontDisplay}`;
  ctx.shadowColor = c[0];
  ctx.shadowBlur = 40;
  const grad = ctx.createLinearGradient(-200, 0, 200, 0);
  grad.addColorStop(0, c[0]);
  grad.addColorStop(1, c[1]);
  ctx.fillStyle = grad;
  ctx.fillText(localStreakBanner, 0, 0);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawDangerOverlay() {
  const me = state && state.players.find(p => p.id === myId);
  if (!me || !me.alive || !me.dangerTimeLeft) return;

  const seconds = Math.ceil(me.dangerTimeLeft / 1000);

  ctx.fillStyle = "rgba(124, 58, 237, 0.25)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = UI.cyan;
  ctx.shadowColor = UI.purple;
  ctx.shadowBlur = 30;
  ctx.font = `bold 88px ${UI.fontDisplay}`;
  ctx.fillText(seconds, canvas.width / 2, canvas.height / 2);
  ctx.shadowBlur = 0;

  ctx.fillStyle = UI.text;
  ctx.font = `bold 22px ${UI.fontDisplay}`;
  ctx.fillText("GET BACK IN THE RING!", canvas.width / 2, canvas.height / 2 + 48);
}

function draw() {
  requestAnimationFrame(draw);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  updateInterpolation();
  drawWorld();

  if (joined) {
    drawKillFeed();
    drawEventTimer();
    drawLeaderboard();
    drawEventArrow();
    drawDashBar();
    drawStreakBanner();
    drawRespawn();
    drawDangerOverlay();
  }
}

function updateInterpolation() {
  if (!state) return;

  for (const p of state.players) {
    if (p.id === myId) continue;
    const interp = playerInterpolation.get(p.id);
    if (interp) {
      interp.t = Math.min(1, interp.t + 0.08);
      p.x = interp.prevX + (interp.targetX - interp.prevX) * interp.t;
      p.y = interp.prevY + (interp.targetY - interp.prevY) * interp.t;
      playerInterpolation.set(p.id, interp);
    }
  }

  const me = state.players.find(p => p.id === myId);
  if (me && me.alive) {
    const dx = lastServerPos.x - predictedPos.x;
    const dy = lastServerPos.y - predictedPos.y;
    const dist = Math.hypot(dx, dy);
    
    if (dist > 50) {
      predictedPos.x = lastServerPos.x;
      predictedPos.y = lastServerPos.y;
    } else if (dist > 5) {
      predictedPos.x += dx * 0.1;
      predictedPos.y += dy * 0.1;
    }
    
    me.x = predictedPos.x;
    me.y = predictedPos.y;
  }
}

function setupMobileControls() {
  const base = document.getElementById("joystickBase");
  const stick = document.getElementById("joystickStick");
  const dashBtn = document.getElementById("dashBtn");

  if (!base || !stick || !dashBtn) return;

  let activePointer = null;

  function resetJoystick() {
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
    stick.style.left = "50%";
    stick.style.top = "50%";
    stick.style.transform = "translate(-50%, -50%)";
  }

  function moveJoystick(e) {
    const rect = base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const max = rect.width * 0.34;

    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }

    stick.style.left = `calc(50% + ${dx}px)`;
    stick.style.top = `calc(50% + ${dy}px)`;
    stick.style.transform = "translate(-50%, -50%)";

    const dead = 12;
    keys.left = dx < -dead;
    keys.right = dx > dead;
    keys.up = dy < -dead;
    keys.down = dy > dead;
  }

  base.addEventListener("pointerdown", e => {
    activePointer = e.pointerId;
    base.setPointerCapture(activePointer);
    moveJoystick(e);
  });

  base.addEventListener("pointermove", e => {
    if (activePointer === e.pointerId) moveJoystick(e);
  });

  base.addEventListener("pointerup", e => {
    if (activePointer === e.pointerId) {
      activePointer = null;
      resetJoystick();
    }
  });

  base.addEventListener("pointercancel", resetJoystick);

  dashBtn.addEventListener("pointerdown", e => {
    e.preventDefault();
    keys.dash = true;
    if (navigator.vibrate) navigator.vibrate(25);
  });

  dashBtn.addEventListener("pointerup", () => { keys.dash = false; });
  dashBtn.addEventListener("pointercancel", () => { keys.dash = false; });

  resetJoystick();
}

function setupMenuExtras() {
  const btn = document.getElementById("menuExtrasBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-extras-open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

skinIndex = findFirstUnlockedIndex();
selectedSkin = skinList[skinIndex];
refreshDailyQuests();
updateStatsUI();
updateQuestUI();
setupMenuExtras();
setupInviteSystem();
setupMobileControls();
updateSkinPreview();
setMenuStatus("Connecting to arena…");
draw();
