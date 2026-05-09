import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STORAGE_KEY = "cricketScorecardMatch";
const CLOUD_PIN_STORAGE_KEY = "cricketScorecardCloudPin";
const MAX_UNDO_HISTORY = 120;

const firebaseConfig = {
  apiKey: "AIzaSyC1mhPymRaEexmfcgY4Aed6X8frBfraYO0",
  authDomain: "cric-scorecard-917c8.firebaseapp.com",
  projectId: "cric-scorecard-917c8",
  storageBucket: "cric-scorecard-917c8.firebasestorage.app",
  messagingSenderId: "962099070011",
  appId: "1:962099070011:web:db627779f6f929ded4881e",
  measurementId: "G-ZLPMCPLMNQ"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const CLOUD_SYNC_INTERVAL_MS = 2500;
const CLOUD_SAVE_DEBOUNCE_MS = 500;
const extraLabels = {
  wide: "Wide",
  noBall: "No Ball",
  bye: "Bye",
  legBye: "Leg Bye"
};
let skipNextSave = false;
let pendingExtraType = "";
let pendingRunValue = null;
let cloudPin = localStorage.getItem(CLOUD_PIN_STORAGE_KEY) || "";
let syncTimer = null;
let cloudSaveTimer = null;
let applyingRemoteState = false;
let lastRemoteUpdatedAt = 0;

function createDefaultState() {
  return {
    matchStarted: false,
    matchComplete: false,
    totalOvers: 20,
    currentInningsIndex: 0,
    viewingInningsIndex: null,
    target: null,
    result: "Match not finished",
    selectedStriker: "",
    selectedNonStriker: "",
    selectedBowler: "",
    history: [],
    teams: [
      { name: "Team 1", players: [] },
      { name: "Team 2", players: [] }
    ],
    innings: []
  };
}

// Match data lives here. It can stay local, or sync to Firebase when a PIN is active.
const state = createDefaultState();

const $ = (id) => document.getElementById(id);

const matchStatus = $("matchStatus");
const scoreValue = $("scoreValue");
const scoreContext = $("scoreContext");
const battingLabel = $("battingLabel");
const oversValue = $("oversValue");
const runRateValue = $("runRateValue");
const targetValue = $("targetValue");
const requiredRateValue = $("requiredRateValue");
const scoreHint = $("scoreHint");

function persistMatch() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to save match data locally.", error);
  }

  if (cloudPin && isCloudConfigured() && !applyingRemoteState) {
    scheduleCloudSave();
  }
}

function isCloudConfigured() {
  return Boolean(db);
}

function matchCloudRef(pin = cloudPin) {
  return doc(db, "matches", String(pin));
}

function updateSyncStatus(message) {
  const status = $("syncStatus");
  if (status) status.textContent = message;
  const pinValue = $("activePinValue");
  if (pinValue) pinValue.textContent = cloudPin || "----";
  const joinInput = $("joinPinInput");
  if (joinInput && cloudPin && joinInput.value !== cloudPin) joinInput.value = cloudPin;
}

function cloudReadyMessage() {
  if (!isCloudConfigured()) return "Local only. Firebase is not configured.";
  if (!cloudPin) return "Online database ready. Create a PIN or join an existing match.";
  return `Online sync active for PIN ${cloudPin}. Other devices can join with this PIN.`;
}

function exportCloudState() {
  const cloned = JSON.parse(JSON.stringify(state));
  cloned.history = [];
  cloned.viewingInningsIndex = null;
  return cloned;
}

function scheduleCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(saveMatchToCloud, CLOUD_SAVE_DEBOUNCE_MS);
}

async function saveMatchToCloud() {
  if (!cloudPin || !isCloudConfigured() || applyingRemoteState) return;

  const updatedAt = Date.now();
  const payload = {
    pin: cloudPin,
    updatedAt,
    state: exportCloudState()
  };

  try {
    await setDoc(matchCloudRef(), payload);
    lastRemoteUpdatedAt = updatedAt;
    updateSyncStatus(`Saved online under PIN ${cloudPin}.`);
  } catch (error) {
    console.error(error);
    updateSyncStatus("Online save failed. Check Firestore rules, then try again.");
  }
}

async function fetchCloudMatch(pin) {
  const snapshot = await getDoc(matchCloudRef(pin));
  return snapshot.exists() ? snapshot.data() : null;
}

function applyRemoteState(remoteState, updatedAt = Date.now()) {
  applyingRemoteState = true;
  try {
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, createDefaultState(), remoteState);
    state.viewingInningsIndex = null;
    normalizeLoadedState();
    lastRemoteUpdatedAt = Math.max(lastRemoteUpdatedAt, Number(updatedAt) || Date.now());
    render();
  } finally {
    applyingRemoteState = false;
  }
}

async function loadMatchFromCloud(pin) {
  const normalizedPin = String(pin || "").replace(/\D/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(normalizedPin)) {
    updateSyncStatus("Enter a valid 4-digit PIN.");
    return;
  }
  if (!isCloudConfigured()) {
    updateSyncStatus("Firebase is not configured.");
    return;
  }

  try {
    const remote = await fetchCloudMatch(normalizedPin);
    if (!remote?.state) {
      updateSyncStatus(`No match found for PIN ${normalizedPin}.`);
      return;
    }

    cloudPin = normalizedPin;
    localStorage.setItem(CLOUD_PIN_STORAGE_KEY, cloudPin);
    applyRemoteState(remote.state, remote.updatedAt);
    startCloudPolling();
    updateSyncStatus(`Joined online match with PIN ${cloudPin}.`);
  } catch (error) {
    console.error(error);
    updateSyncStatus("Unable to join PIN. Check internet and Firestore rules.");
  }
}

async function createOnlineMatch() {
  if (!isCloudConfigured()) {
    updateSyncStatus("Firebase is not configured.");
    return;
  }

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidatePin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const existing = await fetchCloudMatch(candidatePin);
      if (existing) continue;

      cloudPin = candidatePin;
      localStorage.setItem(CLOUD_PIN_STORAGE_KEY, cloudPin);
      await saveMatchToCloud();
      startCloudPolling();
      updateSyncStatus(`Created online match. Share PIN ${cloudPin}.`);
      renderCloudControls();
      return;
        } catch (error) {
          console.error(error);
          updateSyncStatus("Unable to create PIN. Check Firestore rules, then try again.");
          return;
        }
  }

  updateSyncStatus("Could not find an unused 4-digit PIN. Try again.");
}

async function pollCloudMatch() {
  if (!cloudPin || !isCloudConfigured() || applyingRemoteState) return;

  try {
    const remote = await fetchCloudMatch(cloudPin);
    if (!remote?.state) return;
    const remoteUpdatedAt = Number(remote.updatedAt) || 0;
    if (remoteUpdatedAt > lastRemoteUpdatedAt) {
      applyRemoteState(remote.state, remoteUpdatedAt);
      updateSyncStatus(`Loaded latest online update for PIN ${cloudPin}.`);
    }
  } catch (error) {
    console.warn("Cloud polling failed.", error);
  }
}

function startCloudPolling() {
  clearInterval(syncTimer);
  if (cloudPin && isCloudConfigured()) {
    syncTimer = setInterval(pollCloudMatch, CLOUD_SYNC_INTERVAL_MS);
  }
  renderCloudControls();
}

function leaveOnlineMatch() {
  cloudPin = "";
  lastRemoteUpdatedAt = 0;
  clearInterval(syncTimer);
  clearTimeout(cloudSaveTimer);
  localStorage.removeItem(CLOUD_PIN_STORAGE_KEY);
  renderCloudControls();
  updateSyncStatus(cloudReadyMessage());
}

