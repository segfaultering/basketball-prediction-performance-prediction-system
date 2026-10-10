import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from bpps.research import (
    Assessment,
    PlayerContext,
    PlayerResearch,
    ResearchUnavailable,
    SearchResult,
    Source,
    Update,
    unknown_assessment,
    validate_assessment,
)
from bpps.settings import Settings


def context(**changes):
    return PlayerContext.model_validate(
        {
            "player_id": "1",
            "player_name": "Alex Player",
            "game_id": "game",
            "game_date": datetime.now(UTC).date(),
            "team": "LAL",
            "opponent": "BOS",
            **changes,
        }
    )


def evidence():
    return SearchResult(
        evidence=[{"text": "Alex Player is questionable today.", "source_ids": [0]}],
        sources=[Source(id=0, title="Team report", url="https://www.nba.com/report")],
        search_suggestions_html="<div>Search suggestions</div>",
    )


def assessment(**changes):
    return Assessment.model_validate(
        {
            "availability": "questionable",
            "summary": "Reported questionable; participation remains uncertain.",
            "status_as_of": datetime.now(UTC).date(),
            "status_source_ids": [0],
            "updates": [
                Update(
                    text="Listed questionable.",
                    reported_date=datetime.now(UTC).date(),
                    source_ids=[0],
                )
            ],
            **changes,
        }
    )


class FakeBackend:
    def __init__(self):
        self.searches = 0
        self.summaries = 0
        self.result = evidence()
        self.assessment = assessment()
        self.error: Exception | None = None

    async def search(self, context: PlayerContext) -> SearchResult:
        self.searches += 1
        if self.error:
            raise self.error
        return self.result

    async def summarize(
        self, context: PlayerContext, result: SearchResult
    ) -> Assessment:
        self.summaries += 1
        return self.assessment


def researcher(backend):
    return PlayerResearch(Settings(_env_file=None, stub_mode=0), backend)


def test_graph_search_summary_validation_and_cache(monkeypatch):
    backend = FakeBackend()
    service = researcher(backend)

    async def run():
        first = await service.research(context())
        second = await service.research(context())
        assert first.availability == "questionable"
        assert str(first.sources[0].url) == "https://www.nba.com/report"
        assert first.search_suggestions_html
        assert second.cached is True
        assert second.checked_at == first.checked_at
        assert first.cached is False
        assert backend.searches == backend.summaries == 1
        await service.research(context(game_id="other-game"))
        assert backend.searches == 2
        monkeypatch.setattr("bpps.research.monotonic", lambda: float("inf"))
        await service.research(context())
        assert backend.searches == 3

    asyncio.run(run())


def test_no_grounded_evidence_does_not_infer_available():
    backend = FakeBackend()
    backend.result = SearchResult(evidence=[], sources=[])
    report = asyncio.run(researcher(backend).research(context()))
    assert report.availability == "unknown"
    assert report.status_source_ids == []
    assert backend.summaries == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"status_as_of": None},
        {"status_as_of": datetime.now(UTC).date() - timedelta(days=8)},
        {"status_as_of": datetime.now(UTC).date() + timedelta(days=1)},
        {"status_source_ids": []},
    ],
)
def test_undated_stale_or_uncited_status_becomes_unknown(changes):
    result = validate_assessment(assessment(**changes), evidence())
    assert result.availability == "unknown"
    assert result.status_as_of is None


def test_invented_citation_is_rejected_and_not_cached():
    backend = FakeBackend()
    backend.assessment = assessment(status_source_ids=[99])
    service = researcher(backend)
    with pytest.raises(ResearchUnavailable):
        asyncio.run(service.research(context()))
    assert not service.cache


def test_future_news_date_is_rejected():
    update = Update(
        text="A report from the future.",
        reported_date=datetime.now(UTC).date() + timedelta(days=1),
        source_ids=[0],
    )
    with pytest.raises(ValueError, match="future"):
        validate_assessment(assessment(updates=[update]), evidence())


def test_sdk_error_and_timeout_do_not_expose_secrets():
    for error in (RuntimeError("secret-api-key"), TimeoutError("secret-api-key")):
        backend = FakeBackend()
        backend.error = error
        with pytest.raises(ResearchUnavailable) as caught:
            asyncio.run(researcher(backend).research(context()))
        assert "secret-api-key" not in str(caught.value)


