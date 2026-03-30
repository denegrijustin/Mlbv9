from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from formatting import clean_text, coerce_float, coerce_int, format_record, safe_pct, stoplight

SEASON_DEFAULT = date.today().year


def safe_team_row(teams_df: pd.DataFrame, team_name: str) -> pd.Series | None:
    if teams_df.empty or "name" not in teams_df.columns:
        return None
    matches = teams_df.loc[teams_df["name"] == team_name]
    if matches.empty:
        return None
    return matches.iloc[0]


def build_team_snapshot(team_row: pd.Series | None, schedule_df: pd.DataFrame) -> dict[str, Any]:
    team_name = clean_text(team_row.get("name") if team_row is not None else None, "Team")
    division = clean_text(team_row.get("division") if team_row is not None else None)
    team_id = coerce_int(team_row.get("id") if team_row is not None else None, 0)

    if schedule_df.empty:
        return {
            "team_id": team_id,
            "team": team_name,
            "division": division,
            "games_today": 0,
            "runs_for": 0,
            "runs_against": 0,
            "run_diff": 0,
            "record": "0-0",
            "win_pct": 0.0,
        }

    games_today = 0
    runs_for = 0
    runs_against = 0
    wins = 0
    losses = 0

    for _, row in schedule_df.iterrows():
        away = clean_text(row.get("away"))
        home = clean_text(row.get("home"))
        if team_name not in {away, home}:
            continue
        games_today += 1
        away_score = coerce_int(row.get("away_score"), 0)
        home_score = coerce_int(row.get("home_score"), 0)
        if team_name == away:
            runs_for += away_score
            runs_against += home_score
            if away_score > home_score:
                wins += 1
            elif home_score > away_score:
                losses += 1
        else:
            runs_for += home_score
            runs_against += away_score
            if home_score > away_score:
                wins += 1
            elif away_score > home_score:
                losses += 1

    games_counted = max(wins + losses, 0)
    return {
        "team_id": team_id,
        "team": team_name,
        "division": division,
        "games_today": games_today,
        "runs_for": runs_for,
        "runs_against": runs_against,
        "run_diff": runs_for - runs_against,
        "record": format_record(wins, losses),
        "win_pct": safe_pct(wins, games_counted, 1) if games_counted else 0.0,
    }


def build_summary_df(snapshot: dict[str, Any]) -> pd.DataFrame:
    return pd.DataFrame([
        {
            "Team": snapshot.get("team", "-"),
            "Division": snapshot.get("division", "-"),
            "Games Today": snapshot.get("games_today", 0),
            "Runs For Today": snapshot.get("runs_for", 0),
            "Runs Against Today": snapshot.get("runs_against", 0),
            "Run Differential": snapshot.get("run_diff", 0),
            "Record Today": snapshot.get("record", "0-0"),
            "Win %": snapshot.get("win_pct", 0.0),
        }
    ])


def build_trend_df(schedule_df: pd.DataFrame, team_name: str) -> pd.DataFrame:
    rows = []
    if schedule_df.empty:
        return pd.DataFrame(columns=["Metric", "Value", "Trend"])

    team_games = schedule_df[(schedule_df["away"] == team_name) | (schedule_df["home"] == team_name)].copy()
    if team_games.empty:
        return pd.DataFrame(columns=["Metric", "Value", "Trend"])

    rf_values = []
    ra_values = []
    for _, row in team_games.iterrows():
        away = clean_text(row.get("away"))
        home = clean_text(row.get("home"))
        away_score = coerce_int(row.get("away_score"), 0)
        home_score = coerce_int(row.get("home_score"), 0)
        if team_name == away:
            rf_values.append(away_score)
            ra_values.append(home_score)
        else:
            rf_values.append(home_score)
            ra_values.append(away_score)

    rf_avg = round(float(np.mean(rf_values)) if rf_values else 0.0, 2)
    ra_avg = round(float(np.mean(ra_values)) if ra_values else 0.0, 2)
    diff = rf_avg - ra_avg

    rows.append({"Metric": "Average Runs For", "Value": rf_avg, "Trend": stoplight(diff)})
    rows.append({"Metric": "Average Runs Against", "Value": ra_avg, "Trend": stoplight(-diff)})
    rows.append({"Metric": "Run Differential Trend", "Value": round(diff, 2), "Trend": stoplight(diff)})
    rows.append({"Metric": "Game Count Used", "Value": len(team_games), "Trend": "🟡 Even"})
    return pd.DataFrame(rows)


def build_schedule_table(schedule_df: pd.DataFrame) -> pd.DataFrame:
    if schedule_df.empty:
        return schedule_df
    out = schedule_df.copy()
    out["matchup"] = out["away"] + " at " + out["home"]
    out["score"] = out["away_score"].astype(str) + "-" + out["home_score"].astype(str)
    cols = ["gameDate", "matchup", "score", "status", "gamePk"]
    return out[cols].rename(columns={"gameDate": "Game Date", "matchup": "Matchup", "score": "Score", "status": "Status", "gamePk": "gamePk"})


def build_live_box_df(live_summary: dict[str, Any]) -> pd.DataFrame:
    if not live_summary:
        return pd.DataFrame(columns=["Field", "Value"])
    rows = [
        {"Field": "Matchup", "Value": f"{live_summary.get('away_team', '-') } at {live_summary.get('home_team', '-') }"},
        {"Field": "Status", "Value": live_summary.get("status", "-")},
        {"Field": "Inning", "Value": f"{live_summary.get('inning_state', '-') } {live_summary.get('inning', '-') }"},
        {"Field": "Score", "Value": f"{live_summary.get('away_runs', 0)}-{live_summary.get('home_runs', 0)}"},
        {"Field": "Count", "Value": f"{live_summary.get('balls', 0)} balls, {live_summary.get('strikes', 0)} strikes, {live_summary.get('outs', 0)} outs"},
    ]
    return pd.DataFrame(rows)