function renderCloudControls() {
  updateSyncStatus(cloudReadyMessage());
  const createBtn = $("createOnlineMatchBtn");
  const joinBtn = $("joinOnlineMatchBtn");
  const copyBtn = $("copyPinBtn");
  const leaveBtn = $("leaveOnlineMatchBtn");
  [createBtn, joinBtn].forEach((button) => {
    if (button) button.disabled = !isCloudConfigured();
  });
  if (copyBtn) copyBtn.disabled = !cloudPin;
  if (leaveBtn) leaveBtn.disabled = !cloudPin;
}

function loadSavedMatch() {
  try {
    const savedMatch = localStorage.getItem(STORAGE_KEY);
    if (!savedMatch) return;

    const restored = JSON.parse(savedMatch);
    Object.assign(state, createDefaultState(), restored);
    normalizeLoadedState();
  } catch (error) {
    console.warn("Unable to restore saved match data.", error);
    resetMatch();
  }
}

function normalizeLoadedState() {
  const fallback = createDefaultState();
  state.totalOvers = Math.max(1, Number(state.totalOvers) || fallback.totalOvers);
  state.currentInningsIndex = Math.max(0, Number(state.currentInningsIndex) || 0);
  state.target = state.target === null ? null : Math.max(0, Number(state.target) || 0);
  state.result = typeof state.result === "string" ? state.result : fallback.result;
  state.matchStarted = Boolean(state.matchStarted);
  state.matchComplete = Boolean(state.matchComplete);
  state.history = Array.isArray(state.history) ? state.history.filter((item) => typeof item === "string") : [];
  state.teams = Array.isArray(state.teams) ? state.teams.slice(0, 2) : fallback.teams;

  while (state.teams.length < 2) {
    state.teams.push({ ...fallback.teams[state.teams.length], players: [] });
  }

  state.teams = state.teams.map((team, index) => ({
    name: typeof team?.name === "string" ? team.name : `Team ${index + 1}`,
    players: Array.isArray(team?.players) ? team.players.slice(0, 11).filter((player) => player?.id && player?.name) : []
  }));

  state.innings = Array.isArray(state.innings) ? state.innings.filter(Boolean).slice(0, 2).map((inning) => ({
    battingTeam: Number(inning.battingTeam) === 1 ? 1 : 0,
    bowlingTeam: Number(inning.bowlingTeam) === 0 ? 0 : 1,
    runs: Math.max(0, Number(inning.runs) || 0),
    wickets: Math.min(10, Math.max(0, Number(inning.wickets) || 0)),
    legalBalls: Math.max(0, Number(inning.legalBalls) || 0),
    freeHit: Boolean(inning.freeHit),
    extras: {
      wides: Math.max(0, Number(inning.extras?.wides) || 0),
      noBalls: Math.max(0, Number(inning.extras?.noBalls) || 0),
      byes: Math.max(0, Number(inning.extras?.byes) || 0),
      legByes: Math.max(0, Number(inning.extras?.legByes) || 0),
      overthrows: Math.max(0, Number(inning.extras?.overthrows) || 0)
    },
    previousBowler: typeof inning.previousBowler === "string" ? inning.previousBowler : "",
    batting: inning.batting && typeof inning.batting === "object" ? inning.batting : {},
    bowling: inning.bowling && typeof inning.bowling === "object" ? inning.bowling : {},
    fallOfWickets: Array.isArray(inning.fallOfWickets) ? inning.fallOfWickets : [],
    timeline: Array.isArray(inning.timeline) ? inning.timeline : []
  })) : [];

  state.innings.forEach((inning) => {
    if (inning.battingTeam === inning.bowlingTeam) {
      inning.bowlingTeam = inning.battingTeam === 0 ? 1 : 0;
    }
  });
  state.currentInningsIndex = Math.min(state.currentInningsIndex, Math.max(0, state.innings.length - 1));
  state.viewingInningsIndex = Number.isInteger(state.viewingInningsIndex) && state.innings[state.viewingInningsIndex] ? state.viewingInningsIndex : null;
  if (state.matchStarted && !state.innings.length) {
    state.matchStarted = false;
  }
  if (state.matchComplete && state.innings.length < 2) {
    state.matchComplete = false;
    state.result = fallback.result;
  }
  validateCurrentSelections();
}

function resetMatch() {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, createDefaultState());
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear saved match data.", error);
  }
  skipNextSave = true;
  render();
}

function oversText(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function nextBallLabel(inning) {
  return `${Math.floor(inning.legalBalls / 6)}.${(inning.legalBalls % 6) + 1}`;
}

function rate(runs, balls) {
  return balls > 0 ? (runs / (balls / 6)).toFixed(2) : "0.00";
}

function createPlayer(name, teamIndex) {
  return {
    id: `t${teamIndex}p${Date.now()}${Math.random().toString(16).slice(2)}`,
    name
  };
}

function createInnings(battingTeam, bowlingTeam) {
  return {
    battingTeam,
    bowlingTeam,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    freeHit: false,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, overthrows: 0 },
    previousBowler: "",
    batting: {},
    bowling: {},
    fallOfWickets: [],
    timeline: []
  };
}

function currentInnings() {
  return state.innings[state.currentInningsIndex] || null;
}

function displayedInnings() {
  if (state.viewingInningsIndex !== null && state.innings[state.viewingInningsIndex]) {
    return state.innings[state.viewingInningsIndex];
  }
  return currentInnings();
}

function isViewingLiveInnings() {
  return state.viewingInningsIndex === null;
}

function teamName(index) {
  const rawName = state.teams[index]?.name || "";
  return rawName.trim() || `Team ${index + 1}`;
}

function getBattingStat(playerId, inning = currentInnings()) {
  if (!inning.batting[playerId]) {
    inning.batting[playerId] = {
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      out: false,
      retired: false,
      retiredOut: false,
      dismissal: "",
      fielderId: "",
      bowlerId: ""
    };
  }
  inning.batting[playerId].retired = Boolean(inning.batting[playerId].retired);
  inning.batting[playerId].retiredOut = Boolean(inning.batting[playerId].retiredOut);
  inning.batting[playerId].dismissal = inning.batting[playerId].dismissal || "";
  inning.batting[playerId].fielderId = inning.batting[playerId].fielderId || "";
  inning.batting[playerId].bowlerId = inning.batting[playerId].bowlerId || "";
  return inning.batting[playerId];
}

function getBowlingStat(playerId, inning = currentInnings()) {
  if (!inning.bowling[playerId]) {
    inning.bowling[playerId] = {
      balls: 0,
      maidens: 0,
      runs: 0,
      wickets: 0,
      wides: 0,
      noBalls: 0,
      currentOverRuns: 0
    };
  }
  inning.bowling[playerId].wides = Math.max(0, Number(inning.bowling[playerId].wides) || 0);
  inning.bowling[playerId].noBalls = Math.max(0, Number(inning.bowling[playerId].noBalls) || 0);
  return inning.bowling[playerId];
}

function readBattingStat(playerId, inning = currentInnings()) {
  return inning?.batting[playerId] || {
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    out: false,
    retired: false,
    retiredOut: false,
    dismissal: "",
    fielderId: "",
    bowlerId: ""
  };
}

function readBowlingStat(playerId, inning = currentInnings()) {
  return inning?.bowling[playerId] || {
    balls: 0,
    maidens: 0,
    runs: 0,
    wickets: 0,
    wides: 0,
    noBalls: 0,
    currentOverRuns: 0
  };
}

