"""
HTTP caching on read endpoints.

The archive changes when an ingest cycle finishes, not when someone opens a
page, so most reads are the same bytes served again. What matters here is the
allowlist: whether a response may be stored is a property of the endpoint,
and the failure that would matter is a private or fast-moving one being
cached because the rule defaulted to yes.
"""

import pytest

from app import main


class TestWhatIsCached:
    @pytest.mark.parametrize("path", [
        "/brief", "/events", "/articles?limit=2", "/countries", "/sources", "/feed.xml",
    ])
    def test_reads_carry_freshness_and_a_validator(self, client, path):
        response = client.get(path)
        assert response.status_code == 200
        assert "max-age" in response.headers.get("cache-control", "")
        assert response.headers.get("etag")

    @pytest.mark.parametrize("path", ["/health", "/agent/status", "/ingest-status"])
    def test_operational_endpoints_are_never_cached(self, client, path):
        """A cached /health reports the state of a container that may be gone."""
        assert "cache-control" not in {k.lower() for k in client.get(path).headers}

    def test_writes_are_untouched(self, client):
        """Only GET is cacheable; a POST reaching this code at all is a bug."""
        response = client.post("/agent/ask", json={"question": "hello"})
        assert "etag" not in {k.lower() for k in response.headers}


class TestConditionalRequests:
    def test_an_unchanged_read_answers_304_with_no_body(self, client):
        first = client.get("/articles?limit=3")
        etag = first.headers["etag"]

        second = client.get("/articles?limit=3", headers={"If-None-Match": etag})
        assert second.status_code == 304
        assert second.content == b""

    def test_a_different_query_is_not_served_from_the_same_validator(self, client):
        etag = client.get("/articles?limit=3").headers["etag"]
        other = client.get("/articles?limit=5", headers={"If-None-Match": etag})
        assert other.status_code == 200

    def test_a_stale_validator_gets_the_new_body(self, client):
        response = client.get("/brief", headers={"If-None-Match": '"not-the-current-one"'})
        assert response.status_code == 200
        assert response.content

    def test_the_validator_is_stable_across_identical_reads(self, client):
        assert client.get("/countries").headers["etag"] == \
            client.get("/countries").headers["etag"]


class TestBodyIntegrity:
    """The middleware rebuilds the response, which is where truncation hides."""

    def test_the_body_still_parses(self, client):
        response = client.get("/articles?limit=3")
        assert isinstance(response.json(), dict)

    def test_content_length_matches_what_was_sent(self, client):
        """A stale content-length copied from the original truncates the body."""
        response = client.get("/events")
        assert response.headers["content-length"] == str(len(response.content))

    def test_xml_keeps_its_content_type(self, client):
        assert "xml" in client.get("/feed.xml").headers["content-type"]
        assert "xml" in client.get("/sitemap.xml").headers["content-type"]


class TestPolicy:
    def test_sub_paths_inherit_the_longest_matching_prefix(self):
        assert main._cache_seconds("/events/abc123") == main.CACHEABLE["/events"]

    def test_unlisted_paths_are_not_cached(self):
        assert main._cache_seconds("/agent/ask") is None
        assert main._cache_seconds("/snapshot") is None

    def test_a_prefix_does_not_capture_an_unrelated_sibling(self):
        """/articles must not make /articles-export cacheable by accident."""
        assert main._cache_seconds("/articles-export") is None
