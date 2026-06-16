```js
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
  });

  return {
    source: "SportMonks",
    matches: sortMatches(matches)
  };
}
```
