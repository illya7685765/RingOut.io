const socket = io({
  transports: ["websocket"]
});

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// State management with Maps for O(1) lookups
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
let eventPulse = 0;
let menuConnected = false;

let inputSeq = 0;
let predictedPos = { x: 0, y: 0, vx: 0, vy: 0 };
let serverSnapshots = [];
let playerStates = new Map();
let interpolationDelay = 100;
let localDashCooldown = 0;

// Optimized data structures
let playersMap = new Map(); // Replace array.find() with Map
let foodsMap = new Map(); // Food lookup optimization
let leaderboardCache = null;
let leaderboardCacheTime = 0;
const LEADERBOARD_CACHE_DURATION = 500; // Cache for 500ms

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
  achievements: "ringout_achievements",
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

function loadAchievements() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.achievements)) || {
      firstKill: false,
      mass100: false,
      mass500: false,
      mass1000: false,
      kills10: false,
      kills50: false,
      kills100: false,
      survivor: false,
      splitter: false,
      ejector: false
    };
  } catch {
    return {
      firstKill: false,
      mass100: false,
      mass500: false,
      mass1000: false,
      kills10: false,
      kills50: false,
      kills100: false,
      survivor: false,
      splitter: false,
      ejector: false
    };
  }
}

function saveAchievements(achievements) {
  localStorage.setItem(STORAGE_KEYS.achievements, JSON.stringify(achievements));
}

let achievements = loadAchievements();

const ACHIEVEMENT_DEFINITIONS = {
  firstKill: { name: "First Blood", description: "Get your first kill", icon: "🩸" },
  mass100: { name: "Growing Strong", description: "Reach 100 mass", icon: "💪" },
  mass500: { name: "Massive", description: "Reach 500 mass", icon: "🏋️" },
  mass1000: { name: "Titan", description: "Reach 1000 mass", icon: "🗿" },
  kills10: { name: "Hunter", description: "Get 10 total kills", icon: "🎯" },
  kills50: { name: "Slayer", description: "Get 50 total kills", icon: "⚔️" },
  kills100: { name: "Legend", description: "Get 100 total kills", icon: "👑" },
  survivor: { name: "Survivor", description: "Survive for 5 minutes", icon: "🛡️" },
  splitter: { name: "Divide and Conquer", description: "Use split ability", icon: "✂️" },
  ejector: { name: "Generous", description: "Eject mass 10 times", icon: "🎁" }
};

function checkAchievements(stats) {
  let newUnlock = false;
  
  if (!achievements.firstKill && stats.totalKills >= 1) {
    achievements.firstKill = true;
    showToast(`🩸 Achievement Unlocked: First Blood!`);
    newUnlock = true;
  }
  
  if (!achievements.mass100 && stats.bestMass >= 100) {
    achievements.mass100 = true;
    showToast(`💪 Achievement Unlocked: Growing Strong!`);
    newUnlock = true;
  }
  
  if (!achievements.mass500 && stats.bestMass >= 500) {
    achievements.mass500 = true;
    showToast(`🏋️ Achievement Unlocked: Massive!`);
    newUnlock = true;
  }
  
  if (!achievements.mass1000 && stats.bestMass >= 1000) {
    achievements.mass1000 = true;
    showToast(`🗿 Achievement Unlocked: Titan!`);
    newUnlock = true;
  }
  
  if (!achievements.kills10 && stats.totalKills >= 10) {
    achievements.kills10 = true;
    showToast(`🎯 Achievement Unlocked: Hunter!`);
    newUnlock = true;
  }
  
  if (!achievements.kills50 && stats.totalKills >= 50) {
    achievements.kills50 = true;
    showToast(`⚔️ Achievement Unlocked: Slayer!`);
    newUnlock = true;
  }
  
  if (!achievements.kills100 && stats.totalKills >= 100) {
    achievements.kills100 = true;
    showToast(`👑 Achievement Unlocked: Legend!`);
    newUnlock = true;
  }
  
  if (newUnlock) {
    saveAchievements(achievements);
  }
  
  return achievements;
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
    
    // Check achievements
    checkAchievements(playerStats);
  }

  if (me.mass > playerStats.bestMass) {
    playerStats.bestMass = me.mass;
    saveStats(playerStats);
    
    // Check achievements
    checkAchievements(playerStats);
  }

  if ((me.level || 1) > playerStats.highestLevel) {
    playerStats.highestLevel = me.level;
    saveStats(playerStats);
  }

  prevMe = { ...me };
  updateStatsUI();
  updateQuestUI();
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
  if (!joined) refreshInviteStats();
});

socket.on("init", (data) => {
  myId = data.id;
  state = {
    players: [],
    foods: [],
    arena: data.ar
  };
});

socket.on("disconnect", () => {
  menuConnected = false;
  setMenuStatus("Reconnecting to arena…");
});