function playerById(playerId) {
  for (const team of state.teams) {
    const player = team.players.find((item) => item.id === playerId);
    if (player) return player;
  }
  return null;
}

function playerName(playerId) {
  return playerById(playerId)?.name || "Unknown player";
}

// Store a full snapshot before scoring actions so undo is dependable.
function saveHistory() {
  const snapshot = JSON.stringify({ ...state, history: [] });
  state.history.push(snapshot);
  if (state.history.length > MAX_UNDO_HISTORY) {
    state.history.shift();
  }
}

function hasBowlingAlternative(inning = currentInnings()) {
  if (!inning) return false;
  return state.teams[inning.bowlingTeam]?.players.some((player) => player.id !== inning.previousBowler) || false;
}

function isWaitingForNewBowler(inning = currentInnings()) {
  return Boolean(
    inning &&
    !state.matchComplete &&
    inning.previousBowler &&
    inning.legalBalls > 0 &&
    inning.legalBalls % 6 === 0 &&
    !state.selectedBowler &&
    hasBowlingAlternative(inning)
  );
}


function bowlerQuotaBalls() {
  return Math.floor((Number(state.totalOvers) || 0) * 6 / 5);
}

function bowlerQuotaStatus(playerId, inning = currentInnings()) {
  const quota = bowlerQuotaBalls();
  const stat = readBowlingStat(playerId, inning);
  return {
    quota,
    reached: quota > 0 && stat.balls >= quota,
    remaining: Math.max(0, quota - stat.balls)
  };
}

function teamBoundaryStats(teamIndex) {
  const inning = inningsForTeam(teamIndex);
  if (!inning) return { fours: 0, sixes: 0, total: 0 };
  return Object.values(inning.batting || {}).reduce((total, stat) => {
    total.fours += Math.max(0, Number(stat.fours) || 0);
    total.sixes += Math.max(0, Number(stat.sixes) || 0);
    total.total = total.fours + total.sixes;
    return total;
  }, { fours: 0, sixes: 0, total: 0 });
}

function consumeFreeHitIfLegalDelivery(inning) {
  if (inning) inning.freeHit = false;
}

function selectedPlayerIsAvailable(playerId, teamIndex, inning, role) {
  const playerExists = state.teams[teamIndex]?.players.some((player) => player.id === playerId);
  if (!playerExists) return false;
  if (role === "bowler") {
    return !hasBowlingAlternative(inning) || playerId !== inning.previousBowler;
  }
  if (role !== "batter") return true;
  const stat = readBattingStat(playerId, inning);
  // Retired-hurt batters are not out, so allow them to be selected again.
  return !stat.out;
}

function validateCurrentSelections() {
  const inning = currentInnings();
  if (!inning) {
    state.selectedStriker = "";
    state.selectedNonStriker = "";
    state.selectedBowler = "";
    return;
  }

  if (!selectedPlayerIsAvailable(state.selectedStriker, inning.battingTeam, inning, "batter")) {
    state.selectedStriker = "";
  }
  if (!selectedPlayerIsAvailable(state.selectedNonStriker, inning.battingTeam, inning, "batter")) {
    state.selectedNonStriker = "";
  }
  if (!selectedPlayerIsAvailable(state.selectedBowler, inning.bowlingTeam, inning, "bowler")) {
    state.selectedBowler = "";
  }
  if (state.selectedStriker && state.selectedStriker === state.selectedNonStriker) {
    state.selectedNonStriker = "";
  }
  pickDefaultPlayers();
}

function scoreReadinessMessage() {
  const inning = currentInnings();
  if (!state.matchStarted) return "Create a match and select striker, non-striker, and bowler";
  if (state.matchComplete) return "Match finished";
  if (!inning) return "Create a match to begin scoring";

  const availableBatters = state.teams[inning.battingTeam].players.filter((player) => !readBattingStat(player.id, inning).out);
  const bowlers = state.teams[inning.bowlingTeam].players;

  if (inning.legalBalls >= state.totalOvers * 6) return "Overs complete. End the innings to continue.";
  if (isWaitingForNewBowler(inning)) {
    return `Over complete. Select a new bowler; ${playerName(inning.previousBowler)} cannot bowl consecutive overs.`;
  }
  if (inning.previousBowler && inning.legalBalls > 0 && inning.legalBalls % 6 === 0 && bowlers.length === 1) {
    return "Casual mode: only one bowler is available, so consecutive overs are allowed. Add more bowlers for standard rules.";
  }
  if (availableBatters.length < 2) return "Add or select two not-out batters to score.";
  if (!state.selectedStriker || !state.selectedNonStriker) return "Select striker and non-striker.";
  if (state.selectedStriker === state.selectedNonStriker) return "Striker and non-striker must be different players.";
  if (!bowlers.length) return "Add a bowler to the bowling team.";
  if (!state.selectedBowler) return "Select a bowler.";
  return "Create a match and select striker, non-striker, and bowler";
}

function canScore() {
  const inning = currentInnings();
  if (!inning || inning.legalBalls >= state.totalOvers * 6) return false;

  return Boolean(
    state.matchStarted &&
    !state.matchComplete &&
    state.selectedStriker &&
    state.selectedNonStriker &&
    state.selectedBowler &&
    state.selectedStriker !== state.selectedNonStriker &&
    selectedPlayerIsAvailable(state.selectedStriker, inning.battingTeam, inning, "batter") &&
    selectedPlayerIsAvailable(state.selectedNonStriker, inning.battingTeam, inning, "batter") &&
    selectedPlayerIsAvailable(state.selectedBowler, inning.bowlingTeam, inning, "bowler")
  );
}

function addTimeline(type, text, label) {
  const inning = currentInnings();
  inning.timeline.unshift({
    type,
    text,
    label: label || nextBallLabel(inning)
  });
}

function swapStrike() {
  const current = state.selectedStriker;
  state.selectedStriker = state.selectedNonStriker;
  state.selectedNonStriker = current;
}

function manualSwapStrike() {
  if (!state.matchStarted || state.matchComplete || !state.selectedStriker || !state.selectedNonStriker) return;
  saveHistory();
  swapStrike();
  render();
}

function returnRetiredBatterIfSelected(playerId) {
  const inning = currentInnings();
  if (!inning || !playerId) return;
  const stat = getBattingStat(playerId, inning);
  if (stat.retired && !stat.out) {
    stat.retired = false;
    addTimeline("info", `${playerName(playerId)} returns to the crease`, oversText(inning.legalBalls));
  }
}

function selectNextBatter() {
  const inning = currentInnings();
  const battingTeam = state.teams[inning.battingTeam];
  const nextActive = battingTeam.players.find((player) => {
    const stat = readBattingStat(player.id, inning);
    return !stat.out && !stat.retired && player.id !== state.selectedNonStriker;
  });
  const returningRetired = battingTeam.players.find((player) => {
    const stat = readBattingStat(player.id, inning);
    return !stat.out && stat.retired && player.id !== state.selectedNonStriker;
  });
  state.selectedStriker = nextActive ? nextActive.id : returningRetired ? returningRetired.id : "";
  if (returningRetired && state.selectedStriker === returningRetired.id) {
    getBattingStat(returningRetired.id, inning).retired = false;
  }
}

