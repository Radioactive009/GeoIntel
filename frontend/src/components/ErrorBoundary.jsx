import React from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

/**
 * Stops one failing component from blanking the whole site.
 *
 * Without this, any render-time error unmounts the entire tree and the reader
 * gets a white page with nothing to act on.
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('[GeoIntel] render error', error, info);
    }

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className="min-h-[60vh] flex items-center justify-center px-6">
                <div className="glass rounded-2xl p-10 max-w-md text-center space-y-5">
                    <AlertOctagon size={40} className="text-risk-high mx-auto" />
                    <div className="space-y-2">
                        <h1 className="text-xl font-bold text-ink font-display">Something went wrong</h1>
                        <p className="text-sm text-body leading-relaxed">
                            This section failed to load. The rest of the site is still available.
                        </p>
                    </div>
                    <button
                        onClick={() => this.setState({ error: null })}
                        className="btn-primary inline-flex items-center gap-2"
                    >
                        <RotateCcw size={14} />
                        Try again
                    </button>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