def test_missing_key_is_actionable_without_external_calls(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    service = PlayerResearch(Settings(_env_file=None, stub_mode=0))
    with pytest.raises(ResearchUnavailable, match="Set GEMINI_API_KEY"):
        asyncio.run(service.research(context()))


def test_stub_mode_never_calls_gemini_even_with_a_key():
    backend = FakeBackend()
    backend.error = AssertionError("Stub mode used Gemini")
    service = PlayerResearch(
        Settings(_env_file=None, stub_mode=1, gemini_api_key="test-secret"), backend
    )
    report = asyncio.run(service.research(context()))
    assert report.stub_mode is True
    assert report.availability == "unknown"
    assert report.sources == []
    assert backend.searches == backend.summaries == 0


@pytest.mark.parametrize(
    "url", ["http://nba.com/report", "javascript:alert(1)", "https://user:pass@nba.com"]
)
def test_source_links_require_safe_https(url):
    with pytest.raises(ValidationError):
        Source(id=0, title="Unsafe", url=url)


def test_research_settings_keep_key_secret():
    settings = Settings(_env_file=None, gemini_api_key="private-key")
    assert "private-key" not in repr(settings)
    assert "private-key" not in settings.model_dump_json()
    assert unknown_assessment().availability == "unknown"


def grounded_response():
    from google.genai import types

    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                grounding_metadata=types.GroundingMetadata(
                    grounding_chunks=[
                        types.GroundingChunk(
                            web=types.GroundingChunkWeb(
                                title="Team report", uri="https://www.nba.com/report"
                            )
                        ),
                        types.GroundingChunk(
                            web=types.GroundingChunkWeb(
                                title="Unsafe", uri="javascript:alert(1)"
                            )
                        ),
                    ],
                    grounding_supports=[
                        types.GroundingSupport(
                            segment=types.Segment(text="Listed questionable today."),
                            grounding_chunk_indices=[0],
                        ),
                        types.GroundingSupport(
                            segment=types.Segment(text="Unsupported claim."),
                            grounding_chunk_indices=[1, 99],
                        ),
                    ],
                    search_entry_point=types.SearchEntryPoint(
                        rendered_content="<div>Google Search</div>"
                    ),
                )
            )
        ]
    )


def test_grounding_extracts_only_cited_passages_and_safe_source_links():
    from google.genai import types

    from bpps.research import extract_grounding

    result = extract_grounding(grounded_response())
    assert result.evidence == [
        {"text": "Listed questionable today.", "source_ids": [0]}
    ]
    assert len(result.sources) == 1
    assert result.search_suggestions_html == "<div>Google Search</div>"
    empty = extract_grounding(types.GenerateContentResponse())
    assert empty.evidence == empty.sources == []


def test_gemini_adapter_enables_real_search_then_structured_summary(monkeypatch):
    from google.genai import types

    from bpps.research import GeminiBackend

    class FakeSDK:
        def __init__(self):
            self.aio = self
            self.models = self
            self.requests = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def generate_content(self, **kwargs):
            self.requests.append(kwargs)
            if len(self.requests) == 1:
                return grounded_response()
            return types.GenerateContentResponse(
                candidates=[
                    types.Candidate(
                        content=types.Content(
                            parts=[types.Part(text=assessment().model_dump_json())]
                        )
                    )
                ]
            )

    backend = GeminiBackend(Settings(_env_file=None, gemini_api_key="test-key"))
    sdk = FakeSDK()
    monkeypatch.setattr(backend, "client", lambda: sdk)

    async def run():
        result = await backend.search(context())
        summary = await backend.summarize(context(), result)
        assert summary.availability == "questionable"
        search_config = sdk.requests[0]["config"]
        assert search_config.tools[0].google_search is not None
        summary_config = sdk.requests[1]["config"]
        assert summary_config.response_mime_type == "application/json"
        assert "availability" in summary_config.response_json_schema["properties"]
        assert "Alex Player" in sdk.requests[0]["contents"]

    asyncio.run(run())


def test_grounding_support_can_reference_utf8_bytes_without_repeating_text():
    from google.genai import types

    from bpps.research import extract_grounding

    response = grounded_response()
    assert response.candidates
    candidate = response.candidates[0]
    assert candidate.grounding_metadata is not None
    candidate.content = types.Content(
        parts=[types.Part(text="Update: José is out. Uncited commentary.")]
    )
    candidate.grounding_metadata.grounding_supports = [
        types.GroundingSupport(
            segment=types.Segment(
                part_index=0,
                start_index=len(b"Update: "),
                end_index=len("Update: José is out.".encode()),
            ),
            grounding_chunk_indices=[0],
        )
    ]
    result = extract_grounding(response)
    assert result.evidence == [{"text": "José is out.", "source_ids": [0]}]
