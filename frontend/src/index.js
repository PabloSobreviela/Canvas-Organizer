import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import PrivateTestingLogsPage from './pages/PrivateTestingLogsPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));

function normalizePath(pathname) {
  return (pathname || '').replace(/\/+$/, '').toLowerCase();
}

function isRetiredPrototypePath(pathname) {
  return /^\/ui[1-8](?:\/.*)?$/.test(normalizePath(pathname));
}

function RetiredPrototypeRoute() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: '#09090b', color: '#fafafa' }}>
      <section style={{ maxWidth: '420px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', margin: '0 0 8px' }}>Page not found</h1>
        <p style={{ margin: '0 0 16px', color: '#a1a1aa' }}>This prototype route has been retired.</p>
        <a href="/" style={{ color: '#60a5fa' }}>Go to CanvasSync</a>
      </section>
    </main>
  );
}

function RootApp() {
  if (isRetiredPrototypePath(window.location.pathname)) {
    return <RetiredPrototypeRoute />;
  }

  const path = normalizePath(window.location.pathname);
  if (path === '/privatetestinglogs') {
    return <PrivateTestingLogsPage />;
  }
  if (path === '/terms') {
    return <TermsPage />;
  }
  if (path === '/privacy') {
    return <PrivacyPage />;
  }
  return <App />;
}

const appNode = <RootApp />;

root.render(
  process.env.NODE_ENV === 'development'
    ? appNode
    : (
      <React.StrictMode>
        {appNode}
      </React.StrictMode>
    )
);

reportWebVitals();