// Legal balls advance the over, update bowler figures, and handle strike changes.
function completeLegalBall(runsForStrikeSwap) {
  const inning = currentInnings();
  const bowlerId = state.selectedBowler;
  const bowler = getBowlingStat(bowlerId, inning);
  const wasFreeHit = Boolean(inning.freeHit);

  inning.legalBalls += 1;
  bowler.balls += 1;
  const overComplete = inning.legalBalls % 6 === 0;

  if (runsForStrikeSwap % 2 === 1) {
    swapStrike();
  }

  if (overComplete) {
    if (bowler.currentOverRuns === 0) {
      bowler.maidens += 1;
    }
    bowler.currentOverRuns = 0;
    swapStrike();
  }

  if (wasFreeHit) {
    consumeFreeHitIfLegalDelivery(inning);
  }

  checkInningsProgress();

  if (overComplete && currentInnings() === inning && !state.matchComplete) {
    inning.previousBowler = bowlerId;
    state.selectedBowler = "";
    addTimeline("over", `Over complete: select a new bowler after ${playerName(bowlerId)}`, oversText(inning.legalBalls));
  }
}

function scoreRun(runs, overthrowRuns = 0) {
  if (!canScore()) return;
  saveHistory();

  const inning = currentInnings();
  const batter = getBattingStat(state.selectedStriker, inning);
  const bowler = getBowlingStat(state.selectedBowler, inning);
  const label = nextBallLabel(inning);
  const batRuns = Math.max(0, Number(runs) || 0);
  const overthrow = Math.max(0, Number(overthrowRuns) || 0);
  const totalRuns = batRuns + overthrow;

  inning.runs += totalRuns;
  batter.runs += totalRuns;
  batter.balls += 1;
  if (totalRuns === 4) batter.fours += 1;
  if (totalRuns === 6) batter.sixes += 1;
  bowler.runs += totalRuns;
  bowler.currentOverRuns += totalRuns;

  addTimeline(
    "run",
    `${playerName(state.selectedStriker)} scores ${batRuns}${overthrow ? ` + ${overthrow} overthrow${overthrow === 1 ? "" : "s"}` : ""} = ${totalRuns} run${totalRuns === 1 ? "" : "s"}`,
    label
  );
  completeLegalBall(totalRuns);
  render();
}

function openExtraPopup(type) {
  if (!canScore()) return;
  pendingExtraType = type;
  pendingRunValue = null;

  const isPenaltyExtra = type === "wide" || type === "noBall";
  const defaultCompletedRuns = isPenaltyExtra ? 0 : 1;
  const completedLabel = type === "noBall" ? "Runs off bat" : "Runs completed";

  $("extraPopupTitle").textContent = `${extraLabels[type]} Runs`;
  $("extraPopupHelp").textContent = isPenaltyExtra
    ? "The penalty run is added automatically. Enter all runs for this same delivery."
    : "Enter completed runs and any overthrow runs for this same legal delivery.";
  $("extraRunButtons").innerHTML = `
    <div class="field">
      <label>${completedLabel}</label>
      <input id="completedRunsInput" type="number" min="0" max="6" value="${defaultCompletedRuns}" />
    </div>
    <div class="field" style="margin-top:10px;">
      <label>Overthrow Runs</label>
      <input id="extraOverthrowInput" type="number" min="0" max="6" value="0" />
    </div>
    <button class="primary-btn" id="confirmDeliveryRunsBtn" style="margin-top:10px;">Add Runs</button>
  `;
  $("extraPopup").classList.add("show");
}

function closeExtraPopup() {
  pendingExtraType = "";
  pendingRunValue = null;
  $("extraPopup").classList.remove("show");
  $("extraRunButtons").innerHTML = "";
}

function scoreExtra(type, completedRuns, overthrowRuns = 0) {
  if (!canScore()) return;
  saveHistory();

  const inning = currentInnings();
  const bowler = getBowlingStat(state.selectedBowler, inning);
  const label = nextBallLabel(inning);
  const completed = Math.max(0, Number(completedRuns) || 0);
  const overthrow = Math.max(0, Number(overthrowRuns) || 0);

  if (type === "wide") {
    const totalRuns = 1 + completed + overthrow;
    inning.runs += totalRuns;
    inning.extras.wides += totalRuns;
    bowler.wides += totalRuns;
    bowler.runs += totalRuns;
    bowler.currentOverRuns += totalRuns;

    if ((completed + overthrow) % 2 === 1) swapStrike();
    addTimeline(
      "extra",
      `Wide: 1 penalty + ${completed} run${completed === 1 ? "" : "s"}${overthrow ? ` + ${overthrow} overthrow` : ""} = ${totalRuns} wide run${totalRuns === 1 ? "" : "s"}`,
      label
    );
    checkInningsProgress();
  }

  if (type === "noBall") {
    const batterRuns = completed + overthrow;
    const totalRuns = 1 + batterRuns;
    const batter = getBattingStat(state.selectedStriker, inning);

    inning.runs += totalRuns;
    inning.extras.noBalls += 1;
    inning.freeHit = true;
    bowler.noBalls += 1;
    batter.runs += batterRuns;
    batter.balls += 1;
    if (batterRuns === 4) batter.fours += 1;
    if (batterRuns === 6) batter.sixes += 1;
    bowler.runs += totalRuns;
    bowler.currentOverRuns += totalRuns;

    if (batterRuns % 2 === 1) swapStrike();
    addTimeline(
      "extra",
      `No Ball: 1 penalty + ${completed} bat run${completed === 1 ? "" : "s"}${overthrow ? ` + ${overthrow} overthrow` : ""} = ${totalRuns} total. Free hit next ball.`,
      label
    );
    checkInningsProgress();
  }

  if (type === "bye" || type === "legBye") {
    const totalRuns = completed + overthrow;
    const batter = getBattingStat(state.selectedStriker, inning);

    inning.runs += totalRuns;
    batter.balls += 1;
    if (type === "bye") inning.extras.byes += totalRuns;
    if (type === "legBye") inning.extras.legByes += totalRuns;

    addTimeline(
      "extra",
      `${extraLabels[type]}: ${completed} run${completed === 1 ? "" : "s"}${overthrow ? ` + ${overthrow} overthrow` : ""} = ${totalRuns} extra run${totalRuns === 1 ? "" : "s"}`,
      label
    );
    completeLegalBall(totalRuns);
  }

  render();
}

function dismissalLabel(type) {
  const labels = {
    bowled: "b",
    caught: "c",
    lbw: "lbw",
    stumped: "st",
    hitWicket: "hit wicket",
    runOut: "run out",
    retiredHurt: "retired hurt",
    retiredOut: "retired out"
  };
  return labels[type] || "out";
}

function bowlerGetsWicketCredit(type) {
  return ["bowled", "caught", "lbw", "stumped", "hitWicket"].includes(type);
}

function dismissalText(stat, playerId = "") {
  if (stat.retired && playerId !== state.selectedStriker && playerId !== state.selectedNonStriker) return "Retired hurt";
  if (!stat.out) return "Not Out";

  const type = stat.dismissal || "out";
  const bowler = stat.bowlerId ? playerName(stat.bowlerId) : "";
  const fielder = stat.fielderId ? playerName(stat.fielderId) : "";

  if (type === "bowled") return `b ${bowler}`;
  if (type === "lbw") return `lbw b ${bowler}`;
  if (type === "caught") return `c ${fielder || "fielder"} b ${bowler}`;
  if (type === "stumped") return `st ${fielder || "keeper"} b ${bowler}`;
  if (type === "hitWicket") return `hit wicket b ${bowler}`;
  if (type === "runOut") return `run out${fielder ? ` (${fielder})` : ""}`;
  if (type === "retiredOut") return "retired out";
  return "Out";
}

