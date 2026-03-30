from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import pandas as pd
import requests

from formatting import clean_text, coerce_int

BASE_URL = "https://statsapi.mlb.com/api/v1"
TIMEOUT = 20
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
}


class MLBApiError(Exception):
    pass


@dataclass
class MLBClient:
    base_url: str = BASE_URL
    timeout: int = TIMEOUT

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        response = requests.get(url, params=params or {}, timeout=self.timeout, headers=HEADERS)
        if not response.ok:
            detail = ""
            try:
                detail = response.text[:300]
            except Exception:
                detail = ""
            raise MLBApiError(f"MLB API HTTP {response.status_code} for {path}. {detail}")
        try:
            return response.json()
        except Exception as exc:
            raise MLBApiError(f"Invalid JSON for {path}: {exc}") from exc

    def get_teams(self) -> list[dict[str, Any]]:
        data = self._get("/teams", {"sportId": 1})
        return data.get("teams", [])

    def get_schedule(self, target_date: str | None = None, team_id: int | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"sportId": 1, "date": target_date or str(date.today())}
        if team_id:
            params["teamId"] = team_id
        data = self._get("/schedule", params)
        dates = data.get("dates", [])
        if not dates:
            return []
        return dates[0].get("games", [])

    def get_live_feed(self, game_pk: int) -> dict[str, Any]:
        return self._get(f"/game/{game_pk}/feed/live")


FALLBACK_TEAMS = [
    {"id": 108, "name": "Los Angeles Angels", "abbreviation": "LAA", "division": "AL West"},
    {"id": 109, "name": "Arizona Diamondbacks", "abbreviation": "ARI", "division": "NL West"},
    {"id": 110, "name": "Baltimore Orioles", "abbreviation": "BAL", "division": "AL East"},
    {"id": 111, "name": "Boston Red Sox", "abbreviation": "BOS", "division": "AL East"},
    {"id": 112, "name": "Chicago Cubs", "abbreviation": "CHC", "division": "NL Central"},
    {"id": 113, "name": "Cincinnati Reds", "abbreviation": "CIN", "division": "NL Central"},
    {"id": 114, "name": "Cleveland Guardians", "abbreviation": "CLE", "division": "AL Central"},
    {"id": 115, "name": "Colorado Rockies", "abbreviation": "COL", "division": "NL West"},
    {"id": 116, "name": "Detroit Tigers", "abbreviation": "DET", "division": "AL Central"},
    {"id": 117, "name": "Houston Astros", "abbreviation": "HOU", "division": "AL West"},
    {"id": 118, "name": "Kansas City Royals", "abbreviation": "KC", "division": "AL Central"},
    {"id": 119, "name": "Los Angeles Dodgers", "abbreviation": "LAD", "division": "NL West"},
    {"id": 120, "name": "Washington Nationals", "abbreviation": "WSH", "division": "NL East"},
    {"id": 121, "name": "New York Mets", "abbreviation": "NYM", "division": "NL East"},
    {"id": 133, "name": "Oakland Athletics", "abbreviation": "ATH", "division": "AL West"},
    {"id": 134, "name": "Pittsburgh Pirates", "abbreviation": "PIT", "division": "NL Central"},
    {"id": 135, "name": "San Diego Padres", "abbreviation": "SD", "division": "NL West"},
    {"id": 136, "name": "Seattle Mariners", "abbreviation": "SEA", "division": "AL West"},
    {"id": 137, "name": "San Francisco Giants", "abbreviation": "SF", "division": "NL West"},
    {"id": 138, "name": "St. Louis Cardinals", "abbreviation": "STL", "division": "NL Central"},
    {"id": 139, "name": "Tampa Bay Rays", "abbreviation": "TB", "division": "AL East"},
    {"id": 140, "name": "Texas Rangers", "abbreviation": "TEX", "division": "AL West"},
    {"id": 141, "name": "Toronto Blue Jays", "abbreviation": "TOR", "division": "AL East"},
    {"id": 142, "name": "Minnesota Twins", "abbreviation": "MIN", "division": "AL Central"},
    {"id": 143, "name": "Philadelphia Phillies", "abbreviation": "PHI", "division": "NL East"},
    {"id": 144, "name": "Atlanta Braves", "abbreviation": "ATL", "division": "NL East"},
    {"id": 145, "name": "Chicago White Sox", "abbreviation": "CWS", "division": "AL Central"},
    {"id": 146, "name": "Miami Marlins", "abbreviation": "MIA", "division": "NL East"},
    {"id": 147, "name": "New York Yankees", "abbreviation": "NYY", "division": "AL East"},
    {"id": 158, "name": "Milwaukee Brewers", "abbreviation": "MIL", "division": "NL Central"},
]


