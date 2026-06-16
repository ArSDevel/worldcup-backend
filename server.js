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

function normalizeStatus(rawStatus) {
const raw = String(rawStatus || "").toLowerCase().trim();

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
}) || participants[0] || null
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

function normalizeFixture(fixture) {
const participants = fixture.participants || [];

const home = getHomeParticipant(participants);
const away = getAwayParticipant(participants, home);

const scores = getScores(fixture.scores || []);

const rawStatus =
(fixture.state && fixture.state.state) ||
(fixture.state && fixture.state.name) ||
(fixture.state && fixture.state.short_name) ||
"StatusUnknown";

const normalized = normalizeStatus(rawStatus);

const kickoffUnix = toUnix(fixture.starting_at);

const events = Array.isArray(fixture.events)
? fixture.events.map(function (event) {
return {
type: event.type || event.type_id || "event",
team: event.participant_name || "",
player: event.player_name || "",
minute: event.minute || null
};
})
: [];

return {
id: String(fixture.id || "fixture-" + kickoffUnix),
home: getParticipantName(home),
away: getParticipantName(away),
homeScore: scores.homeScore,
awayScore: scores.awayScore,
status: normalized.status,
statusConfidence: normalized.statusConfidence,
minute: typeof fixture.minute === "number" ? fixture.minute : null,
kickoffUnix: kickoffUnix,
group: fixture.round && fixture.round.name ? fixture.round.name : "N/A",
stage: fixture.league && fixture.league.name ? fixture.league.name : "N/A",
events: events
};
}

async function fetchFromSportMonks() {
if (!SPORTMONKS_API_KEY) {
throw new Error("Falta SPORTMONKS_API_KEY en Render Environment Variables");
}

const today = new Date().toISOString().slice(0, 10);

const url = SPORTMONKS_BASE_URL + "/fixtures/date/" + today;

const response = await axios.get(url, {
params: {
api_token: SPORTMONKS_API_KEY,
include: "state;scores;events;participants;league;round",
per_page: 50
},
timeout: 15000
});

const fixtures =
response.data && Array.isArray(response.data.data)
? response.data.data
: [];

const matches = fixtures.map(function (fixture) {
return normalizeFixture(fixture);
});

return {
source: "SportMonks",
matches: sortMatches(matches)
};
}

app.get("/", function (req, res) {
res.json({
ok: true,
message: "Mundial 2026 Backend para Roblox",
endpoints: ["/health", "/worldcup/live"]
});
});

app.get("/health", function (req, res) {
res.json({
ok: true,
source: cache.source,
cache: {
lastUpdated: cache.lastUpdated,
matchCount: cache.matches.length,
dataConfidence: cache.dataConfidence
}
});
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
});
