/**

* Mundial 2026 Backend para Roblox
* =================================
* Roblox -> Backend Render -> SportMonks/Sportradar -> Backend limpia datos -> Roblox
*
* Endpoints:
* GET /
* GET /health
* GET /worldcup/live
  */

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const PROVIDER = (process.env.PROVIDER || "sportmonks").toLowerCase();

const SPORTRADAR_API_KEY = process.env.SPORTRADAR_API_KEY || "";
const SPORTRADAR_BASE_URL =
process.env.SPORTRADAR_BASE_URL ||
"https://api.sportradar.com/soccer/trial/v4/en";

const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY || "";
const SPORTMONKS_BASE_URL =
process.env.SPORTMONKS_BASE_URL ||
"https://api.sportmonks.com/v3/football";

const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 30);
const MAX_LIVE_SECONDS = 150 * 60;

let cache = {
lastUpdated: 0,
source: "NONE",
dataConfidence: "low",
matches: [],
error: "Todavía no se han cargado datos."
};

function unixNow() {
return Math.floor(Date.now() / 1000);
}

function toUnix(value) {
if (!value) return 0;

if (typeof value === "number") {
if (value > 1000000000 && value < 9999999999) return value;
if (value > 9999999999) return Math.floor(value / 1000);
}

const parsed = new Date(value).getTime();

if (Number.isNaN(parsed)) {
return 0;
}

return Math.floor(parsed / 1000);
}

function normalizeStatus(rawStatus, kickoffUnix, minute, events = []) {
const raw = String(rawStatus || "").toLowerCase().trim();

const hasFullTimeEvent = events.some((e) => {
const type = String(e.type || "").toLowerCase();

```
return (
  type.includes("full_time") ||
  type.includes("match_ended") ||
  type.includes("ended") ||
  type === "ft"
);
```

});

if (hasFullTimeEvent) {
return {
status: "Finished",
statusConfidence: "high"
};
}

const finishedStates = [
"closed",
"complete",
"completed",
"ended",
"finished",
"finish",
"ft",
"aet",
"pen",
"after_penalties"
];

const liveStates = [
"live",
"in_progress",
"1st_half",
"2nd_half",
"1h",
"2h",
"et",
"extra_time"
];

const scheduledStates = [
"not_started",
"scheduled",
"pre_game",
"ns",
"upcoming"
];

const halfTimeStates = [
"half_time",
"halftime",
"half-time",
"ht",
"break"
];

const cancelledStates = [
"cancelled",
"canceled",
"postponed",
"suspended",
"abandoned"
];

if (finishedStates.includes(raw)) {
return {
status: "Finished",
statusConfidence: "high"
};
}

if (halfTimeStates.includes(raw)) {
return {
status: "HalfTime",
statusConfidence: "high"
};
}

if (scheduledStates.includes(raw)) {
return {
status: "Scheduled",
statusConfidence: "high"
};
}

if (cancelledStates.includes(raw)) {
return {
status: "StatusUnknown",
statusConfidence: "low"
};
}

if (liveStates.includes(raw)) {
const elapsed = kickoffUnix ? unixNow() - kickoffUnix : 0;

```
if (elapsed > MAX_LIVE_SECONDS && (minute === null || minute === undefined)) {
  return {
    status: "PossiblyFinished",
    statusConfidence: "low"
  };
}

if (typeof minute === "number" && minute >= 0 && minute <= 130) {
  return {
    status: "Live",
    statusConfidence: "high"
  };
}

return {
  status: "Live",
  statusConfidence: "medium"
};
```

}

return {
status: "StatusUnknown",
statusConfidence: "low"
};
}

function calculateDataConfidence(matches) {
if (!matches.length) return "low";

const high = matches.filter((m) => m.statusConfidence === "high").length;
const ratio = high / matches.length;

if (ratio >= 0.8) return "high";
if (ratio >= 0.5) return "medium";

return "low";
}

function sortMatches(matches) {
return [...matches].sort((a, b) => {
const aTime = Number(a.kickoffUnix || 0);
const bTime = Number(b.kickoffUnix || 0);

```
if (aTime !== bTime) {
  return aTime - bTime;
}

return String(a.home || "").localeCompare(String(b.home || ""));
```

});
}

async function fetchFromSportradar() {
if (!SPORTRADAR_API_KEY) {
throw new Error("Falta SPORTRADAR_API_KEY");
}

const today = new Date().toISOString().slice(0, 10).replaceAll("-", "/");

const url = SPORTRADAR_BASE_URL + "/schedules/" + today + "/schedules.json";

const response = await axios.get(url, {
params: {
api_key: SPORTRADAR_API_KEY
},
timeout: 10000
});

const sportEvents = response.data?.sport_events || [];

const matches = sportEvents.map((event) => {
const competitors = event.competitors || event.sport_event?.competitors || [];

```
const home =
  competitors.find((c) => c.qualifier === "home") ||
  competitors.find((c) => c.home_away === "home") ||
  competitors[0];

const away =
  competitors.find((c) => c.qualifier === "away") ||
  competitors.find((c) => c.home_away === "away") ||
  competitors[1];

const statusObj = event.sport_event_status || event.status || {};
const rawStatus = statusObj.status || event.status || "StatusUnknown";

const kickoffUnix = toUnix(event.start_time || event.scheduled);

const homeScore =
  typeof statusObj.home_score === "number" ? statusObj.home_score : 0;

const awayScore =
  typeof statusObj.away_score === "number" ? statusObj.away_score : 0;

const minute =
  typeof statusObj.match_time === "number"
    ? statusObj.match_time
    : typeof statusObj.minute === "number"
      ? statusObj.minute
      : null;

const events = [];

const normalized = normalizeStatus(rawStatus, kickoffUnix, minute, events);

const group =
  event.sport_event_context?.groups?.[0]?.name ||
  event.sport_event_context?.group?.name ||
  event.group?.name ||
  "N/A";

const stage =
  event.sport_event_context?.stage?.name ||
  event.stage?.name ||
  "N/A";

return {
  id: String(event.id || event.sport_event?.id || "unknown"),
  home: home?.name || "TBD",
  away: away?.name || "TBD",
  homeScore,
  awayScore,
  status: normalized.status,
  statusConfidence: normalized.statusConfidence,
  minute,
  kickoffUnix,
  group,
  stage,
  events
};
```

});

return {
source: "Sportradar",
matches: sortMatches(matches)
};
}

