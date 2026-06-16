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

const WORLD_CUP_ONLY =
String(process.env.WORLD_CUP_ONLY || "true").toLowerCase();

const SPORTMONKS_WORLD_CUP_LEAGUE_ID =
process.env.SPORTMONKS_WORLD_CUP_LEAGUE_ID || "732";

const SPORTMONKS_WORLD_CUP_SEASON_ID =
process.env.SPORTMONKS_WORLD_CUP_SEASON_ID || "26618";

let cache = {
lastUpdated: 0,
source: "NONE",
dataConfidence: "low",
matches: [],
error: "Todavía no se han cargado datos."
};

function nowUnix() {
return Math.floor(Date.now() / 1000);
}

function toUnix(value) {
if (!value) return 0;

if (typeof value === "number") {
if (value > 1000000000 && value < 9999999999) return value;
if (value > 9999999999) return Math.floor(value / 1000);
}

const parsed = new Date(value).getTime();
if (Number.isNaN(parsed)) return 0;

return Math.floor(parsed / 1000);
}

function normalizeStatus(rawStatus, kickoffUnix, minute) {
const raw = String(rawStatus || "").toLowerCase().trim();

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

const liveStates = [
"live",
"inplay",
"in_play",
"in_progress",
"1st_half",
"2nd_half",
"1h",
"2h",
"et",
"extra_time"
];

const halfTimeStates = [
"half_time",
"halftime",
"half-time",
"ht",
"break"
];

const scheduledStates = [
"not_started",
"scheduled",
"pre_game",
"ns",
"upcoming",
"fixture"
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

if (liveStates.includes(raw)) {
return {
status: "Live",
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

if (kickoffUnix > 0) {
const now = nowUnix();
const elapsed = now - kickoffUnix;


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


}

return {
status: "StatusUnknown",
statusConfidence: "low"
};
}

function getParticipantName(participant) {
if (!participant) return "TBD";
return participant.name || participant.short_code || "TBD";
}

function getHomeParticipant(participants) {
if (!Array.isArray(participants)) return null;

return (
participants.find(function (p) {
return p.meta && p.meta.location === "home";
}) ||
participants[0] ||
null
);
}

function getAwayParticipant(participants, home) {
if (!Array.isArray(participants)) return null;

return (
participants.find(function (p) {
return p.meta && p.meta.location === "away";
}) ||
participants.find(function (p) {
return !home || p.id !== home.id;
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

if (!Array.isArray(scores)) return result;

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

return "World Cup";
}

function getRoundName(fixture) {
if (fixture.round && fixture.round.name) {
return fixture.round.name;
}

return "N/A";
}

function normalizeFixture(fixture, forceLive) {
const participants = fixture.participants || [];

const home = getHomeParticipant(participants);
const away = getAwayParticipant(participants, home);

const scores = getScores(fixture.scores || []);
const kickoffUnix = toUnix(fixture.starting_at);

const events = Array.isArray(fixture.events)
? fixture.events.map(function (event) {
return normalizeEvent(event);
})
: [];

const rawStatus =
(fixture.state && fixture.state.state) ||
(fixture.state && fixture.state.name) ||
(fixture.state && fixture.state.short_name) ||
"StatusUnknown";

const minute = typeof fixture.minute === "number" ? fixture.minute : null;

let normalized = normalizeStatus(rawStatus, kickoffUnix, minute);

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
group: getRoundName(fixture),
stage: getLeagueName(fixture),
events: events
};
}

function sortMatches(matches) {
return matches.sort(function (a, b) {
if (a.kickoffUnix !== b.kickoffUnix) {
return a.kickoffUnix - b.kickoffUnix;
}

```
return a.id.localeCompare(b.id);
```

});
}

function calculateDataConfidence(matches) {
if (!matches || matches.length === 0) return "low";

const highCount = matches.filter(function (match) {
return match.statusConfidence === "high";
}).length;

const ratio = highCount / matches.length;

if (ratio >= 0.8) return "high";
if (ratio >= 0.5) return "medium";
return "low";
}

function isWorldCupMatch(match) {
if (WORLD_CUP_ONLY !== "true") {
return true;
}

const text = String(match.stage + " " + match.group).toLowerCase();

return (
text.includes("world cup") ||
text.includes("fifa") ||
text.includes("mundial") ||
text.includes("2026")
);
}

async function fetchFixturesBetweenDates() {
if (!SPORTMONKS_API_KEY) {
throw new Error("Falta SPORTMONKS_API_KEY en Render");
}

const url =
SPORTMONKS_BASE_URL +
"/fixtures/between/" +
WORLD_CUP_START_DATE +
"/" +
WORLD_CUP_END_DATE;

const response = await axios.get(url, {
params: {
api_token: SPORTMONKS_API_KEY,
include: "state;scores;events;participants;league;round",
filters:
"fixtureLeagues:" +
SPORTMONKS_WORLD_CUP_LEAGUE_ID +
";fixtureSeasons:" +
SPORTMONKS_WORLD_CUP_SEASON_ID,
per_page: 100
},
timeout: 20000
});

const fixtures =
response.data && Array.isArray(response.data.data)
? response.data.data
: [];

return fixtures;
}

async function fetchLiveFixtures() {
if (!SPORTMONKS_API_KEY) {
return [];
}

const url = SPORTMONKS_BASE_URL + "/livescores/inplay";

try {
const response = await axios.get(url, {
params: {
api_token: SPORTMONKS_API_KEY,
include: "state;scores;events;participants;league;round",
filters:
"fixtureLeagues:" +
SPORTMONKS_WORLD_CUP_LEAGUE_ID +
";fixtureSeasons:" +
SPORTMONKS_WORLD_CUP_SEASON_ID,
per_page: 100
},
timeout: 15000
});


const fixtures =
  response.data && Array.isArray(response.data.data)
    ? response.data.data
    : [];

return fixtures;


} catch (error) {
console.warn("No se pudieron cargar livescores:", error.message);
return [];
}
}

function mergeFixturesAndLives(fixtures, liveFixtures) {
const map = {};

fixtures.forEach(function (fixture) {
const match = normalizeFixture(fixture, false);
map[match.id] = match;
});

liveFixtures.forEach(function (fixture) {
const match = normalizeFixture(fixture, true);
map[match.id] = match;
});

let matches = Object.values(map);

matches = matches.filter(isWorldCupMatch);

return sortMatches(matches);
}

async function fetchFromSportMonks() {
const fixtures = await fetchFixturesBetweenDates();
const liveFixtures = await fetchLiveFixtures();

const matches = mergeFixturesAndLives(fixtures, liveFixtures);

return {
source: "SportMonks",
matches: matches
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
worldCupOnly: WORLD_CUP_ONLY,
leagueId: SPORTMONKS_WORLD_CUP_LEAGUE_ID,
seasonId: SPORTMONKS_WORLD_CUP_SEASON_ID,
cacheSeconds: CACHE_SECONDS
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


res.json({
  ok: true,
  leagueId: SPORTMONKS_WORLD_CUP_LEAGUE_ID,
  seasonId: SPORTMONKS_WORLD_CUP_SEASON_ID,
  fixturesCount: fixtures.length,
  liveFixturesCount: liveFixtures.length,
  sampleFixtures: fixtures.slice(0, 5),
  sampleLiveFixtures: liveFixtures.slice(0, 5)
});


} catch (error) {
res.json({
ok: false,
detail: error.message,
apiStatus: error.response ? error.response.status : null,
apiErrorData: error.response ? error.response.data : null
});
}
});

app.get("/worldcup/live", async function (req, res) {
const currentTime = nowUnix();

if (cache.lastUpdated && currentTime - cache.lastUpdated < CACHE_SECONDS) {
return res.json(cache);
}

try {
const result = await fetchFromSportMonks();


const matches = result.matches || [];

cache = {
  lastUpdated: currentTime,
  source: result.source,
  dataConfidence: calculateDataConfidence(matches),
  matches: matches
};

res.json(cache);

} catch (error) {
console.error("Error en /worldcup/live:", error.message);


res.json({
  lastUpdated: cache.lastUpdated || currentTime,
  source: "SportMonks",
  dataConfidence: "low",
  matches: cache.matches || [],
  error: "No se pudieron cargar los datos en vivo.",
  detail: error.message,
  apiStatus: error.response ? error.response.status : null,
  apiErrorData: error.response ? error.response.data : null
});


}
});

app.listen(PORT, function () {
console.log("Backend Mundial 2026 corriendo en puerto " + PORT);
console.log("Usando proveedor: SportMonks");
console.log("League ID: " + SPORTMONKS_WORLD_CUP_LEAGUE_ID);
console.log("Season ID: " + SPORTMONKS_WORLD_CUP_SEASON_ID);
});