socket.on("s", (snapshot) => {
  serverSnapshots.push({
    seq: snapshot.seq,
    t: snapshot.t,
    d: snapshot.d,
    f: snapshot.f
  });

  if (serverSnapshots.length > 10) {
    serverSnapshots.shift();
  }

  if (!state) {
    state = {
      players: [],
      foods: snapshot.f,
      arena: snapshot.ar || 3000,
      arenaRadius: snapshot.ar || 3000,
      killFeed: snapshot.k || []
    };
    // Initialize maps
    playersMap.clear();
    foodsMap.clear();
  } else {
    state.foods = snapshot.f;
    state.arena = snapshot.ar || 3000;
    state.arenaRadius = snapshot.ar || 3000;
    if (snapshot.k) state.killFeed = snapshot.k;
  }

  // Process deltas with Map lookups
  for (const delta of snapshot.d) {
    if (delta.a === 0) {
      // Player died/left
      playersMap.delete(delta.i);
      state.players = state.players.filter(p => p.id !== delta.i);
      playerStates.delete(delta.i);
    } else {
      let player = playersMap.get(delta.i);
      if (!player) {
        player = {
          id: delta.i,
          name: delta.n || "Player",
          skin: delta.s || "green",
          x: delta.x,
          y: delta.y,
          r: delta.r,
          mass: delta.m,
          alive: true,
          kills: delta.k || 0,
          level: delta.l || 1,
          xp: delta.xp || 0
        };
        state.players.push(player);
        playersMap.set(delta.i, player);
      }

      playerStates.set(delta.i, {
        prevX: player.x,
        prevY: player.y,
        prevR: player.r,
        targetX: delta.x,
        targetY: delta.y,
        targetR: delta.r,
        targetM: delta.m,
        timestamp: snapshot.t
      });

      player.x = delta.x;
      player.y = delta.y;
      player.r = delta.r;
      player.mass = delta.m;
      if (delta.k !== undefined) player.kills = delta.k;
      if (delta.l !== undefined) player.level = delta.l;
      if (delta.xp !== undefined) player.xp = delta.xp;
    }
  }

  // Update food map - only add/update, don't clear to prevent flickering
  for (const food of state.foods) {
    foodsMap.set(food.id, food);
  }
  
  // Remove foods that are no longer in the snapshot
  const foodIds = new Set(state.foods.map(f => f.id));
  for (const [id] of foodsMap) {
    if (!foodIds.has(id)) {
      foodsMap.delete(id);
    }
  }

  // Invalidate leaderboard cache
  leaderboardCache = null;
  leaderboardCacheTime = 0;

  const me = playersMap.get(myId);
  if (me) {
    const myState = playerStates.get(myId);
    if (myState) {
      // Only reset prediction if significantly off (server reconciliation)
      const dx = myState.targetX - predictedPos.x;
      const dy = myState.targetY - predictedPos.y;
      const distSq = dx * dx + dy * dy;
      
      // Only hard reset if very far off (more than 300 units)
      if (distSq > 90000) {
        predictedPos.x = myState.targetX;
        predictedPos.y = myState.targetY;
        predictedPos.vx = 0;
        predictedPos.vy = 0;
      }
      // Otherwise, let the interpolation system handle smooth correction
      
      // Sync dash cooldown from server
      if (me.dashCooldown !== undefined) {
        localDashCooldown = me.dashCooldown / 30; // Convert ticks to seconds
      }
    }

    trackMeProgress(me);

    if (lastAlive && !me.alive) {
      makeExplosion(me.x, me.y);
      screenShake = 16;
    }
    lastAlive = me.alive;
  }

  eventPulse += 0.08;
  if (screenShake > 0) screenShake *= 0.82;
});


addEventListener("keydown", e => {
  if (e.code === "KeyW") keys.up = true;
  if (e.code === "KeyS") keys.down = true;
  if (e.code === "KeyA") keys.left = true;
  if (e.code === "KeyD") keys.right = true;
  if (e.code === "Space") keys.dash = true;
  
  // Split mechanic (Q key)
  if (e.code === "KeyQ" && joined) {
    const me = playersMap.get(myId);
    if (me && me.alive) {
      const directionX = keys.right ? 1 : keys.left ? -1 : 1;
      const directionY = keys.down ? 1 : keys.up ? -1 : 0;
      socket.emit("split", { directionX, directionY });
    }
  }
  
  // Eject mass (E key)
  if (e.code === "KeyE" && joined) {
    const me = playersMap.get(myId);
    if (me && me.alive) {
      const directionX = keys.right ? 1 : keys.left ? -1 : 1;
      const directionY = keys.down ? 1 : keys.up ? -1 : 0;
      socket.emit("eject", { directionX, directionY });
    }
  }
});

