# NBA team logos

Original SVG team logos downloaded from the NBA CDN on 2026-10-10.
Each filename is the NBA team abbreviation used by the schedule API.
Team IDs were matched using nba_api.stats.static.teams.get_teams().

Source URL pattern:
https://cdn.nba.com/logos/nba/{team_id}/primary/L/logo.svg

Team directory: https://www.nba.com/teams

These are NBA/team brand assets; ownership remains with the NBA and its teams.
Files are bundled locally so the dashboard and synthetic demo require no
runtime requests to the NBA CDN. Preserve the original colors and proportions.
