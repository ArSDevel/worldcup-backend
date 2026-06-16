const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const FREE_WORLD_CUP_BASE_URL =
process.env.FREE_WORLD_CUP_BASE_URL || "https://worldcup26.ir";

const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 30);

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

function toNumber(value, fallback) {
const num = Number(value);

if (Number.isNaN(num)) {
return fallback;
}

return num;
}

function parseLocalDateToUnix(localDate) {
if (!localDate) {
return 0;
}

const text = String(localDate).trim();

const parts = text.split(" ");
if (parts.length < 2) {
return 0;
}

const datePart = parts[0];
const timePart = parts[1];

const datePieces = datePart.split("/");
const timePieces = timePart.split(":");

if (datePieces.length !== 3 || timePieces.length < 2) {
return 0;
}

const month = Number(datePieces[0]);
const day = Number(datePieces[1]);
const year = Number(datePieces[2]);
const hour = Number(timePieces[0]);
const minute = Number(timePieces[1]);

if (
Number.isNaN(month) ||
Number.isNaN(day) ||
Number.isNaN(year) ||
Number.isNaN(hour) ||
Number.isNaN(minute)
) {
return 0;
}

const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
return Math.floor(date.getTime() / 1000);
}

function normalizeStatus(game) {
const rawFinished = String(game.finished || "").toLowerCase().trim();
const rawTime = String(game.time_elapsed || "").toLowerCase().trim();

if (
rawFinished === "true" ||
rawFinished === "1" ||
rawFinished === "yes" ||
rawTime === "finished" ||
rawTime === "ft" ||
rawTime === "fulltime" ||
rawTime === "ended"
) {
return {
status: "Finished",
statusConfidence: "high"
};
}

if (
rawTime === "notstarted" ||
rawTime === "not_started" ||
rawTime === "scheduled" ||
rawTime === "ns" ||
rawTime === "upcoming" ||
rawTime === ""
) {
return {
status: "Scheduled",
statusConfidence: "high"
};
}

if (
rawTime === "halftime" ||
rawTime === "half_time" ||
rawTime === "ht"
) {
return {
status: "HalfTime",
statusConfidence: "high"
};
}

const elapsed = Number(rawTime);

if (!Number.isNaN(elapsed) && elapsed >= 0 && elapsed <= 130) {
return {
status: "Live",
statusConfidence: "high"
};
}

if (
rawTime.includes("live") ||
rawTime.includes("progress") ||
rawTime.includes("1h") ||
rawTime.includes("2h")
) {
return {
status: "Live",
statusConfidence: "medium"
};
}

return {
status: "StatusUnknown",
statusConfidence: "low"
};
}

function getMinute(game) {
const rawTime = String(game.time_elapsed || "").toLowerCase().trim();
const minute = Number(rawTime);

if (!Number.isNaN(minute) && minute >= 0 && minute <= 130) {
return minute;
}

return null;
}

function normalizeStage(type) {
const value = String(type || "").toLowerCase().trim();

if (value === "group") return "Group Stage";
if (value === "r32") return "Round of 32";
if (value === "r16") return "Round of 16";
if (value === "qf") return "Quarterfinals";
if (value === "sf") return "Semifinals";
if (value === "third") return "Third Place";
if (value === "final") return "Final";

return type || "World Cup";
}

function normalizeTeamName(value, fallback) {
if (!value) return fallback || "TBD";

const text = String(value).trim();

if (
text === "" ||
text.toLowerCase() === "null" ||
text.toLowerCase() === "undefined"
) {
return fallback || "TBD";
}

return text;
}

function normalizeGame(game) {
const statusInfo = normalizeStatus(game);

const kickoffUnix =
parseLocalDateToUnix(game.local_date) ||
parseLocalDateToUnix(game.date) ||
parseLocalDateToUnix(game.match_date);

const homeName = normalizeTeamName(
game.home_team_name_en || game.home_team_name || game.home_name,
game.home_team_label || "TBD"
);

const awayName = normalizeTeamName(
game.away_team_name_en || game.away_team_name || game.away_name,
game.away_team_label || "TBD"
);

return {
id: String(game.id || game._id || "match-" + kickoffUnix),
home: homeName,
away: awayName,
homeScore: toNumber(game.home_score, 0),
awayScore: toNumber(game.away_score, 0),
status: statusInfo.status,
statusConfidence: statusInfo.statusConfidence,
minute: getMinute(game),
kickoffUnix: kickoffUnix,
group: String(game.group || "N/A"),
stage: normalizeStage(game.type),
events: []
};
}

function sortMatches(matches) {
return matches.sort(function (a, b) {
if (a.kickoffUnix !== b.kickoffUnix) {
return a.kickoffUnix - b.kickoffUnix;
}


return a.id.localeCompare(b.id);


});
}

function calculateDataConfidence(matches) {
if (!matches || matches.length === 0) {
return "low";
}

const highCount = matches.filter(function (match) {
return match.statusConfidence === "high";
}).length;

const ratio = highCount / matches.length;

if (ratio >= 0.8) return "high";
if (ratio >= 0.5) return "medium";
return "low";
}

function extractGames(data) {
if (Array.isArray(data)) {
return data;
}

if (data && Array.isArray(data.games)) {
return data.games;
}

if (data && Array.isArray(data.data)) {
return data.data;
}

if (data && data.games && Array.isArray(data.games.games)) {
return data.games.games;
}

return [];
}

async function fetchGamesFromFreeApi() {
const url = FREE_WORLD_CUP_BASE_URL + "/get/games";

const response = await axios.get(url, {
timeout: 20000,
headers: {
"Accept": "application/json"
}
});

const games = extractGames(response.data);

const matches = games.map(function (game) {
return normalizeGame(game);
});

return sortMatches(matches);
}

app.get("/", function (req, res) {
res.json({
ok: true,
message: "Mundial 2026 Backend para Roblox",
source: "worldcup26.ir",
endpoints: ["/health", "/worldcup/live", "/debug/raw"]
});
});

app.get("/health", function (req, res) {
res.json({
ok: true,
source: cache.source,
config: {
freeWorldCupBaseUrl: FREE_WORLD_CUP_BASE_URL,
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
const url = FREE_WORLD_CUP_BASE_URL + "/get/games";


const response = await axios.get(url, {
  timeout: 20000,
  headers: {
    "Accept": "application/json"
  }
});

const games = extractGames(response.data);

res.json({
  ok: true,
  url: url,
  rawType: Array.isArray(response.data) ? "array" : typeof response.data,
  gamesCount: games.length,
  sampleGames: games.slice(0, 3)
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
const matches = await fetchGamesFromFreeApi();


cache = {
  lastUpdated: currentTime,
  source: "worldcup26.ir",
  dataConfidence: calculateDataConfidence(matches),
  matches: matches
};

res.json(cache);


} catch (error) {
console.error("Error en /worldcup/live:", error.message);


res.json({
  lastUpdated: cache.lastUpdated || currentTime,
  source: "worldcup26.ir",
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
console.log("Usando API gratis: " + FREE_WORLD_CUP_BASE_URL);
});
