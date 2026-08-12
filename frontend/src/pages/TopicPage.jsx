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
    military: {
        title: 'Conflict',
        standfirst: 'Strikes, offensives, troop movements and armed incidents.',
    },
    diplomatic: {
        title: 'Diplomacy',
        standfirst: 'Talks, treaties, summits and negotiated settlements.',
    },
    economic: {
        title: 'Economy',
        standfirst: 'Sanctions, trade, energy and currency pressure.',
    },
    political: {
        title: 'Politics',
        standfirst: 'Elections, governments, protest and constitutional change.',
    },
    hazard: {
        title: 'Hazards',
        standfirst: 'Chemical, biological and environmental incidents.',
    },
    other: {
        title: 'Unclassified',
        standfirst: 'Stories the classifier found no clear event signal in.',
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
