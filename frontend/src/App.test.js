import { render, screen } from '@testing-library/react';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';

test('renders the independent-app, age, and direct-DeepInfra disclosures', () => {
  const { container } = render(<TermsPage />);
  expect(container).toHaveTextContent(/not an official, sponsored, or endorsed Georgia Tech or Instructure product/i);
  expect(container).toHaveTextContent(/at least 18 years old/i);
  expect(screen.getByText(/DeepInfra/i)).toBeInTheDocument();
});

test('discloses browser caching and no browser OAuth-token storage', () => {
  const { container } = render(<PrivacyPage />);
  expect(container).toHaveTextContent(/uses browser storage/i);
  expect(container).toHaveTextContent(/OAuth tokens are not stored in browser storage/i);
  expect(container).toHaveTextContent(/other devices may retain browser-only caches/i);
});
