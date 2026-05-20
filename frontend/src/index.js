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

function RootApp() {
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
