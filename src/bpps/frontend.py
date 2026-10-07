"""Simple Gradio interface backed by the same service as the REST endpoints."""

from datetime import UTC, date, datetime

import gradio as gr
from fastapi import HTTPException
from pydantic import ValidationError

from .data import ScheduledGame
from .model import STATS
from .service import PredictionRequest, PredictionService


class FrontendController:
    def __init__(self, service: PredictionService):
        self.service = service

    def load_games(self, selected_date: str):
        try:
            games = self.service.games(date.fromisoformat(selected_date))["games"]
            choices = [
                (
                    f"{g['away_team']} at {g['home_team']} · {g.get('tipoff_utc', g['date'])}",
                    g["game_id"],
                )
                for g in games
            ]
            message = (
                f"Found {len(games)} scheduled games. Select a game."
                if games
                else "No scheduled games on this UTC date. Try another date."
            )
            return choices, games, message
        except (ValueError, HTTPException) as exc:
            return [], [], error_message(exc)

    def load_players(self, game_id: str | None, games: list[ScheduledGame]):
        game = next((g for g in games if g["game_id"] == game_id), None)
        if game is None:
            return [], "Load games and select a scheduled game first."
        game_date = date.fromisoformat(game["date"])
        start = game_date.year if game_date.month >= 7 else game_date.year - 1
        season = f"{start}-{str(start + 1)[-2:]}"
        try:
            choices: list[tuple[str, str]] = []
            for team_id, team in (
                (game["home_team_id"], game["home_team"]),
                (game["away_team_id"], game["away_team"]),
            ):
                for player in self.service.players(team_id, season)["players"]:
                    choices.append(
                        (
                            f"{player['PLAYER']} ({team})",
                            str(player["PLAYER_ID"]),
                        )
                    )
            return (
                choices,
                "Select a player, then predict."
                if choices
                else "No roster players returned for this game.",
            )
        except (ValueError, HTTPException) as exc:
            return [], error_message(exc)

    def predict(
        self,
        game_id: str | None,
        player_id: str | None,
        seasons: str,
        override_minutes: bool,
        minutes: float,
    ):
        if not game_id or not player_id:
            return [], None, "Select a game and a player first."
        try:
            body = PredictionRequest(
                game_id=game_id,
                player_id=player_id,
                seasons=[s.strip() for s in seasons.split(",") if s.strip()],
                minutes=minutes if override_minutes else None,
            )
            result = self.service.prediction(body)
            rows = [
                [
                    stat.title(),
                    result["stats"][stat]["prediction"],
                    *result["stats"][stat]["approximate_80pct_range"],
                ]
                for stat in STATS
            ]
            message = (
                f"Estimated minutes: {result['projected_minutes']} · "
                f"Historical games: {result['history_games']}\n\n"
                + "\n\n".join(result["warnings"])
            )
            return rows, result, message
        except (ValueError, HTTPException) as exc:
            return [], None, error_message(exc)


def error_message(exc: ValueError | HTTPException) -> str:
    if isinstance(exc, ValidationError):
        return "Check your inputs: " + "; ".join(
            str(e["msg"]) for e in exc.errors(include_input=False)
        )
    return str(exc.detail) if isinstance(exc, HTTPException) else str(exc)


def build_frontend(service: PredictionService) -> gr.Blocks:
    controller = FrontendController(service)
    today = datetime.now(UTC).date()
    start = today.year if today.month >= 7 else today.year - 1
    seasons_default = f"{start - 1}-{str(start)[-2:]}, {start}-{str(start + 1)[-2:]}"
    mode = (
        "**Stub mode · synthetic data**" if service.stub else "**Live mode · NBA data**"
    )
    with gr.Blocks(title="NBA Player Predictions", analytics_enabled=False) as ui:
        gr.Markdown(
            "# NBA Player Predictions\nChoose a scheduled game and player to estimate points, rebounds, assists, steals, and blocks."
        )
        gr.Markdown(mode)
        games_state = gr.State([])
        with gr.Row():
            selected_date = gr.Textbox(
                label="Game date (UTC)",
                value=today.isoformat(),
                placeholder="YYYY-MM-DD",
            )
            load_button = gr.Button("Load games")
        game = gr.Dropdown(label="Scheduled game", choices=[], interactive=True)
        player = gr.Dropdown(label="Player", choices=[], interactive=True)
        with gr.Row():
            seasons = gr.Textbox(
                label="History seasons (comma-separated)", value=seasons_default
            )
            override = gr.Checkbox(label="Set expected minutes", value=False)
            minutes = gr.Slider(
                0, 48, value=32, step=1, label="Expected minutes", interactive=False
            )
        predict_button = gr.Button("Predict player stats", variant="primary")
        status = gr.Markdown(
            "Load games to get started. Predictions assume the player participates."
        )
        results = gr.Dataframe(
            headers=["Stat", "Prediction", "Range low", "Range high"],
            datatype=["str", "number", "number", "number"],
            value=[],
            interactive=False,
            label="Predictions and approximate 80% ranges",
        )
        with gr.Accordion("Prediction details", open=False):
            details = gr.JSON(label="Full prediction")

        def load(selected_date):
            choices, games, message = controller.load_games(selected_date)
            return (
                gr.Dropdown(choices=choices, value=None),
                games,
                gr.Dropdown(choices=[], value=None),
                [],
                None,
                message,
            )

        def players(game_id, games):
            choices, message = controller.load_players(game_id, games)
            return gr.Dropdown(choices=choices, value=None), [], None, message

        load_button.click(
            load,
            inputs=[selected_date],
            outputs=[game, games_state, player, results, details, status],
        )
        game.input(
            players,
            inputs=[game, games_state],
            outputs=[player, results, details, status],
        )
        player.input(
            lambda: ([], None, "Ready to predict."),
            inputs=[],
            outputs=[results, details, status],
        )
        override.change(
            lambda enabled: gr.Slider(interactive=enabled),
            inputs=override,
            outputs=minutes,
        )
        predict_button.click(
            controller.predict,
            inputs=[game, player, seasons, override, minutes],
            outputs=[results, details, status],
        )
    return ui