function openWicketPopup() {
  if (!canScore()) return;
  const inning = currentInnings();
  const fielders = state.teams[inning.bowlingTeam].players;
  $("fielderSelect").innerHTML = '<option value="">No fielder / not applicable</option>' + fielders.map((player) => (
    `<option value="${player.id}">${escapeHtml(player.name)}</option>`
  )).join("");
  $("dismissalTypeSelect").value = inning.freeHit ? "runOut" : "bowled";
  if ($("wicketDeliveryTypeSelect")) $("wicketDeliveryTypeSelect").value = "legal";
  $("wicketPopup").classList.add("show");
}

function closeWicketPopup() {
  $("wicketPopup").classList.remove("show");
}

function scoreWicket(method = "bowled", fielderId = "", deliveryType = "legal") {
  if (!canScore()) return;

  const inning = currentInnings();
  const isFreeHit = Boolean(inning.freeHit);
  const legalDelivery = deliveryType === "legal";
  const validFreeHitDismissals = ["runOut", "retiredHurt", "retiredOut"];
  const validNoBallDismissals = ["runOut", "retiredHurt", "retiredOut"];
  const validWideDismissals = ["stumped", "runOut", "retiredHurt", "retiredOut"];

  if (isFreeHit && !validFreeHitDismissals.includes(method)) {
    alert("On a free hit, this dismissal is not allowed. Use Run Out, Retired Hurt, or Retired Out if applicable.");
    return;
  }
  if (deliveryType === "noBall" && !validNoBallDismissals.includes(method)) {
    alert("On a no-ball wicket, use Run Out, Retired Hurt, or Retired Out.");
    return;
  }
  if (deliveryType === "wide" && !validWideDismissals.includes(method)) {
    alert("On a wide wicket, use Stumped, Run Out, Retired Hurt, or Retired Out.");
    return;
  }

  saveHistory();

  const batter = getBattingStat(state.selectedStriker, inning);
  const bowler = getBowlingStat(state.selectedBowler, inning);
  const outPlayer = state.selectedStriker;
  const label = nextBallLabel(inning);

  if (method === "retiredHurt") {
    batter.retired = true;
    batter.dismissal = method;
    addTimeline("wicket", `Retired hurt: ${playerName(outPlayer)} leaves the field`, oversText(inning.legalBalls));
    selectNextBatter();
    render();
    return;
  }

  if (method === "retiredOut") {
    batter.out = true;
    batter.retired = false;
    batter.retiredOut = true;
    batter.dismissal = method;
    inning.wickets += 1;
    inning.fallOfWickets.push({
      wicketNumber: inning.wickets,
      score: inning.runs,
      batterId: outPlayer,
      over: oversText(inning.legalBalls),
      method,
      fielderId: "",
      bowlerId: ""
    });
    addTimeline("wicket", `Retired out: ${playerName(outPlayer)} is out`, oversText(inning.legalBalls));
    selectNextBatter();
    checkInningsProgress();
    render();
    return;
  }

  if (deliveryType === "wide") {
    inning.runs += 1;
    inning.extras.wides += 1;
    bowler.wides += 1;
    bowler.runs += 1;
    bowler.currentOverRuns += 1;
  }

  if (deliveryType === "noBall") {
    inning.runs += 1;
    inning.extras.noBalls += 1;
    inning.freeHit = true;
    bowler.noBalls += 1;
    bowler.runs += 1;
    bowler.currentOverRuns += 1;
    batter.balls += 1;
  }

  if (legalDelivery) {
    batter.balls += 1;
  }

  batter.out = true;
  batter.retired = false;
  batter.dismissal = method;
  batter.fielderId = fielderId || "";
  batter.bowlerId = bowlerGetsWicketCredit(method) ? state.selectedBowler : "";
  inning.wickets += 1;

  if (bowlerGetsWicketCredit(method)) {
    bowler.wickets += 1;
  }

  inning.fallOfWickets.push({
    wicketNumber: inning.wickets,
    score: inning.runs,
    batterId: outPlayer,
    over: legalDelivery ? label : oversText(inning.legalBalls),
    method,
    fielderId: fielderId || "",
    bowlerId: batter.bowlerId
  });

  const prefix = deliveryType === "wide" ? "Wide + " : deliveryType === "noBall" ? "No Ball + " : "";
  addTimeline("wicket", `${prefix}Wicket: ${playerName(outPlayer)} ${dismissalText(batter)}`, legalDelivery ? label : oversText(inning.legalBalls));
  selectNextBatter();

  if (legalDelivery) {
    completeLegalBall(0);
  } else {
    checkInningsProgress();
  }

  render();
}

function checkInningsProgress() {
  const inning = currentInnings();
  if (!inning || state.matchComplete) return;

  const inningsBalls = state.totalOvers * 6;
  const targetReached = state.currentInningsIndex === 1 && state.target && inning.runs >= state.target;

  if (inning.wickets >= 10 || inning.legalBalls >= inningsBalls || targetReached) {
    finishInnings();
  }
}

// First innings creates a target; second innings completes the match result.
function finishInnings() {
  if (!state.matchStarted || state.matchComplete) return;

  const inning = currentInnings();
  if (state.currentInningsIndex === 0) {
    state.target = inning.runs + 1;
    state.currentInningsIndex = 1;
    state.viewingInningsIndex = null;
    state.innings.push(createInnings(inning.bowlingTeam, inning.battingTeam));
    state.selectedStriker = "";
    state.selectedNonStriker = "";
    state.selectedBowler = "";
    pickDefaultPlayers();
  } else {
    state.matchComplete = true;
    state.result = calculateResult();
  }
}

function calculateResult() {
  const first = state.innings[0];
  const second = state.innings[1];
  const firstTeam = teamName(first.battingTeam);
  const secondTeam = teamName(second.battingTeam);

  if (second.runs >= state.target) {
    return `${secondTeam} won by ${10 - second.wickets} wicket${10 - second.wickets === 1 ? "" : "s"}`;
  }

  if (second.runs === first.runs) {
    return "Match tied";
  }

  const margin = first.runs - second.runs;
  return `${firstTeam} won by ${margin} run${margin === 1 ? "" : "s"}`;
}

function syncBowlingTeamWithBatting() {
  const battingTeam = Number($("battingTeamSelect").value);
  const bowlingTeamSelect = $("bowlingTeamSelect");
  if (!bowlingTeamSelect) return;
  if (Number(bowlingTeamSelect.value) === battingTeam) {
    bowlingTeamSelect.value = battingTeam === 0 ? "1" : "0";
  }
}

function syncBattingTeamWithBowling() {
  const bowlingTeam = Number($("bowlingTeamSelect").value);
  const battingTeamSelect = $("battingTeamSelect");
  if (!battingTeamSelect) return;
  if (Number(battingTeamSelect.value) === bowlingTeam) {
    battingTeamSelect.value = bowlingTeam === 0 ? "1" : "0";
  }
}

function createOrResetMatch() {
  const team0 = $("team1Name").value.trim();
  const team1 = $("team2Name").value.trim();
  const overs = Math.max(1, Number($("totalOvers").value) || 20);
  syncBowlingTeamWithBatting();
  const battingTeam = Number($("battingTeamSelect").value);
  const bowlingTeam = Number($("bowlingTeamSelect").value);

  if (battingTeam === bowlingTeam) {
    alert("Batting and bowling teams must be different.");
    return;
  }

  state.teams[0].name = team0;
  state.teams[1].name = team1;
  state.totalOvers = overs;
  state.matchStarted = true;
  state.matchComplete = false;
  state.currentInningsIndex = 0;
  state.viewingInningsIndex = null;
  state.target = null;
  state.result = "Match not finished";
  state.history = [];
  state.innings = [createInnings(battingTeam, bowlingTeam)];
  state.selectedStriker = "";
  state.selectedNonStriker = "";
  state.selectedBowler = "";
  pickDefaultPlayers();
  render();
}

