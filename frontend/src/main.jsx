import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Note: global handlers that blocked contextmenu/copy/cut/selectstart/dragstart
// were removed. They broke ordinary use (users could not copy a headline or
// open a report in a new tab) while providing no real protection — the data is
// served by a public API and the page source is fully readable.

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
