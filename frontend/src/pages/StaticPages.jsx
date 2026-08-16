import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Seo from '../components/Seo';
import { getSources, getStats } from '../services/api';

/**
 * Standing pages.
 *
 * An automated risk score has to explain itself. A reader who cannot find out
 * how a number was produced has no reason to believe it, so the methodology is
 * written out plainly — including what it gets wrong.
 */

const Page = ({ children }) => (
    <div className="max-w-3xl mx-auto px-6 py-12 lg:py-16">{children}</div>
);

const H1 = ({ children }) => (
    <h1 className="font-display text-4xl font-extrabold text-ink tracking-tight mb-4">{children}</h1>
);

const Lede = ({ children }) => (
    <p className="font-serif text-xl text-body leading-relaxed mb-10">{children}</p>
);

const H2 = ({ children }) => (
    <h2 className="font-display text-xl font-bold text-ink mt-10 mb-3">{children}</h2>
);

const P = ({ children }) => (
    <p className="text-[15px] text-body leading-[1.75] mb-4 max-w-prose">{children}</p>
);

export const AboutPage = () => (
    <Page>
        <Seo
            title="About"
            description="What GeoIntel is, where its stories come from, and who builds it."
            path="/about"
        />
        <H1>About GeoIntel</H1>
        <Lede>
            GeoIntel collects geopolitical news from international wire services, works out which
            country each story is about, and scores it for risk — so you can see where the world
            is tense at a glance.
        </Lede>

        <H2>What it does</H2>
        <P>
            Every 30 minutes the pipeline pulls from a set of international feeds, plus a
            per-country search feed that covers all 249 countries in the ISO catalog on a
            rotation. Each story is attributed to the country it is <em>about</em> — read from
            the text, not from whichever query happened to fetch it — then scored, classified,
            and grouped with other outlets reporting the same event.
        </P>

        <H2>What it is not</H2>
        <P>
            It is not a newsroom. Nothing here is written or edited by a person: headlines and
            summaries come from the publishers, and every story links back to them. It is not a
            threat assessment either — the scores are a rough, automated signal meant to direct
            attention, not to support a decision that matters.
        </P>

        <H2>How it is built</H2>
        <P>
            A FastAPI backend handles ingestion, attribution and scoring; a React front end
            renders the map and the feed. It runs on free-tier infrastructure, which is why the
            scoring is deliberately lightweight — keyword tiers and a rule-based sentiment
            model rather than anything that needs a GPU.{' '}
            <Link to="/methodology" className="text-accent hover:underline">
                The methodology page
            </Link>{' '}
            sets out exactly how a score is produced.
        </P>

        <H2>Contact</H2>
        <P>
            The project is open source. Issues and pull requests are welcome via the{' '}
            <a
                href="https://github.com/Radioactive009/GeoIntel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
            >
                GitHub repository
            </a>
            , which is also the best place to reach the maintainer.
        </P>
    </Page>
);

export const MethodologyPage = () => (
    <Page>
        <Seo
            title="Methodology"
            description="How GeoIntel attributes stories to countries and produces a risk score, and where the method breaks down."
            path="/methodology"
        />
        <H1>Methodology</H1>
        <Lede>
            Every number on this site is produced by a rule you can read. This page sets out
            what those rules are — and where they are known to fail.
        </Lede>

        <H2>1. Where stories come from</H2>
        <P>
            Around a dozen international feeds are polled continuously, alongside a per-country
            search feed that rotates through the full ISO catalog so smaller countries are not
            permanently invisible. Optional commercial providers are used when API keys are
            configured. Stories older than the retention window are deleted.
        </P>

        <H2>2. Which country a story is about</H2>
        <P>
            Attribution is read from the headline and summary using a gazetteer of country
            names, aliases, demonyms and capitals. Longer names win over shorter ones, so
            "South Sudan" is not filed as Sudan, and headline mentions count double. Terms that
            are also ordinary words or common names — <em>Jordan</em>, <em>Chad</em>,{' '}
            <em>Turkey</em>, <em>Georgia</em> — are checked against the surrounding words before
            they count, so "Jordan Peterson" is not filed as Jordan and "Georgia governor" is
            not filed as Georgia the country. A story naming no country stays unattributed
            rather than being filed somewhere convenient.
        </P>

        <H2>3. How a story is scored</H2>
        <P>
            Scoring combines tiered event keywords with a rule-based sentiment reading, minus a
            de-escalation allowance for language like "ceasefire" or "no casualties". That
            allowance is withdrawn when the story contradicts itself — a collapsing ceasefire
            with casualties is not de-escalation — and when deaths are actually being reported.
            The result is a 0–100 score bucketed into stable, elevated and critical.
        </P>

        <H2>4. How a country's level is produced</H2>
        <P>
            A country's level is the weighted mean of its recent stories. Two adjustments
            matter. Outlets are weighted, so one alarming report from an aggregator moves a
            national level less than a wire report does. And a country with very few stories is
            pulled toward the global average, because a single alarming article is not evidence
            of a national threat level.
        </P>
        <P>
            Duplicate reports of one event are counted once. Otherwise a country's level would
            track how widely a story was syndicated rather than what happened.
        </P>

        <H2>5. Trends and escalation</H2>
        <P>
            Every hour, each active country's current level is recorded. The escalation board
            ranks countries by how far they have moved from their <em>own</em> recent baseline,
            measured in standard deviations, so a large move in a normally quiet country
            outranks routine noise somewhere volatile. Countries without enough history are
            skipped rather than guessed at.
        </P>

        <H2>Known limitations</H2>
        <P>
            Coverage is English-language, which under-represents places whose reporting mostly
            is not. Keyword scoring cannot read irony, quotation or hypotheticals — "warns of
            possible invasion" scores much like an invasion. Attribution favours the country
            named most often, which can misfile a story reported <em>from</em> one country{' '}
            <em>about</em> another. And the feed reflects what the wires chose to cover, so
            quiet does not mean safe; it often means nobody is reporting.
        </P>
    </Page>
);

export const SourcesPage = () => {
    const [sources, setSources] = useState([]);
    const [stats, setStats] = useState(null);

    useEffect(() => {
        Promise.all([getSources().catch(() => null), getStats().catch(() => null)])
            .then(([sourceRes, statRes]) => {
                setSources(sourceRes?.data || []);
                setStats(statRes?.data || null);
            });
    }, []);

    return (
        <Page>
            <Seo
                title="Sources"
                description="Every publication GeoIntel has drawn a story from."
                path="/sources"
            />
            <H1>Sources</H1>
            <Lede>
                Every publication that has appeared in the feed. Headlines, summaries and images
                belong to them; each story links back to the original.
            </Lede>

            {stats && (
                <P>
                    {stats.total_articles?.toLocaleString()} stories from {sources.length.toLocaleString()}{' '}
                    publications are currently held.
                </P>
            )}

            <div className="mt-8 columns-2 md:columns-3 gap-x-6">
                {sources.map((source) => (
                    <p key={source.id} className="text-[13px] text-body break-inside-avoid py-1">
                        {source.name}
                    </p>
                ))}
            </div>
            {!sources.length && (
                <p className="text-muted text-sm">Source list unavailable right now.</p>
            )}
        </Page>
    );
};

export const NotFoundPage = () => (
    <Page>
        <Seo title="Page not found" noIndex />
        <div className="py-16 text-center space-y-5">
            <p className="font-display text-6xl font-black text-ink">404</p>
            <H1>Page not found</H1>
            <P>The page you asked for does not exist, or has moved.</P>
            <Link to="/" className="btn-primary inline-block">Back to the front page</Link>
        </div>
    </Page>
);