function pickDefaultPlayers() {
  const inning = currentInnings();
  if (!inning) return;
  const batters = state.teams[inning.battingTeam].players;
  const bowlers = state.teams[inning.bowlingTeam].players;
  const availableBatters = batters.filter((player) => !readBattingStat(player.id, inning).out);
  const availableBowlers = bowlers.filter((player) => selectedPlayerIsAvailable(player.id, inning.bowlingTeam, inning, "bowler"));

  if (!state.selectedStriker && availableBatters[0]) state.selectedStriker = availableBatters[0].id;
  if (!state.selectedNonStriker) {
    const nextNonStriker = availableBatters.find((player) => player.id !== state.selectedStriker);
    if (nextNonStriker) state.selectedNonStriker = nextNonStriker.id;
  }
  if (!state.selectedBowler && availableBowlers[0] && !isWaitingForNewBowler(inning)) {
    state.selectedBowler = availableBowlers[0].id;
  }
}

function addPlayer(teamIndex) {
  const input = $(`team${teamIndex}PlayerInput`);
  const name = input.value.trim();
  if (!name) return;

  if (state.teams[teamIndex].players.length >= 11) {
    alert("Each team can have 11 players.");
    return;
  }

  const nameExists = state.teams[teamIndex].players.some((player) => player.name.toLowerCase() === name.toLowerCase());
  if (nameExists) {
    alert("This player is already in the team.");
    return;
  }

  state.teams[teamIndex].players.push(createPlayer(name, teamIndex));
  input.value = "";
  validateCurrentSelections();
  render();
}

function undoLastBall() {
  if (!state.history.length) return;
  const snapshot = state.history.pop();
  const remainingHistory = state.history.slice();
  const restored = JSON.parse(snapshot);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, createDefaultState(), restored);
  state.history = remainingHistory;
  validateCurrentSelections();
  render();
}

function inningsForTeam(teamIndex) {
  return state.innings.find((inning) => inning.battingTeam === teamIndex);
}

function scoreLineForTeam(teamIndex) {
  const inning = inningsForTeam(teamIndex);
  if (!inning) return "0/0 (0.0)";
  return `${inning.runs}/${inning.wickets} (${oversText(inning.legalBalls)})`;
}

function extrasTotal(inning) {
  if (!inning) return 0;
  return inning.extras.wides + inning.extras.noBalls + inning.extras.byes + inning.extras.legByes + (inning.extras.overthrows || 0);
}

function requiredRate() {
  const inning = currentInnings();
  if (!inning || state.matchComplete || state.currentInningsIndex !== 1 || !state.target) return "--";
  const runsNeeded = Math.max(0, state.target - inning.runs);
  const ballsLeft = Math.max(0, state.totalOvers * 6 - inning.legalBalls);
  return ballsLeft > 0 ? (runsNeeded / (ballsLeft / 6)).toFixed(2) : "--";
}

function optionHtml(players, selectedValue, inning, role) {
  const options = ['<option value="">Select player</option>'];
  players.forEach((player) => {
    const selected = player.id === selectedValue ? "selected" : "";
    const batterStat = readBattingStat(player.id, inning);
    const isOut = role === "batter" && batterStat.out;
    const isRetired = role === "batter" && batterStat.retired;
    const bowledPreviousOver = role === "bowler" && !selectedPlayerIsAvailable(player.id, inning.bowlingTeam, inning, "bowler");
    const quota = role === "bowler" ? bowlerQuotaStatus(player.id, inning) : { reached: false };
    const disabled = isOut || bowledPreviousOver ? "disabled" : "";
    const status = isOut
      ? " (Out)"
      : isRetired
        ? " (Retired - can return)"
        : bowledPreviousOver
          ? " (Previous over)"
          : quota.reached
            ? " (Quota reached)"
            : "";
    options.push(`<option value="${player.id}" ${selected} ${disabled}>${escapeHtml(player.name)}${status}</option>`);
  });
  return options.join("");
}

function renderPlayerLists() {
  state.teams.forEach((team, index) => {
    $(`team${index}Title`).textContent = teamName(index);
    $(`team${index}Count`).textContent = `${team.players.length}/11`;
    const list = $(`team${index}Players`);
    list.innerHTML = team.players.length
      ? team.players.map((player, playerIndex) => `<li><span>${playerIndex + 1}. ${escapeHtml(player.name)}</span></li>`).join("")
      : '<li><span>No players added</span></li>';
  });
}

function renderSelectors() {
  const inning = currentInnings();
  if (!inning) {
    $("strikerSelect").innerHTML = '<option value="">Create match first</option>';
    $("nonStrikerSelect").innerHTML = '<option value="">Create match first</option>';
    $("bowlerSelect").innerHTML = '<option value="">Create match first</option>';
    return;
  }

  const batters = state.teams[inning.battingTeam].players;
  const bowlers = state.teams[inning.bowlingTeam].players;
  $("strikerSelect").innerHTML = optionHtml(batters, state.selectedStriker, inning, "batter");
  $("nonStrikerSelect").innerHTML = optionHtml(batters, state.selectedNonStriker, inning, "batter");
  $("bowlerSelect").innerHTML = optionHtml(bowlers, state.selectedBowler, inning, "bowler");
}

function renderScoreHero() {
  const inning = currentInnings();
  const isReady = Boolean(inning);

  matchStatus.textContent = state.matchComplete ? "Finished" : state.matchStarted ? "Live" : "Not started";
  scoreValue.textContent = isReady ? `${inning.runs}/${inning.wickets}` : "0/0";
  oversValue.textContent = isReady ? oversText(inning.legalBalls) : "0.0";
  runRateValue.textContent = isReady ? rate(inning.runs, inning.legalBalls) : "0.00";
  targetValue.textContent = state.target || "--";
  requiredRateValue.textContent = requiredRate();
  battingLabel.textContent = isReady ? `${teamName(inning.battingTeam)} batting` : "Current Score";
  if ($("freeHitBadge")) {
    $("freeHitBadge").hidden = !(
      state.matchStarted &&
      !state.matchComplete &&
      inning &&
      inning.freeHit === true
    );
  }

  if (!isReady) {
    scoreContext.textContent = "Set up a match to begin scoring.";
  } else {
    const freeHitText = state.matchStarted && !state.matchComplete && inning.freeHit ? " | FREE HIT next legal ball" : "";
    scoreContext.textContent = `${teamName(inning.bowlingTeam)} bowling | Balls ${inning.legalBalls} | Extras ${extrasTotal(inning)} | ${state.totalOvers} overs match${freeHitText}`;
  }
}

