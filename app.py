from __future__ import annotations

from datetime import date

import streamlit as st

from charts import render_schedule_chart, render_team_score_chart
from data_helpers import (
    build_live_box_df,
    build_schedule_table,
    build_summary_df,
    build_team_snapshot,
    build_trend_df,
    safe_team_row,
)
from formatting import coerce_int
from mlb_api import build_schedule_df, choose_game_pk, get_live_summary, load_teams

st.set_page_config(page_title="MLB Dashboard", layout="wide")

st.title("Live MLB Analytics Dashboard")
st.caption("Stable Streamlit version built for GitHub + Streamlit Cloud deployment.")

with st.container(border=True):
    st.markdown(
        "Streamlit app powered by MLB StatsAPI with a stability-first layout. "
        "If MLB live endpoints are missing or empty, the app still loads and shows team and schedule data."
    )

teams_df, teams_warning = load_teams()
if teams_warning:
    st.warning(teams_warning)

if teams_df.empty:
    st.error("Teams could not be loaded. The app shell is running, but no team list is available.")
    st.stop()

team_names = teams_df["name"].tolist()
default_team = "Kansas City Royals" if "Kansas City Royals" in team_names else team_names[0]

with st.sidebar:
    st.header("Controls")
    selected_team = st.selectbox("Select team", team_names, index=team_names.index(default_team))
    selected_date = st.date_input("Schedule date", value=date.today())
    refresh = st.button("Refresh Data", use_container_width=True)
    st.caption("This version prioritizes reliable loading over advanced features.")

team_row = safe_team_row(teams_df, selected_team)
team_id = coerce_int(team_row.get("id") if team_row is not None else 0, 0)

schedule_df, schedule_error = build_schedule_df(team_id=team_id, target_date=str(selected_date))
if refresh:
    st.cache_data.clear()

if schedule_error:
    st.warning(f"Schedule call had an issue: {schedule_error}")

snapshot = build_team_snapshot(team_row, schedule_df)
summary_df = build_summary_df(snapshot)
trend_df = build_trend_df(schedule_df, selected_team)
schedule_table = build_schedule_table(schedule_df)

selected_game_pk = choose_game_pk(schedule_df)
live_summary, live_error = get_live_summary(selected_game_pk)
if live_error:
    st.info(f"Live game feed unavailable right now: {live_error}")

col1, col2, col3, col4 = st.columns(4)
col1.metric("Selected Team", snapshot.get("team", "-"))
col2.metric("Games Today", snapshot.get("games_today", 0))
col3.metric("Runs For", snapshot.get("runs_for", 0))
col4.metric("Runs Against", snapshot.get("runs_against", 0))

summary_tab, schedule_tab, trends_tab, live_tab = st.tabs(["Summary", "Schedule", "Trends", "Live Feed"])

with summary_tab:
    st.subheader("Team Summary")
    st.dataframe(summary_df, use_container_width=True, hide_index=True)
    render_team_score_chart(schedule_df, selected_team)

with schedule_tab:
    st.subheader("Today's Team Schedule")
    if schedule_table.empty:
        st.info("No games found for the selected team and date.")
    else:
        st.dataframe(schedule_table, use_container_width=True, hide_index=True)
        render_schedule_chart(schedule_df)

with trends_tab:
    st.subheader("Trend Snapshot")
    if trend_df.empty:
        st.info("No trend rows available yet.")
    else:
        st.dataframe(trend_df, use_container_width=True, hide_index=True)
    st.caption("Trend logic here is intentionally simple and stable. Advanced metrics can be layered in after deployment is confirmed.")

with live_tab:
    st.subheader("Live Feed")
    live_df = build_live_box_df(live_summary)
    if live_df.empty:
        st.info("No live game feed is available for the selected team and date.")
    else:
        st.dataframe(live_df, use_container_width=True, hide_index=True)

st.divider()
st.caption("Version v9: flat file structure, safe numeric coercion, safe game selection, and graceful MLB API fallback handling.")
