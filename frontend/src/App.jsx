import React, { useState } from 'react';
import Dashboard from './pages/Dashboard';
import SplashScreen from './components/SplashScreen';
import { AnimatePresence } from 'framer-motion';

function App() {
    const [isLoading, setIsLoading] = useState(true);

    return (
        <div className="min-h-screen bg-background">
            <AnimatePresence mode="wait">
                {isLoading ? (
                    <SplashScreen key="splash" onComplete={() => setIsLoading(false)} />
                ) : (
                    <div key="dashboard" className="animate-fade-in">
                        <Dashboard />
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default App;
