/**
 * Relative age of an article, e.g. "3h ago".
 *
 * Shared so the feed card and the country dossier cannot drift apart. Feeds
 * occasionally publish timestamps a little in the future (clock skew between
 * the publisher and this machine), which is reported as "Just now" rather
 * than a negative age.
 */
export const timeAgo = (published) => {
    const ms = new Date(published).getTime();
    if (Number.isNaN(ms)) return 'Unknown';

    const diff = Date.now() - ms;
    if (diff < 0) return 'Just now';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};
