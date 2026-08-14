import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import ListingPage from './ListingPage';
import Seo from '../components/Seo';

/**
 * Section fronts, built from the event types the risk engine assigns. The
 * taxonomy already existed on every article and was only ever shown as a
 * label on a card.
 */
export const TOPICS = {
    conflict: {
        title: 'Conflict',
        standfirst: 'Armed violence between states and organised forces — strikes, offensives and battles.',
    },
    security: {
        title: 'Security',
        standfirst: 'Terrorism, insurgency, organised crime, trafficking and cyber intrusions.',
    },
    diplomacy: {
        title: 'Diplomacy',
        standfirst: 'Talks, treaties, summits, mediation and negotiated settlements.',
    },
    economy: {
        title: 'Economy',
        standfirst: 'Sanctions, tariffs, trade, energy and currency pressure.',
    },
    politics: {
        title: 'Politics',
        standfirst: 'Elections, governments, courts, protest and constitutional change.',
    },
    disaster: {
        title: 'Disasters',
        standfirst: 'Earthquakes, floods, wildfires, storms and industrial catastrophe.',
    },
    humanitarian: {
        title: 'Humanitarian',
        standfirst: 'Famine, displacement, refugees, epidemics and aid operations.',
    },
    other: {
        title: 'Unclassified',
        standfirst: 'Stories the classifier could not place with confidence.',
    },
};

const TopicPage = () => {
    const { topic } = useParams();
    const config = TOPICS[topic];

    if (!config) return <Navigate to="/404" replace />;

    return (
        <>
            <Seo
                title={config.title}
                description={config.standfirst}
                path={`/topic/${topic}`}
            />
            <ListingPage
                title={config.title}
                standfirst={config.standfirst}
                filters={{ eventType: topic }}
                emptyMessage={`No ${config.title.toLowerCase()} stories in the current window.`}
            />
        </>
    );
};

export default TopicPage;