function renderSummary() {
  $("summaryTeam0Name").textContent = teamName(0);
  $("summaryTeam1Name").textContent = teamName(1);
  $("summaryTeam0Score").textContent = scoreLineForTeam(0);
  $("summaryTeam1Score").textContent = scoreLineForTeam(1);
  if ($("summaryTeam0BoundaryName")) $("summaryTeam0BoundaryName").textContent = `${teamName(0)} Boundaries`;
  if ($("summaryTeam1BoundaryName")) $("summaryTeam1BoundaryName").textContent = `${teamName(1)} Boundaries`;
  const team0Boundaries = teamBoundaryStats(0);
  const team1Boundaries = teamBoundaryStats(1);
  if ($("summaryTeam0Boundaries")) $("summaryTeam0Boundaries").textContent = `4s: ${team0Boundaries.fours} | 6s: ${team0Boundaries.sixes}`;
  if ($("summaryTeam1Boundaries")) $("summaryTeam1Boundaries").textContent = `4s: ${team1Boundaries.fours} | 6s: ${team1Boundaries.sixes}`;

  const inning = displayedInnings();
  $("inningsLabel").textContent = state.matchStarted ? `Innings ${state.currentInningsIndex + 1}` : "Innings --";
  $("summaryCurrent").textContent = inning ? `${teamName(inning.battingTeam)} batting` : "--";
  $("summaryResult").textContent = state.result;
}


function renderExtras() {
  const inning = displayedInnings();

  if (!inning) {
    $("widesValue").textContent = "0";
    $("noBallsValue").textContent = "0";
    $("byesValue").textContent = "0";
    $("legByesValue").textContent = "0";
    $("totalExtrasValue").textContent = "0";
    return;
  }

  const wides = inning.extras.wides || 0;
  const noBalls = inning.extras.noBalls || 0;
  const byes = inning.extras.byes || 0;
  const legByes = inning.extras.legByes || 0;
  const total = wides + noBalls + byes + legByes;

  $("widesValue").textContent = wides;
  $("noBallsValue").textContent = noBalls;
  $("byesValue").textContent = byes;
  $("legByesValue").textContent = legByes;
  $("totalExtrasValue").textContent = total;
}

function renderFallOfWickets() {
  const inning = displayedInnings();
  const list = $("fallOfWicketsList");
  if (!list) return;

  if (!inning || !inning.fallOfWickets || !inning.fallOfWickets.length) {
    list.innerHTML = '<div class="empty-state">No wickets yet.</div>';
    $("fowCount").textContent = "0 wickets";
    return;
  }

  $("fowCount").textContent = `${inning.fallOfWickets.length} wicket${inning.fallOfWickets.length === 1 ? "" : "s"}`;
  list.innerHTML = inning.fallOfWickets.map((wicket) => `
    <div class="fow-item">
      <strong>${wicket.wicketNumber}-${wicket.score}</strong>
      (${escapeHtml(playerName(wicket.batterId))}, ${escapeHtml(wicket.over)} ov)
      <br />
      <span class="hint">${escapeHtml(dismissalLabel(wicket.method))}${wicket.fielderId ? ` - ${escapeHtml(playerName(wicket.fielderId))}` : ""}</span>
    </div>
  `).join("");
}

function renderTimeline() {
  const inning = displayedInnings();
  const timeline = $("timeline");
  if (!inning || !inning.timeline.length) {
    timeline.innerHTML = '<div class="empty-state">No ball-by-ball updates yet.</div>';
    $("timelineCount").textContent = "0 balls";
    return;
  }

  $("timelineCount").textContent = `${inning.timeline.length} events`;
  timeline.innerHTML = inning.timeline.map((item) => `
    <div class="timeline-item ${item.type}">
      <span class="ball-tag">${escapeHtml(item.label)}</span>
      <span>${escapeHtml(item.text)}</span>
    </div>
  `).join("");
}

