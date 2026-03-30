from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st



def render_schedule_chart(schedule_df: pd.DataFrame) -> None:
    if schedule_df.empty:
        st.info("No schedule data available for charting.")
        return
    df = schedule_df.copy()
    df["matchup"] = df["away"] + " at " + df["home"]
    fig = px.bar(df, x="matchup", y=["away_score", "home_score"], barmode="group", title="Today's Score Snapshot")
    fig.update_layout(height=420, margin=dict(l=20, r=20, t=50, b=20))
    st.plotly_chart(fig, use_container_width=True)



def render_team_score_chart(schedule_df: pd.DataFrame, team_name: str) -> None:
    if schedule_df.empty:
        st.info("No team score data available.")
        return
    team_games = schedule_df[(schedule_df["away"] == team_name) | (schedule_df["home"] == team_name)].copy()
    if team_games.empty:
        st.info("No games found for the selected team today.")
        return

    team_runs = []
    opp_runs = []
    labels = []
    for _, row in team_games.iterrows():
        away = row.get("away")
        home = row.get("home")
        away_score = row.get("away_score", 0)
        home_score = row.get("home_score", 0)
        labels.append(f"{away} at {home}")
        if away == team_name:
            team_runs.append(away_score)
            opp_runs.append(home_score)
        else:
            team_runs.append(home_score)
            opp_runs.append(away_score)

    plot_df = pd.DataFrame({"Game": labels, "Team Runs": team_runs, "Opponent Runs": opp_runs})
    fig = px.bar(plot_df, x="Game", y=["Team Runs", "Opponent Runs"], barmode="group", title=f"{team_name} Run Snapshot")
    fig.update_layout(height=420, margin=dict(l=20, r=20, t=50, b=20))
    st.plotly_chart(fig, use_container_width=True)
