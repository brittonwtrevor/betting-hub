import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PartnersPage from './PartnersPage';

const partners = [
  { id: 'a', name: 'Partner A', openExposure: 100, owedToYou: 25, owedToPartner: 0 },
  { id: 'b', name: 'Partner B', openExposure: 200, owedToYou: 0, owedToPartner: 40 },
];
const bets = [
  { id: 'a-bet', partnerId: 'a', event: 'Hockey game', selection: 'Over 5.5', stake: 100, odds: '+110', status: 'Settled', settledProfit: 110, yourShare: 55 },
  { id: 'b-bet', partnerId: 'b', event: 'Race winner', selection: 'Driver B', stake: 200, odds: '+500', status: 'Open' },
];
const payments = [
  { id: 'a-payment', partnerId: 'a', amount: 30, direction: 'Received', reference: 'A transfer', status: 'Complete' },
  { id: 'b-payment', partnerId: 'b', amount: 40, direction: 'Sent', reference: 'B transfer', status: 'Complete' },
];
beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => 'new-partner' } });
});

test('all-partners overview drills into a partner and scopes both bets and payments', async () => {
  const user = userEvent.setup();
  render(<PartnersPage partners={partners} bets={bets} payments={payments} />);
  expect(within(screen.getByRole('group', { name: 'Partners' })).getAllByRole('button').map(button => button.textContent)).toEqual(['All Partners', 'Partner A', 'Partner B']);
  const balances = screen.getByRole('table', { name: 'Partner balances' });
  await user.click(within(balances).getByRole('button', { name: 'Partner A' }));
  const reports = screen.getByRole('table', { name: 'Bet reports' });
  expect(within(reports).getByText('Hockey game / Over 5.5')).toBeInTheDocument();
  expect(within(reports).queryByText('Race winner / Driver B')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Payments', exact: true }));
  expect(screen.getByText('A transfer')).toBeInTheDocument();
  expect(screen.queryByText('B transfer')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'All Partners', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Bet reports', exact: true }));
  expect(screen.getByText('Race winner / Driver B')).toBeInTheDocument();
  await user.type(screen.getByRole('searchbox'), 'Hockey');
  expect(screen.queryByText('Race winner / Driver B')).not.toBeInTheDocument();
});

test('creates a partner tab, prevents duplicate names, and restores tabs on remount', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<PartnersPage />);
  await user.click(screen.getByRole('button', { name: 'Add partner' }));
  await user.type(screen.getByRole('textbox', { name: 'Partner name' }), '  Sam  ');
  await user.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(screen.getByRole('button', { name: 'Sam', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Sam · Bet reports' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add partner' }));
  await user.type(screen.getByRole('textbox', { name: 'Partner name' }), 'sam');
  await user.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(screen.getByRole('alert')).toHaveTextContent('already has a tab');
  unmount();
  render(<PartnersPage />);
  expect(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name: 'Sam', exact: true })).toBeInTheDocument();
});

test('does not turn missing partner balances into zero amounts', () => {
  render(<PartnersPage partners={[{ id: 'a', name: 'Unconnected partner' }]} />);
  const balances = screen.getByRole('table', { name: 'Partner balances' });
  expect(within(balances).queryByText('$0.00')).not.toBeInTheDocument();
  expect(within(balances).getAllByText('—')).toHaveLength(6);
});

test('handles invalid saved data and reports storage failures without claiming to save', () => {
  window.localStorage.setItem('betting-hub.partner-names.v1', 'invalid-json');
  render(<PartnersPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Add partner' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Partner name' }), { target: { value: 'Sam' } });
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  fireEvent.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to save');
  expect(screen.queryByRole('button', { name: 'Sam', exact: true })).not.toBeInTheDocument();
  spy.mockRestore();
});