addEventListener("keyup", e => {
  if (e.code === "KeyW") keys.up = false;
  if (e.code === "KeyS") keys.down = false;
  if (e.code === "KeyA") keys.left = false;
  if (e.code === "KeyD") keys.right = false;
  if (e.code === "Space") keys.dash = false;
});

const INPUT_RATE = 30;
const INPUT_DT = 1 / INPUT_RATE; // Delta time for prediction
setInterval(() => {
  if (joined) {
    inputSeq++;
    socket.emit("input", {
      seq: inputSeq,
      input: keys
    });
    updateClientPrediction(INPUT_DT);
  }
}, 1000 / INPUT_RATE);

function updateClientPrediction(dt) {
  if (!state) return;
  const me = playersMap.get(myId);
  if (!me || !me.alive) return;

  // Update local dash cooldown
  if (localDashCooldown > 0) {
    localDashCooldown -= dt;
  }

  // Match server speed calculation exactly
  const BASE_SPEED = 5;
  const SPEED_DECAY = 0.02;
  let speed = Math.max(1, BASE_SPEED * Math.pow(me.mass, -SPEED_DECAY));
  let ax = 0;
  let ay = 0;

  if (keys.up) ay -= 1;
  if (keys.down) ay += 1;
  if (keys.left) ax -= 1;
  if (keys.right) ax += 1;

  const lenSq = ax * ax + ay * ay;
  if (lenSq > 0) {
    const len = Math.sqrt(lenSq);
    ax /= len;
    ay /= len;
    predictedPos.vx += ax * speed * 0.3;
    predictedPos.vy += ay * speed * 0.3;
  }

  // Dash with cooldown check
  if (keys.dash && lenSq > 0 && localDashCooldown <= 0) {
    predictedPos.vx += ax * 16;
    predictedPos.vy += ay * 16;
    localDashCooldown = 1; // 1 second cooldown
  }

  // Match server friction
  const FRICTION = 0.95;
  predictedPos.vx *= FRICTION;
  predictedPos.vy *= FRICTION;
  predictedPos.x += predictedPos.vx * dt;
  predictedPos.y += predictedPos.vy * dt;

  const meState = playerStates.get(myId);
  if (meState) {
    me.x = predictedPos.x;
    me.y = predictedPos.y;
  }
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
  let topId = null;
  let topMass = -1;
  
  for (const player of state.players) {
    if (player.alive && player.mass > topMass) {
      topMass = player.mass;
      topId = player.id;
    }
  }
  
  return topId;
}

// Viewport culling helper
function isInViewport(x, y, radius, camX, camY, viewportWidth, viewportHeight) {
  const screenX = x - camX + canvas.width / 2;
  const screenY = y - camY + canvas.height / 2;
  const margin = radius + 100; // Increased margin to prevent pop-in
  
  return screenX > -margin && 
         screenX < viewportWidth + margin &&
         screenY > -margin && 
         screenY < viewportHeight + margin;
}

function drawFood() {
  if (!state || !state.foods) return;

  // Batch food rendering by color for performance
  const foodBatches = new Map();
  
  for (const f of state.foods) {
    // Viewport culling
    if (!isInViewport(f.x, f.y, f.r, camX, camY, canvas.width, canvas.height)) {
      continue;
    }
    
    const color = f.c || UI.purple;
    if (!foodBatches.has(color)) {
      foodBatches.set(color, []);
    }
    foodBatches.get(color).push(f);
  }
  
  // Draw each batch
  for (const [color, foods] of foodBatches) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    
    for (const f of foods) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowBlur = 0;
  }
}


