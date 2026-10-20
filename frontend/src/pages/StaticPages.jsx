import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Seo from '../components/Seo';
import { getOutletFraming, getSources, getStats } from '../services/api';

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
            A country's level is the share of its recent coverage that scored as high-risk —
            so 40% means two of every five reports about it were severe ones. Two adjustments
            matter. Outlets are weighted, so one alarming report from an aggregator moves a
            national level less than a wire report does. And a country with very few stories is
            pulled toward the global share, because three alarming articles are not evidence
            of a national threat level.
        </P>
        <P>
            This was the weighted mean of its stories, and the mean hid what it was meant to
            show. Most reporting about anywhere is unremarkable, so averaging pulled every
            country toward the middle: across 201 countries the levels spanned only 34 to 64,
            none could ever reach the critical band, and the map rendered as a single colour.
            A country whose coverage is routine apart from three catastrophes is genuinely more
            exposed than one with none, and the average said otherwise.
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

/**
 * How an outlet frames, as a bar either side of the room's consensus.
 *
 * Signed, because the direction is the whole point: left of centre means it
 * consistently reads shared events as calmer than the outlets beside it.
 */
const LeanBar = ({ divergence, max = 30 }) => {
    const clamped = Math.max(-max, Math.min(max, divergence));
    const width = `${(Math.abs(clamped) / max) * 50}%`;
    const grave = clamped > 0;
    return (
        <div className="relative h-1.5 w-full rounded-full bg-surface-sunken" aria-hidden="true">
            <div className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
            <div
                className={`absolute inset-y-0 rounded-full ${grave ? 'bg-risk-high/70' : 'bg-accent/70'}`}
                style={grave ? { left: '50%', width } : { right: '50%', width }}
            />
        </div>
    );
};

export const SourcesPage = () => {
    const [sources, setSources] = useState([]);
    const [stats, setStats] = useState(null);
    const [profiles, setProfiles] = useState([]);

    useEffect(() => {
        Promise.all([
            getSources().catch(() => null),
            getStats().catch(() => null),
            getOutletFraming({ hours: 720, limit: 24 }).catch(() => null),
        ]).then(([sourceRes, statRes, framingRes]) => {
            setSources(sourceRes?.data || []);
            setStats(statRes?.data || null);
            setProfiles(framingRes?.data?.outlets || []);
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

            {profiles.length > 0 && (
                <>
                    <H2>How they frame</H2>
                    <P>
                        When several outlets cover the same happening, each one&apos;s reporting is
                        scored for severity and compared against the others covering{' '}
                        <em>that same happening</em>. Do it across a month and a pattern appears:
                        some outlets consistently read a shared event as graver than the room, and
                        some consistently read it as calmer.
                    </P>
                    <P>
                        Because the comparison is only ever within one event, this is not a measure
                        of which outlets cover grim subjects. A wire that reports disasters and a
                        paper that reports elections are never set against each other.
                    </P>

                    <div className="mt-8 space-y-4">
                        {profiles.map((outlet) => (
                            <div key={outlet.source} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-6 gap-y-2 items-center pb-4 border-b border-rule last:border-0">
                                <div className="min-w-0">
                                    <p className="text-[14px] font-semibold text-ink">{outlet.source}</p>
                                    <p className="text-[11px] text-muted mt-0.5">
                                        {outlet.events} shared events · {outlet.reports} reports
                                        {outlet.by_topic.length > 0 && (
                                            <>
                                                {' · '}
                                                {outlet.by_topic
                                                    .map((t) => `${t.topic} ${t.divergence > 0 ? '+' : ''}${t.divergence}`)
                                                    .join(', ')}
                                            </>
                                        )}
                                    </p>
                                </div>
                                <div className="w-full sm:w-56">
                                    <LeanBar divergence={outlet.divergence} />
                                    <p className="mt-1 text-[11px] text-muted tabular-nums text-right">
                                        {outlet.divergence > 0 ? '+' : ''}{outlet.divergence} vs consensus
                                        <span className="text-faint"> · ±{outlet.consistency}</span>
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <P>
                        The figure after ± is how much that lean varies between events. A large
                        lean with a large variation is one or two loud stories rather than a
                        habit, and is worth less than a small consistent one. Outlets appear here
                        only once they have been compared on at least eight shared events.
                    </P>
                </>
            )}

            <H2>Every publication</H2>
            <div className="mt-6 columns-2 md:columns-3 gap-x-6">
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