async function fetchFromSportMonks() {
if (!SPORTMONKS_API_KEY) {
throw new Error("Falta SPORTMONKS_API_KEY");
}

const today = new Date().toISOString().slice(0, 10);

const response = await axios.get(SPORTMONKS_BASE_URL + "/fixtures/date/" + today, {
params: {
api_token: SPORTMONKS_API_KEY,
include: "state;scores;events;participants;league;round",
per_page: 50
},
timeout: 10000
});

const fixtures = response.data?.data || [];

const matches = fixtures.map((fixture) => {
const participants = fixture.participants || [];

```
const home =
  participants.find((p) => p.meta?.location === "home") ||
  participants.find((p) => p.meta?.winner === true && p.meta?.location === "home");

const away =
  participants.find((p) => p.meta?.location === "away") ||
  participants.find((p) => p.id !== home?.id);

const currentScores = (fixture.scores || []).filter(
  (s) => String(s.description || "").toUpperCase() === "CURRENT"
);

const homeScoreObj = currentScores.find(
  (s) => String(s.score?.participant || "").toLowerCase() === "home"
);

const awayScoreObj = currentScores.find(
  (s) => String(s.score?.participant || "").toLowerCase() === "away"
);

const homeScore = homeScoreObj?.score?.goals ?? 0;
const awayScore = awayScoreObj?.score?.goals ?? 0;

const kickoffUnix = toUnix(fixture.starting_at);

const events = (fixture.events || []).map((e) => ({
  type: e.type || e.type_id || "event",
  team: e.participant_name || "",
  player: e.player_name || "",
  minute: e.minute ?? null
}));

const rawStatus =
  fixture.state?.state ||
  fixture.state?.name ||
  fixture.state?.short_name ||
  "StatusUnknown";

const minute =
  typeof fixture.minute === "number"
    ? fixture.minute
    : null;

const normalized = normalizeStatus(rawStatus, kickoffUnix, minute, events);

return {
  id: String(fixture.id || "fixture-" + kickoffUnix),
  home: home?.name || "TBD",
  away: away?.name || "TBD",
  homeScore,
  awayScore,
  status: normalized.status,
  statusConfidence: normalized.statusConfidence,
  minute,
  kickoffUnix,
  group: fixture.round?.name || "N/A",
  stage: fixture.league?.name || "N/A",
  events
};
```

});

return {
source: "SportMonks",
matches: sortMatches(matches)
};
}

async function getLiveData() {
if (PROVIDER === "sportmonks") {
return await fetchFromSportMonks();
}

if (PROVIDER === "sportradar") {
return await fetchFromSportradar();
}

if (PROVIDER === "auto") {
try {
return await fetchFromSportradar();
} catch (sportradarError) {
console.warn("[AUTO] Sportradar falló:", sportradarError.message);
return await fetchFromSportMonks();
}
}

throw new Error("PROVIDER inválido: " + PROVIDER);
}

app.get("/", (req, res) => {
res.json({
ok: true,
message: "Mundial 2026 Backend para Roblox",
endpoints: ["/health", "/worldcup/live"]
});
});

app.get("/health", (req, res) => {
res.json({
ok: true,
provider: PROVIDER,
cache: {
lastUpdated: cache.lastUpdated,
source: cache.source,
matchCount: cache.matches.length,
dataConfidence: cache.dataConfidence
}
});
});

app.get("/worldcup/live", async (req, res) => {
const now = unixNow();

if (cache.lastUpdated && now - cache.lastUpdated < CACHE_SECONDS) {
return res.json(cache);
}

try {
const result = await getLiveData();

```
const matches = sortMatches(result.matches || []);
const dataConfidence = calculateDataConfidence(matches);

cache = {
  lastUpdated: now,
  source: result.source,
  dataConfidence,
  matches
};

return res.json(cache);
```

} catch (error) {
console.error("[/worldcup/live] Error:", error.message);

```
const apiErrorData = error.response?.data || null;
const apiStatus = error.response?.status || null;

return res.status(200).json({
  ...cache,
  lastUpdated: cache.lastUpdated || now,
  dataConfidence: "low",
  error: "No se pudieron cargar los datos en vivo.",
  detail: error.message,
  apiStatus,
  apiErrorData
});
```

}
});

app.listen(PORT, () => {
console.log("Backend Mundial 2026 corriendo en puerto " + PORT);
console.log("Proveedor seleccionado: " + PROVIDER);
});
