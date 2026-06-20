import { render, screen } from '@testing-library/react';
import TermsPage from './pages/TermsPage';

test('renders the independent-app and direct-DeepInfra disclosures', () => {
  const { container } = render(<TermsPage />);
  expect(container).toHaveTextContent(/not an official Georgia Tech or Instructure product/i);
  expect(screen.getByText(/DeepInfra \(direct AI inference\)/i)).toBeInTheDocument();
});
