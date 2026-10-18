#!/usr/bin/env python3
"""Build a small Sleeper-ID keyed NFL usage-trend file from public nflverse data."""
import csv
import io
import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "usage-trends.json"
SEASON = int(os.environ.get("NFL_SEASON", datetime.now(timezone.utc).year))
STATS_URL = f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{SEASON}.csv"
IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
USER_AGENT = "SleeperGM-breakout-research/1.0"


def read_csv(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response:
        return list(csv.DictReader(io.TextIOWrapper(response, encoding="utf-8-sig")))


def num(row, *names):
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            try:
                return float(value)
            except (TypeError, ValueError):
                pass
    return 0.0


def main():
    crosswalk_rows = read_csv(IDS_URL)
    crosswalk = {}
    for row in crosswalk_rows:
        gsis = (row.get("gsis_id") or row.get("gsisId") or row.get("gsis") or "").strip()
        sleeper = (row.get("sleeper_id") or row.get("sleeperId") or "").strip()
        if gsis and sleeper and gsis.upper() not in ("NA", "N/A") and sleeper.upper() not in ("NA", "N/A"):
            crosswalk[gsis] = sleeper

    rows = read_csv(STATS_URL)
    by_player = defaultdict(list)
    max_week = 0
    for row in rows:
        season_type = (row.get("season_type") or row.get("season_type") or "REG").upper()
        if season_type not in ("REG", "REGULAR", "REGULAR_SEASON"):
            continue
        try:
            week = int(float(row.get("week") or 0))
        except ValueError:
            continue
        gsis = (row.get("player_id") or "").strip()
        sleeper_id = crosswalk.get(gsis)
        if not sleeper_id or week < 1 or week > 18:
            continue
        position = (row.get("position") or "").upper()
        if position not in ("QB", "RB", "WR", "TE"):
            continue
        by_player[sleeper_id].append({
            "week": week,
            "targets": num(row, "targets"),
            "carries": num(row, "carries", "rushing_attempts"),
            "touches": num(row, "targets") + num(row, "carries", "rushing_attempts"),
            "receptions": num(row, "receptions"),
            "yards": num(row, "receiving_yards") + num(row, "rushing_yards"),
            "team": row.get("recent_team") or row.get("team") or "",
            "position": position,
            "name": row.get("player_display_name") or row.get("player_name") or "",
        })
        max_week = max(max_week, week)

    players = {}
    for sleeper_id, games in by_player.items():
        games.sort(key=lambda item: item["week"])
        # Only use weeks with a stats row; no missing-week zeroes for inactive/bye players.
        latest_week = games[-1]["week"]
        recent = [g for g in games if latest_week - 2 <= g["week"] <= latest_week]
        previous = [g for g in games if latest_week - 5 <= g["week"] <= latest_week - 3]
        def averages(window):
            if not window:
                return {}
            return {key: round(sum(g[key] for g in window) / len(window), 2)
                    for key in ("targets", "carries", "touches", "receptions", "yards")}
        r, p = averages(recent), averages(previous)
        # Blend target/touch trends, with neutral score when there isn't enough history.
        if len(recent) >= 2 and len(previous) >= 2:
            def pct_change(a, b):
                if b <= 0:
                    return 0.0 if a <= 0 else 1.0
                return max(-1.0, min(1.0, (a - b) / b))
            target_delta = pct_change(r.get("targets", 0), p.get("targets", 0))
            touch_delta = pct_change(r.get("touches", 0), p.get("touches", 0))
            trend_score = round(max(0, min(100, 50 + 30 * target_delta + 20 * touch_delta)))
        else:
            target_delta = touch_delta = 0.0
            trend_score = 50
        players[sleeper_id] = {
            "name": games[-1]["name"],
            "team": games[-1]["team"],
            "position": games[-1]["position"],
            "lastWeek": latest_week,
            "weeksSampled": len(games),
            "recent3": r,
            "prior3": p,
            "targetDelta": round(target_delta, 3),
            "touchDelta": round(touch_delta, 3),
            "score": trend_score,
        }

    payload = {
        "schemaVersion": 1,
        "source": "nflverse stats_player_week; player ID crosswalk from DynastyProcess",
        "season": SEASON,
        "latestWeekInSource": max_week,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "playerCount": len(players),
        "players": players,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(players)} players for {SEASON}; source latest week {max_week}: {OUT}")


if __name__ == "__main__":
    main()