function drawPlayer(p) {
  const skinKey = p.skin;
  const isTop = p.id === topPlayerId() && p.mass > 0;

  ctx.save();
  ctx.translate(p.x, p.y);

  const colors = getSkinColors(skinKey);
  const g = ctx.createRadialGradient(-8, -10, 5, 0, 0, p.r);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.55, colors[1]);
  g.addColorStop(1, colors[2]);

  ctx.beginPath();
  ctx.arc(0, 0, p.r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.shadowColor = colors[1];
  ctx.shadowBlur = skinKey === "neon" ? 32 : 22;
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

  ctx.fillStyle = UI.text;
  ctx.font = 'bold 16px ' + UI.font;
  ctx.fillText(displayName, p.x, p.y - p.r - 12);

  ctx.fillStyle = UI.dim;
  ctx.font = '13px ' + UI.font;
  ctx.fillText(`${Math.floor(p.mass)}`, p.x, p.y + p.r + 18);
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
    const me = playersMap.get(myId);
    if (me) {
      targetX = me.x;
      targetY = me.y;
    }
  } else {
    // Find top player without sorting
    let topPlayer = null;
    let topMass = -1;
    for (const p of state.players) {
      if (p.alive && p.mass > topMass) {
        topMass = p.mass;
        topPlayer = p;
      }
    }
    if (topPlayer) {
      targetX = topPlayer.x;
      targetY = topPlayer.y;
    }
  }

  // Improved camera smoothing - more responsive
  const smoothFactor = 0.15;
  camX += (targetX - camX) * smoothFactor;
  camY += (targetY - camY) * smoothFactor;

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

  drawFood();

  // Viewport culling for players
  for (const p of state.players) {
    if (p.alive && isInViewport(p.x, p.y, p.r, camX, camY, canvas.width, canvas.height)) {
      drawPlayer(p);
    }
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

  const online = state.players.length || 0;
  let line1 = "Watching the arena";
  let line2 = menuConnected
    ? "Pick a server and press ENTER RING"
    : "Connecting to RingOut.io…";

  if (online === 0) {
    line1 = "Waiting for fighters";
    line2 = "You can still enter and start the brawl";
  } else if (online === 1) {
    line1 = "1 player in the ring";
    line2 = "Jump in and fight!";
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

  // Use cached leaderboard if available
  const now = Date.now();
  if (!leaderboardCache || now - leaderboardCacheTime > LEADERBOARD_CACHE_DURATION) {
    // Sort and cache leaderboard
    leaderboardCache = [...state.players].sort((a, b) => b.mass - a.mass);
    leaderboardCacheTime = now;
  }

  const players = leaderboardCache;
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
    const isFirst = i === 0 && p.mass > 0;

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

    ctx.fillStyle = UI.dim;
    ctx.font = `${mobile ? 10 : 12}px ${UI.font}`;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.floor(p.mass)}${dead}`, x + boxW - pad, rowY);
    ctx.textAlign = "left";
  });

  ctx.fillStyle = UI.blue;
  ctx.font = `${mobile ? 10 : 12}px ${UI.font}`;
  ctx.fillText(`● ${state.players.length} online`, x + pad, y + boxH - (mobile ? 10 : 12));
}


function drawDashBar() {
  const me = playersMap.get(myId);
  if (!me || !me.alive) return;

  const mobile = isTouchDevice();
  const w = mobile ? 170 : 260;
  const h = mobile ? 12 : 18;
  const x = canvas.width / 2 - w / 2;
  const y = mobile ? 12 : canvas.height - 48;
  const ready = 1 - Math.min(localDashCooldown, 1);

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
  const me = playersMap.get(myId);
  if (!me || me.alive) return;

  const mobile = isTouchDevice();

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

  ctx.fillStyle = UI.text;
  ctx.font = `600 ${mobile ? 18 : 22}px ${UI.font}`;
  ctx.fillText("Respawning...", canvas.width / 2, cy + (mobile ? 92 : 108));

  ctx.fillStyle = UI.cyan;
  ctx.font = `bold ${mobile ? 13 : 15}px ${UI.fontDisplay}`;
  ctx.fillText(`Mass ${Math.floor(me.mass)}`, canvas.width / 2, cy + cardH - 28);
}


function draw() {
  requestAnimationFrame(draw);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  updateInterpolation();
  drawWorld();

  if (joined) {
    drawLeaderboard();
    drawDashBar();
    drawRespawn();
  }
}

function updateInterpolation() {
  if (!state) return;

  const now = Date.now();
  
  // Interpolate other players
  for (const p of state.players) {
    if (p.id === myId) continue;

    const pState = playerStates.get(p.id);
    if (pState) {
      const age = now - pState.timestamp;
      // Interpolate if state is recent (within 200ms)
      if (age < 200) {
        const alpha = Math.min(1, age / 100);
        p.x = pState.prevX + (pState.targetX - pState.prevX) * alpha;
        p.y = pState.prevY + (pState.targetY - pState.prevY) * alpha;
        p.r = pState.prevR + (pState.targetR - pState.prevR) * alpha;
      } else {
        // Use target position if state is old
        p.x = pState.targetX;
        p.y = pState.targetY;
        p.r = pState.targetR;
      }
      p.mass = pState.targetM;
    }
  }

  // Client-side prediction correction for local player
  const me = playersMap.get(myId);
  if (me && me.alive) {
    const meState = playerStates.get(myId);
    if (meState) {
      const dx = meState.targetX - predictedPos.x;
      const dy = meState.targetY - predictedPos.y;
      const distSq = dx * dx + dy * dy;

      // Only correct if prediction is significantly off (more than 100 units)
      if (distSq > 10000) {
        // Snap if very far (more than 200 units)
        if (distSq > 40000) {
          predictedPos.x = meState.targetX;
          predictedPos.y = meState.targetY;
          predictedPos.vx = 0;
          predictedPos.vy = 0;
        } else {
          // Smooth correction
          predictedPos.x += dx * 0.3;
          predictedPos.y += dy * 0.3;
        }
      }

      me.x = predictedPos.x;
      me.y = predictedPos.y;
    }
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
