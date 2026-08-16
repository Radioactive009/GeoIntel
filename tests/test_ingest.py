"""Ingestion: batch atomicity, clustering, orphan pruning, image backfill."""

import sqlite3

from app import models
from app.services import ingest
from app.services.story import story_key


def _item(url, title, source="BBC News", image=None):
    payload = {"url": url, "title": title, "source": {"name": source}, "provider": "rss"}
    if image:
        payload["image"] = image
    return payload


class TestBatchAtomicity:
    def test_one_duplicate_url_does_not_discard_the_batch(self, db, countries, monkeypatch):
        """
        The bug this guards: articles.url is UNIQUE and the duplicate check is
        a check-then-insert, so a racing writer could claim a URL in between.
        One collision aborted the flush and lost every other row in the batch.
        """
        source = models.Source(name="Racer")
        db.add(source)
        db.commit()
        db.add(models.Article(url="http://race/3", title="already here", source_id=source.id))
        db.commit()

        # Simulate the race: the dedupe check ran before the other writer committed.
        monkeypatch.setattr(ingest, "_existing_urls", lambda _db, _urls: set())

        items = [_item(f"http://race/{i}", f"Distinct headline number {i} about Ukraine")
                 for i in range(5)]
        saved = ingest.store_articles(db, items, countries)

        assert saved == 4, "the four non-colliding rows must survive"
        assert db.query(models.Article).count() == 5

    def test_clean_batch_uses_the_bulk_path(self, db, countries):
        items = [_item(f"http://ok/{i}", f"Unique headline {i} concerning India talks")
                 for i in range(3)]
        assert ingest.store_articles(db, items, countries) == 3


class TestStoryClustering:
    def test_same_story_from_many_outlets_yields_one_canonical(self, db, countries):
        items = [
            _item("http://a/1", "Russian aerial attacks kill nine in Ukraine as Zelenskyy warns Moscow", "BBC News"),
            _item("http://b/1", "Russian Aerial Attacks Kill Nine In Ukraine, Zelenskyy Warns Moscow", "Sky News"),
            _item("http://c/1", "Ukraine: Russian aerial attacks kill nine; Zelenskyy warns Moscow", "Reuters"),
        ]
        ingest.store_articles(db, items, countries)

        canonical = db.query(models.Article).filter(models.Article.is_duplicate.is_(False)).all()
        duplicates = db.query(models.Article).filter(models.Article.is_duplicate.is_(True)).all()
        assert len(canonical) == 1
        assert len(duplicates) == 2
        assert len({a.story_key for a in canonical + duplicates}) == 1

    def test_distinct_stories_are_not_merged(self, db, countries):
        items = [
            _item("http://a/2", "India and China hold border talks in Ladakh"),
            _item("http://b/2", "Israel strikes Gaza as ceasefire collapses"),
        ]
        ingest.store_articles(db, items, countries)
        assert db.query(models.Article).filter(models.Article.is_duplicate.is_(True)).count() == 0

    def test_generic_headlines_are_never_clustered(self, db, countries):
        """Too-short headlines share no meaningful words; folding them would
        collapse unrelated articles into one."""
        items = [_item("http://a/3", "Links 8/9/2026"), _item("http://b/3", "Morning briefing")]
        ingest.store_articles(db, items, countries)
        rows = db.query(models.Article).all()
        assert all(r.story_key is None for r in rows)
        assert all(r.is_duplicate is False for r in rows)
        assert story_key("Links 8/9/2026") is None


class TestSecondaryCountry:
    def test_bilateral_story_records_both(self, db, countries):
        ingest.store_articles(db, [_item("http://x/1", "India and China hold border talks")], countries)
        article = db.query(models.Article).one()
        pair = {article.country_id, article.country_id_secondary}
        assert pair == {countries["IN"], countries["CN"]}

    def test_single_country_story_has_no_secondary(self, db, countries):
        ingest.store_articles(db, [_item("http://x/2", "India announces new budget measures")], countries)
        assert db.query(models.Article).one().country_id_secondary is None


class TestOrphanPruning:
    def test_pruning_survives_a_null_source_id(self, db, countries):
        """
        The bug this guards: NOT IN (subquery containing NULL) is NULL for
        every row, so one article with no source silently disabled pruning.
        """
        keep, orphan = models.Source(name="Keep"), models.Source(name="Orphan")
        db.add_all([keep, orphan])
        db.commit()
        db.add(models.Article(url="u1", title="t", source_id=keep.id))
        db.add(models.Article(url="u2", title="t2", source_id=None))
        db.commit()

        assert ingest.prune_orphan_sources(db) == 1
        assert db.query(models.Source).filter_by(name="Orphan").first() is None
        assert db.query(models.Source).filter_by(name="Keep").first() is not None


class TestImages:
    def test_image_is_stored_and_normalised(self, db, countries):
        ingest.store_articles(db, [
            _item("http://i/1", "Ukraine strike hits power grid", image="https://cdn.test/a.jpg"),
            _item("http://i/2", "India budget talks continue today", image="/relative/path.jpg"),
            _item("http://i/3", "China issues trade statement now", image="data:image/png;base64,xx"),
        ], countries)
        by_url = {a.url: a for a in db.query(models.Article).all()}
        assert by_url["http://i/1"].image_url == "https://cdn.test/a.jpg"
        assert by_url["http://i/2"].image_url is None, "relative URLs cannot render"
        assert by_url["http://i/3"].image_url is None, "data: URLs are rejected"

    def test_artwork_backfills_onto_an_existing_article(self, db, countries):
        """Duplicate URLs are skipped, so a row stored before the feed carried
        artwork would otherwise stay blank forever."""
        ingest.store_articles(db, [_item("http://i/9", "Ukraine strike hits power grid")], countries)
        assert db.query(models.Article).one().image_url is None

        ingest.store_articles(
            db, [_item("http://i/9", "Ukraine strike hits power grid", image="https://cdn.test/late.jpg")],
            countries,
        )
        assert db.query(models.Article).one().image_url == "https://cdn.test/late.jpg"


class TestFeedTextIsProse:
    """A feed's escaped punctuation was published verbatim: story pages read
    "Romania&#039;s Defence Ministry", which is the sort of detail that makes
    a site look unfinished regardless of what else is on it."""

    def test_entities_are_decoded(self):
        from app.services.rss_service import plain_text
        assert plain_text("Romania&#039;s reply") == "Romania's reply"
        assert plain_text("Fish &amp; chips") == "Fish & chips"

    def test_markup_is_stripped_however_it_arrives(self):
        from app.services.rss_service import plain_text
        assert plain_text("<b>bold</b> text") == "bold text"
        # Escaped markup would become real markup if decoding ran last.
        assert plain_text("&lt;script&gt;alert(1)&lt;/script&gt; after") == "alert(1) after"

    def test_empty_input_is_an_empty_string(self):
        from app.services.rss_service import plain_text
        assert plain_text(None) == ""
        assert plain_text("") == ""
        assert plain_text("   ") == ""