def load_teams() -> tuple[pd.DataFrame, str | None]:
    client = MLBClient()
    try:
        teams = client.get_teams()
        rows = []
        for t in teams:
            rows.append(
                {
                    "id": coerce_int(t.get("id")),
                    "name": clean_text(t.get("name")),
                    "abbreviation": clean_text(t.get("abbreviation")),
                    "division": clean_text((t.get("division") or {}).get("name")),
                }
            )
        df = pd.DataFrame(rows).sort_values("name").reset_index(drop=True)
        return df, None
    except Exception as exc:
        df = pd.DataFrame(FALLBACK_TEAMS).sort_values("name").reset_index(drop=True)
        return df, f"Live MLB teams call failed. Using built-in team list instead. {exc}"


def build_schedule_df(team_id: int | None = None, target_date: str | None = None) -> tuple[pd.DataFrame, str | None]:
    client = MLBClient()
    try:
        games = client.get_schedule(target_date=target_date, team_id=team_id)
        rows = []
        for g in games:
            teams = g.get("teams", {})
            away = (teams.get("away") or {}).get("team") or {}
            home = (teams.get("home") or {}).get("team") or {}
            status = (g.get("status") or {}).get("detailedState") or (g.get("status") or {}).get("abstractGameState") or "Unknown"
            rows.append(
                {
                    "gamePk": coerce_int(g.get("gamePk"), 0),
                    "gameDate": clean_text(g.get("gameDate")),
                    "away": clean_text(away.get("name")),
                    "home": clean_text(home.get("name")),
                    "away_score": coerce_int(((teams.get("away") or {}).get("score")), 0),
                    "home_score": coerce_int(((teams.get("home") or {}).get("score")), 0),
                    "status": clean_text(status),
                }
            )
        return pd.DataFrame(rows), None
    except Exception as exc:
        return pd.DataFrame(columns=["gamePk", "gameDate", "away", "home", "away_score", "home_score", "status"]), str(exc)


def choose_game_pk(schedule_df: pd.DataFrame) -> int | None:
    if schedule_df.empty or "gamePk" not in schedule_df.columns:
        return None
    preferred_status = ["In Progress", "Manager Challenge", "Warmup", "Pre-Game", "Preview", "Final"]
    ranked = schedule_df.copy()
    ranked["status_rank"] = ranked["status"].apply(lambda x: preferred_status.index(x) if x in preferred_status else 999)
    ranked = ranked.sort_values(["status_rank", "gameDate"], ascending=[True, False])
    for _, row in ranked.iterrows():
        game_pk = coerce_int(row.get("gamePk"), 0)
        if game_pk > 0:
            return game_pk
    return None


def get_live_summary(game_pk: int | None) -> tuple[dict[str, Any], str | None]:
    if not game_pk:
        return {}, "No valid game selected for live feed."
    client = MLBClient()
    try:
        data = client.get_live_feed(game_pk)
        game_data = data.get("gameData", {})
        live_data = data.get("liveData", {})
        linescore = live_data.get("linescore", {})
        teams = game_data.get("teams", {})
        away = teams.get("away", {})
        home = teams.get("home", {})
        return {
            "gamePk": game_pk,
            "away_team": clean_text(away.get("name")),
            "home_team": clean_text(home.get("name")),
            "status": clean_text((game_data.get("status") or {}).get("detailedState")),
            "inning": clean_text(linescore.get("currentInningOrdinal"), "-"),
            "inning_state": clean_text(linescore.get("inningState"), "-"),
            "away_runs": coerce_int((linescore.get("teams") or {}).get("away", {}).get("runs"), 0),
            "home_runs": coerce_int((linescore.get("teams") or {}).get("home", {}).get("runs"), 0),
            "balls": coerce_int(linescore.get("balls"), 0),
            "strikes": coerce_int(linescore.get("strikes"), 0),
            "outs": coerce_int(linescore.get("outs"), 0),
        }, None
    except Exception as exc:
        return {}, str(exc)
