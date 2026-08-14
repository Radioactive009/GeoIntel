import { Suspense, lazy } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import SiteHeader from './components/SiteHeader';
import SiteFooter from './components/SiteFooter';
import ErrorBoundary from './components/ErrorBoundary';
import WakingBanner from './components/WakingBanner';
import { StoryGridSkeleton } from './components/Skeleton';
import { Analytics } from '@vercel/analytics/react';

// The map, charting and splash bundles are large and only two routes need
// them, so they are split out — the front page no longer pays for the whole
// application on first load.
const Home = lazy(() => import('./pages/Home'));
const StoryPage = lazy(() => import('./pages/StoryPage'));
const BriefPage = lazy(() => import('./pages/BriefPage'));
const EventsPage = lazy(() => import('./pages/EventsPage'));
const AskPage = lazy(() => import('./pages/AskPage'));
const EventPage = lazy(() => import('./pages/EventPage'));
const CountryPage = lazy(() => import('./pages/CountryPage'));
const TopicPage = lazy(() => import('./pages/TopicPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const AboutPage = lazy(() => import('./pages/StaticPages').then((m) => ({ default: m.AboutPage })));
const MethodologyPage = lazy(() => import('./pages/StaticPages').then((m) => ({ default: m.MethodologyPage })));
const SourcesPage = lazy(() => import('./pages/StaticPages').then((m) => ({ default: m.SourcesPage })));
const NotFoundPage = lazy(() => import('./pages/StaticPages').then((m) => ({ default: m.NotFoundPage })));

const RouteFallback = () => (
    <div className="max-w-[1440px] mx-auto px-6 py-12">
        <StoryGridSkeleton count={6} />
    </div>
);

function App() {
    const location = useLocation();

    return (
        <div className="min-h-screen flex flex-col bg-background">
            {/* Keyboard users should not have to tab through the whole
                masthead on every navigation. */}
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-cyan-500 focus:text-white focus:font-semibold"
            >
                Skip to content
            </a>

            <SiteHeader />

            <WakingBanner />

            <main id="main" className="flex-grow">
                <ErrorBoundary key={location.pathname}>
                    <Suspense fallback={<RouteFallback />}>
                        <Routes>
                            <Route
                                path="/"
                                element={<Home />}
                            />
                            <Route path="/story/:id" element={<StoryPage />} />
                            <Route path="/brief" element={<BriefPage />} />
                            <Route path="/events" element={<EventsPage />} />
                            <Route path="/ask" element={<AskPage />} />
                            <Route path="/event/:key" element={<EventPage />} />
                            <Route path="/country/:iso" element={<CountryPage />} />
                            <Route path="/topic/:topic" element={<TopicPage />} />
                            <Route path="/search" element={<SearchPage />} />
                            <Route path="/about" element={<AboutPage />} />
                            <Route path="/methodology" element={<MethodologyPage />} />
                            <Route path="/sources" element={<SourcesPage />} />
                            <Route path="*" element={<NotFoundPage />} />
                        </Routes>
                    </Suspense>
                </ErrorBoundary>
            </main>

            <SiteFooter />
            <Analytics />
        </div>
    );
}

export default App;
