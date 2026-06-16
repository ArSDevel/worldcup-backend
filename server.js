const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY || "";
const SPORTMONKS_BASE_URL =
process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com/v3/football";

const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 30);

const WORLD_CUP_START_DATE =
process.env.WORLD_CUP_START_DATE || "2026-06-11";

const WORLD_CUP_END_DATE =
process.env.WORLD_CUP_END_DATE || "2026-07-19";

const MAX_PAGES = Number(process.env.MAX_PAGES || 5);

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
if (!value) {
return 0;
}

if (typeof value === "number") {
if (value > 1000000000 && value < 9999999999) {
return value;
}

```
if (value > 9999999999) {
  return Math.floor(value / 1000);
}
```

}

const parsed = new Date(value).getTime();

if (Number.isNaN(parsed)) {
return 0;
}

return Math.floor(parsed / 1000);
}

function normalizeStatus(rawStatus, kickoffUnix, minute, events) {
const raw = String(rawStatus || "").toLowerCase().trim();

const safeEvents = Array.isArray(events) ? events : [];

const hasFullTimeEvent = safeEvents.some(function (event) {
const type = String(event.type || "").toLowerCase();

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

const scheduledStates = [
"not_started",
"scheduled",
"pre_game",
"ns",
"upcoming",
"fixture"
];

const liveStates = [
"live",
"in_progress",
"1st_half",
"2nd_half",
"1h",
"2h",
"et",
"extra_time",
"inplay"
];

const halfTimeStates = [
"half_time",
"halftime",
"half-time",
"ht",
"break"
];

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
"after_penalties",
"fulltime"
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

if (liveStates.includes(raw)) {
return {
status: "Live",
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

if (kickoffUnix > 0) {
const now = unixNow();
const elapsed = now - kickoffUnix;

```
if (elapsed > 150 * 60 && !minute) {
  return {
    status: "PossiblyFinished",
    statusConfidence: "low"
  };
}

if (elapsed < -15 * 60) {
  return {
    status: "Scheduled",
    statusConfidence: "medium"
  };
}

if (elapsed >= -15 * 60 && elapsed <= 150 * 60) {
  return {
    status: "Live",
    statusConfidence: "low"
  };
}
```

}

return {
status: "StatusUnknown",
statusConfidence: "low"
};
}

function calculateDataConfidence(matches) {
if (!matches || matches.length === 0) {
return "low";
}

const highCount = matches.filter(function (match) {
return match.statusConfidence === "high";
}).length;

const ratio = highCount / matches.length;

if (ratio >= 0.8) {
return "high";
}

if (ratio >= 0.5) {
return "medium";
}

return "low";
}

function sortMatches(matches) {
return matches.sort(function (a, b) {
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

function getParticipantName(participant) {
if (!participant) {
return "TBD";
}

return participant.name || participant.short_code || "TBD";
}

function getHomeParticipant(participants) {
if (!Array.isArray(participants)) {
return null;
}

return (
participants.find(function (participant) {
return participant.meta && participant.meta.location === "home";
}) ||
participants[0] ||
null
);
}

function getAwayParticipant(participants, home) {
if (!Array.isArray(participants)) {
return null;
}

return (
participants.find(function (participant) {
return participant.meta && participant.meta.location === "away";
}) ||
participants.find(function (participant) {
return !home || participant.id !== home.id;
}) ||
participants[1] ||
null
);
}

function getScores(scores) {
const result = {
homeScore: 0,
awayScore: 0
};

if (!Array.isArray(scores)) {
return result;
}

const currentScores = scores.filter(function (scoreItem) {
return String(scoreItem.description || "").toUpperCase() === "CURRENT";
});

const sourceScores = currentScores.length > 0 ? currentScores : scores;

sourceScores.forEach(function (scoreItem) {
const participant = String(
scoreItem.score && scoreItem.score.participant
? scoreItem.score.participant
: ""
).toLowerCase();

```
const goals =
  scoreItem.score && typeof scoreItem.score.goals === "number"
    ? scoreItem.score.goals
    : 0;

if (participant === "home") {
  result.homeScore = goals;
}

if (participant === "away") {
  result.awayScore = goals;
}
```

});

return result;
}

function normalizeEvent(event) {
return {
type: event.type || event.type_id || "event",
team: event.participant_name || "",
player: event.player_name || "",
minute: event.minute || null,
period: event.period || null
};
}

function getLeagueName(fixture) {
if (fixture.league && fixture.league.name) {
return fixture.league.name;
}

return "";
}

function getRoundName(fixture) {
if (fixture.round && fixture.round.name) {
return fixture.round.name;
}

return "";
}

function looksLikeWorldCupFixture(fixture) {
const leagueName = getLeagueName(fixture).toLowerCase();
const roundName = getRoundName(fixture).toLowerCase();
const nameBlob = leagueName + " " + roundName;

if (nameBlob.includes("world cup")) {
return true;
}

if (nameBlob.includes("fifa")) {
return true;
}

if (nameBlob.includes("mundial")) {
return true;
}

return false;
}

function normalizeFixture(fixture, forceLive) {
const participants = fixture.participants || [];

const home = getHomeParticipant(participants);
const away = getAwayParticipant(participants, home);

const scores = getScores(fixture.scores || []);

const rawStatus =
(fixture.state && fixture.state.state) ||
(fixture.state && fixture.state.name) ||
(fixture.state && fixture.state.short_name) ||
"StatusUnknown";

const kickoffUnix = toUnix(fixture.starting_at);

const events = Array.isArray(fixture.events)
? fixture.events.map(function (event) {
return normalizeEvent(event);
})
: [];

const minute = typeof fixture.minute === "number" ? fixture.minute : null;

let normalized = normalizeStatus(rawStatus, kickoffUnix, minute, events);

if (forceLive) {
normalized = {
status: "Live",
statusConfidence: "high"
};
}

return {
id: String(fixture.id || "fixture-" + kickoffUnix),
home: getParticipantName(home),
away: getParticipantName(away),
homeScore: scores.homeScore,
awayScore: scores.awayScore,
status: normalized.status,
statusConfidence: normalized.statusConfidence,
minute: minute,
kickoffUnix: kickoffUnix,
group: getRoundName(fixture) || "N/A",
stage: getLeagueName(fixture) || "World Cup",
events: events
};
}

async function getSportMonksPage(url, params, page) {
const response = await axios.get(url, {
params: Object.assign({}, params, {
page: page
}),
timeout: 20000
});

return response.data || {};
}

async function fetchFixturesBetweenDates() {
const url =
SPORTMONKS_BASE_URL +
"/fixtures/between/" +
WORLD_CUP_START_DATE +
"/" +
WORLD_CUP_END_DATE;

const params = {
api_token: SPORTMONKS_API_KEY,
include: "state;scores;events;participants;league;round",
per_page: 100
};

let fixtures = [];

for (let page = 1; page <= MAX_PAGES; page++) {
const data = await getSportMonksPage(url, params, page);

```
const pageData = Array.isArray(data.data) ? data.data : [];

fixtures = fixtures.concat(pageData);

const pagination = data.pagination || data.meta || {};
const hasMore =
  pagination.has_more === true ||
  pagination.has_more_pages === true ||
  pagination.current_page < pagination.last_page;

if (!hasMore || pageData.length === 0) {
  break;
}
```

}

return fixtures;
}

async function fetchLiveFixtures() {
const url = SPORTMONKS_BASE_URL + "/livescores/inplay";

try {
const response = await axios.get(url, {
params: {
api_token: SPORTMONKS_API_KEY,
include: "state;scores;events;participants;league;round",
per_page: 100
},
timeout: 15000
});

```
const fixtures =
  response.data && Array.isArray(response.data.data)
    ? response.data.data
    : [];

return fixtures;
```

} catch (error) {
console.warn("No se pudieron cargar livescores:", error.message);
return [];
}
}

function mergeFixturesAndLives(fixtures, liveFixtures) {
const map = {};

fixtures.forEach(function (fixture) {
map[String(fixture.id)] = {
fixture: fixture,
forceLive: false
};
});

liveFixtures.forEach(function (fixture) {
map[String(fixture.id)] = {
fixture: fixture,
forceLive: true
};
});

return Object.keys(map).map(function (id) {
return normalizeFixture(map[id].fixture, map[id].forceLive);
});
}

async function fetchFromSportMonks() {
if (!SPORTMONKS_API_KEY) {
throw new Error("Falta SPORTMONKS_API_KEY en Render Environment Variables");
}

const fixtures = await fetchFixturesBetweenDates();
const liveFixtures = await fetchLiveFixtures();

let matches = mergeFixturesAndLives(fixtures, liveFixtures);

const worldCupOnly = String(process.env.WORLD_CUP_ONLY || "true").toLowerCase();

if (worldCupOnly === "true") {
const filtered = matches.filter(function (match) {
const blob =
String(match.stage || "").toLowerCase() +
" " +
String(match.group || "").toLowerCase();

```
  return (
    blob.includes("world cup") ||
    blob.includes("fifa") ||
    blob.includes("mundial")
  );
});

if (filtered.length > 0) {
  matches = filtered;
}
```

}

return {
source: "SportMonks",
matches: sortMatches(matches)
};
}

app.get("/", function (req, res) {
res.json({
ok: true,
message: "Mundial 2026 Backend para Roblox",
endpoints: ["/health", "/worldcup/live", "/debug/raw"]
});
});

app.get("/health", function (req, res) {
res.json({
ok: true,
source: cache.source,
config: {
startDate: WORLD_CUP_START_DATE,
endDate: WORLD_CUP_END_DATE,
cacheSeconds: CACHE_SECONDS,
maxPages: MAX_PAGES,
worldCupOnly: process.env.WORLD_CUP_ONLY || "true"
},
cache: {
lastUpdated: cache.lastUpdated,
matchCount: cache.matches.length,
dataConfidence: cache.dataConfidence
}
});
});

app.get("/debug/raw", async function (req, res) {
try {
const fixtures = await fetchFixturesBetweenDates();
const liveFixtures = await fetchLiveFixtures();

```
res.json({
  ok: true,
  fixturesCount: fixtures.length,
  liveFixturesCount: liveFixtures.length,
  sampleFixtures: fixtures.slice(0, 5),
  sampleLiveFixtures: liveFixtures.slice(0, 5)
});
```

} catch (error) {
res.status(200).json({
ok: false,
detail: error.message,
apiStatus: error.response ? error.response.status : null,
apiErrorData: error.response ? error.response.data : null
});
}
});

app.get("/worldcup/live", async function (req, res) {
const now = unixNow();

if (cache.lastUpdated && now - cache.lastUpdated < CACHE_SECONDS) {
return res.json(cache);
}

try {
const result = await fetchFromSportMonks();

```
const matches = result.matches || [];
const dataConfidence = calculateDataConfidence(matches);

cache = {
  lastUpdated: now,
  source: result.source,
  dataConfidence: dataConfidence,
  matches: matches
};

return res.json(cache);
```

} catch (error) {
console.error("Error en /worldcup/live:", error.message);

```
const apiStatus = error.response ? error.response.status : null;
const apiErrorData = error.response ? error.response.data : null;

return res.status(200).json({
  lastUpdated: cache.lastUpdated || now,
  source: cache.source || "SportMonks",
  dataConfidence: "low",
  matches: cache.matches || [],
  error: "No se pudieron cargar los datos en vivo.",
  detail: error.message,
  apiStatus: apiStatus,
  apiErrorData: apiErrorData
});
```

}
});

app.listen(PORT, function () {
console.log("Backend Mundial 2026 corriendo en puerto " + PORT);
console.log("Usando proveedor: SportMonks");
console.log("Fechas: " + WORLD_CUP_START_DATE + " a " + WORLD_CUP_END_DATE);
});
