import React from 'react';
import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'GeoIntel';
const DEFAULT_DESCRIPTION =
    'Live geopolitical news from international wire services, with every story '
    + 'attributed to a country and scored for risk.';

/**
 * Per-route document head.
 *
 * This is a client-rendered app, so a crawler that does not execute JavaScript
 * still sees only the defaults in index.html. What this *does* fix is link
 * previews — Slack, WhatsApp and X read the rendered head — and it puts the
 * structured data in place for a later move to server rendering.
 */
const Seo = ({
    title,
    description = DEFAULT_DESCRIPTION,
    image,
    type = 'website',
    path = '',
    publishedAt,
    noIndex = false,
    schema,
}) => {
    const fullTitle = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — Global Conflict & Risk Monitor`;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}${path}`;

    return (
        <Helmet prioritizeSeoTags>
            <title>{fullTitle}</title>
            <meta name="description" content={description} />
            <link rel="canonical" href={url} />
            {noIndex && <meta name="robots" content="noindex,follow" />}

            <meta property="og:site_name" content={SITE_NAME} />
            <meta property="og:type" content={type} />
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={description} />
            <meta property="og:url" content={url} />
            {image && <meta property="og:image" content={image} />}
            {publishedAt && <meta property="article:published_time" content={publishedAt} />}

            <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={description} />
            {image && <meta name="twitter:image" content={image} />}

            {schema && <script type="application/ld+json">{JSON.stringify(schema)}</script>}
        </Helmet>
    );
};

export default Seo;
