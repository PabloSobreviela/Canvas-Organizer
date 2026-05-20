import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import PrivateTestingLogsPage from './pages/PrivateTestingLogsPage';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));

function isLogsDashboardPath() {
  const path = (window.location.pathname || '').replace(/\/+$/, '').toLowerCase();
  return path === '/privatetestinglogs';
}

const appNode = isLogsDashboardPath() ? <PrivateTestingLogsPage /> : <App />;

root.render(
  process.env.NODE_ENV === 'development'
    ? appNode
    : (
      <React.StrictMode>
        {appNode}
      </React.StrictMode>
    )
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