function renderBattingTable() {
  const inning = displayedInnings();
  const tbody = $("battingTable");
  if (!inning) {
    tbody.innerHTML = '<tr><td colspan="7">Create a match to view the batting scorecard.</td></tr>';
    $("battingCardTeam").textContent = "--";
    return;
  }

  const players = state.teams[inning.battingTeam].players;
  $("battingCardTeam").textContent = teamName(inning.battingTeam);
  tbody.innerHTML = players.length ? players.map((player) => {
    const stat = readBattingStat(player.id, inning);
    const strikeRate = stat.balls > 0 ? ((stat.runs / stat.balls) * 100).toFixed(2) : "0.00";
    const status = dismissalText(stat, player.id);
    const isLiveDisplayedInnings = displayedInnings() === currentInnings();
    const isStriker = isLiveDisplayedInnings && player.id === state.selectedStriker;
    const isNonStriker = isLiveDisplayedInnings && player.id === state.selectedNonStriker;
    const strikeMark = isStriker ? " *" : isNonStriker ? " †" : "";
    const activeClass = isStriker || isNonStriker ? "active-batter" : "";
    return `
      <tr class="${activeClass}">
        <td>${escapeHtml(player.name)}${strikeMark}</td>
        <td>${stat.runs}</td>
        <td>${stat.balls}</td>
        <td>${stat.fours}</td>
        <td>${stat.sixes}</td>
        <td>${strikeRate}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join("") : '<tr><td colspan="7">Add players to the batting team.</td></tr>';
}

function renderBowlingTable() {
  const inning = displayedInnings();
  const tbody = $("bowlingTable");
  if (!inning) {
    tbody.innerHTML = '<tr><td colspan="8">Create a match to view the bowling scorecard.</td></tr>';
    $("bowlingCardTeam").textContent = "--";
    return;
  }

  const players = state.teams[inning.bowlingTeam].players;
  $("bowlingCardTeam").textContent = teamName(inning.bowlingTeam);
  tbody.innerHTML = players.length ? players.map((player) => {
    const stat = readBowlingStat(player.id, inning);
    const economy = stat.balls > 0 ? (stat.runs / (stat.balls / 6)).toFixed(2) : "0.00";
    const quota = bowlerQuotaStatus(player.id, inning);
    const quotaNote = quota.quota > 0 ? ` <span class="hint">/${oversText(quota.quota)}</span>` : "";
    return `
      <tr class="${quota.reached ? "quota-warning" : ""}">
        <td>${escapeHtml(player.name)}${quota.reached ? ' <span class="hint">quota</span>' : ""}</td>
        <td>${oversText(stat.balls)}${quotaNote}</td>
        <td>${stat.maidens}</td>
        <td>${stat.runs}</td>
        <td>${stat.wickets}</td>
        <td>${stat.wides || 0}</td>
        <td>${stat.noBalls || 0}</td>
        <td>${economy}</td>
      </tr>
    `;
  }).join("") : '<tr><td colspan="8">Add players to the bowling team.</td></tr>';
}

function renderControls() {
  const scoringReady = canScore();

  document.querySelectorAll("[data-run], [data-extra], #wicketBtn, #endInningsBtn").forEach((button) => {
    button.disabled = !state.matchStarted || state.matchComplete || (!scoringReady && button.id !== "endInningsBtn");
  });
  $("undoBtn").disabled = !state.history.length;
  $("swapStrikeBtn").disabled = !state.matchStarted || state.matchComplete || !state.selectedStriker || !state.selectedNonStriker;
  if (scoringReady) {
    const inning = currentInnings();
    const oneBowlerNotice = inning && inning.previousBowler && inning.legalBalls > 0 && inning.legalBalls % 6 === 0 && state.teams[inning.bowlingTeam].players.length === 1
      ? " | Casual one-bowler mode"
      : "";
    scoreHint.textContent = `${playerName(state.selectedStriker)} on strike, ${playerName(state.selectedBowler)} bowling${currentInnings()?.freeHit ? " | FREE HIT" : ""}${oneBowlerNotice}`;
  } else {
    scoreHint.textContent = scoreReadinessMessage();
  }
}

function renderSetupNames() {
  $("team1Name").value = state.teams[0].name;
  $("team2Name").value = state.teams[1].name;
  $("totalOvers").value = state.totalOvers;
  $("summaryTeam0Name").textContent = teamName(0);
  $("summaryTeam1Name").textContent = teamName(1);
  $("battingTeamSelect").options[0].textContent = teamName(0);
  $("battingTeamSelect").options[1].textContent = teamName(1);
  $("bowlingTeamSelect").options[0].textContent = teamName(1);
  $("bowlingTeamSelect").options[1].textContent = teamName(0);
}



function renderInningsViewer() {
  const liveBtn = $("viewLiveBtn");
  const firstBtn = $("viewInnings1Btn");
  const secondBtn = $("viewInnings2Btn");
  const note = $("viewingInningsNote");
  if (!liveBtn || !firstBtn || !secondBtn || !note) return;

  liveBtn.classList.toggle("active", state.viewingInningsIndex === null);
  firstBtn.classList.toggle("active", state.viewingInningsIndex === 0);
  secondBtn.classList.toggle("active", state.viewingInningsIndex === 1);

  firstBtn.disabled = !state.innings[0];
  secondBtn.disabled = !state.innings[1];

  if (state.viewingInningsIndex === null) {
    note.textContent = "Showing live innings.";
  } else {
    const inning = displayedInnings();
    note.textContent = inning ? `Viewing Innings ${state.viewingInningsIndex + 1}: ${teamName(inning.battingTeam)} batting.` : "No innings available.";
  }
}

function render() {
  renderSetupNames();
  renderPlayerLists();
  renderSelectors();
  renderScoreHero();
  renderSummary();
  renderExtras();
  renderInningsViewer();
  renderFallOfWickets();
  renderTimeline();
  renderBattingTable();
  renderBowlingTable();
  renderControls();
  renderCloudControls();

  if (skipNextSave) {
    skipNextSave = false;
  } else {
    persistMatch();
  }
}



function getOptionalOverthrowRuns() {
  const input = $("optionalOverthrowRunsInput");
  return Math.max(0, Math.min(6, Number(input?.value) || 0));
}

function resetOptionalOverthrowRuns() {
  const input = $("optionalOverthrowRunsInput");
  if (input) input.value = 0;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("matchType").addEventListener("change", (event) => {
  $("totalOvers").value = event.target.value;
  state.totalOvers = Math.max(1, Number(event.target.value) || 20);
  render();
});

$("totalOvers").addEventListener("input", (event) => {
  const nextOvers = Number(event.target.value);
  if (!Number.isFinite(nextOvers) || nextOvers < 1) {
    persistMatch();
    return;
  }

  const inning = currentInnings();
  const minimumOvers = inning ? Math.max(1, Math.ceil(inning.legalBalls / 6)) : 1;
  if (state.matchStarted && nextOvers < minimumOvers) {
    state.totalOvers = minimumOvers;
    event.target.value = minimumOvers;
    render();
    return;
  }

  state.totalOvers = nextOvers;
  if (state.matchStarted) {
    checkInningsProgress();
  }
  render();
});

$("battingTeamSelect").addEventListener("change", () => {
  syncBowlingTeamWithBatting();
  persistMatch();
});

$("bowlingTeamSelect").addEventListener("change", () => {
  syncBattingTeamWithBowling();
  persistMatch();
});

$("createMatchBtn").addEventListener("click", createOrResetMatch);
$("resetMatchBtn").addEventListener("click", resetMatch);

document.querySelectorAll("[data-add-player]").forEach((button) => {
  button.addEventListener("click", () => addPlayer(Number(button.dataset.addPlayer)));
});

["team0PlayerInput", "team1PlayerInput"].forEach((id, index) => {
  $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPlayer(index);
  });
});

document.querySelectorAll("[data-run]").forEach((button) => {
  button.addEventListener("click", () => {
    const overthrowRuns = getOptionalOverthrowRuns();
    scoreRun(Number(button.dataset.run), overthrowRuns);
    resetOptionalOverthrowRuns();
  });
});

document.querySelectorAll("[data-extra]").forEach((button) => {
  button.addEventListener("click", () => openExtraPopup(button.dataset.extra));
});

$("extraRunButtons").addEventListener("click", (event) => {
  if (event.target.id !== "confirmDeliveryRunsBtn") return;

  const completedRuns = Number($("completedRunsInput").value) || 0;
  const overthrowRuns = Number($("extraOverthrowInput")?.value) || 0;

  if (pendingExtraType) {
    const type = pendingExtraType;
    closeExtraPopup();
    scoreExtra(type, completedRuns, overthrowRuns);
  }
});

$("closeExtraPopupBtn").addEventListener("click", closeExtraPopup);
$("extraPopup").addEventListener("click", (event) => {
  if (event.target.id === "extraPopup") closeExtraPopup();
});

$("wicketBtn").addEventListener("click", openWicketPopup);
$("confirmWicketBtn").addEventListener("click", () => {
  const method = $("dismissalTypeSelect").value;
  const fielderId = $("fielderSelect").value;
  const deliveryType = $("wicketDeliveryTypeSelect")?.value || "legal";
  closeWicketPopup();
  scoreWicket(method, fielderId, deliveryType);
});
$("closeWicketPopupBtn").addEventListener("click", closeWicketPopup);
$("wicketPopup").addEventListener("click", (event) => {
  if (event.target.id === "wicketPopup") closeWicketPopup();
});
$("undoBtn").addEventListener("click", undoLastBall);
$("endInningsBtn").addEventListener("click", () => {
  if (!state.matchStarted || state.matchComplete) return;
  saveHistory();
  finishInnings();
  render();
});

$("strikerSelect").addEventListener("change", (event) => {
  state.selectedStriker = event.target.value;
  returnRetiredBatterIfSelected(state.selectedStriker);
  validateCurrentSelections();
  render();
});

$("nonStrikerSelect").addEventListener("change", (event) => {
  state.selectedNonStriker = event.target.value;
  returnRetiredBatterIfSelected(state.selectedNonStriker);
  validateCurrentSelections();
  render();
});

$("bowlerSelect").addEventListener("change", (event) => {
  state.selectedBowler = event.target.value;
  validateCurrentSelections();
  render();
});

["team1Name", "team2Name"].forEach((id, index) => {
  $(id).addEventListener("input", (event) => {
    state.teams[index].name = event.target.value;
    renderSetupNames();
    renderPlayerLists();
    renderSummary();
    persistMatch();
  });
});



$("viewLiveBtn").addEventListener("click", () => {
  state.viewingInningsIndex = null;
  render();
});

$("viewInnings1Btn").addEventListener("click", () => {
  if (!state.innings[0]) return;
  state.viewingInningsIndex = 0;
  render();
});

$("viewInnings2Btn").addEventListener("click", () => {
  if (!state.innings[1]) return;
  state.viewingInningsIndex = 1;
  render();
});

$("joinPinInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
});

$("createOnlineMatchBtn").addEventListener("click", createOnlineMatch);
$("joinOnlineMatchBtn").addEventListener("click", () => loadMatchFromCloud($("joinPinInput").value));
$("leaveOnlineMatchBtn").addEventListener("click", leaveOnlineMatch);
$("copyPinBtn").addEventListener("click", async () => {
  if (!cloudPin) return;
  try {
    await navigator.clipboard.writeText(cloudPin);
    updateSyncStatus(`Copied PIN ${cloudPin}.`);
  } catch (error) {
    updateSyncStatus(`PIN: ${cloudPin}`);
  }
});

loadSavedMatch();
renderCloudControls();
startCloudPolling();
render();
