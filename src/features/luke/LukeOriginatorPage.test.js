import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LukeOriginatorPage from './LukeOriginatorPage';

const row = { betId: 'HAR561', event: 'Harvard vs Boston', selections: 'Harvard ML · Over 5.5', firstFillDate: '2026-11-17',
  fills: 3, status: 'Settled', totalAmount: 10000, pregameOdds: 2.5, allocationPercent: 45, lukeRisk: 3000,
  openRisk: 0, confirmsProfit: 5000, settledOdds: 1.5, lukeProfit: 1500, missingHistory: 0 };
let settings;
let settlement;
beforeEach(() => {
  settings = { allocationPercent: 45, riskWinCap: 3000, revision: 1 };
  settlement = { settledWithLuke: false, settlementRevision: 0 };
  global.fetch = jest.fn(async (url, options) => {
    if (url === '/api/luke-originator/settlements/HAR561') {
      const input = JSON.parse(options.body);
      expect(input.settlementRevision).toBe(settlement.settlementRevision);
      settlement = { settledWithLuke: input.settledWithLuke, settlementRevision: settlement.settlementRevision + 1 };
      return { ok: true, json: async () => ({ settlement: { betId: 'HAR561', ...settlement } }) };
    }
    expect(url).toBe('/api/luke-originator');
    if (options.method === 'PATCH') {
      const input = JSON.parse(options.body);
      expect(input.revision).toBe(settings.revision);
      settings = { allocationPercent: Number(input.allocationPercent), riskWinCap: Number(input.riskWinCap), revision: settings.revision + 1 };
      return { ok: true, json: async () => ({ settings }) };
    }
    return { ok: true, json: async () => ({ settings, rows: [{ ...row, ...settlement, allocationPercent: settings.allocationPercent }] }) };
  });
});
afterEach(() => { delete global.fetch; });

test('shows one row per Bet ID, saves allocation, and filters the complete group by date and status', async () => {
  render(<LukeOriginatorPage />);
  const table = await screen.findByRole('table', { name: 'Luke allocations by Bet ID' });
  expect(within(table).getAllByRole('rowheader')).toHaveLength(1);
  expect(within(table).getByRole('columnheader', { name: 'Original risk after splits' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Confirms P/L after splits' })).toBeInTheDocument();
  expect(screen.getByText(/Each partner’s current split is applied/)).toBeInTheDocument();
  const saved = within(table).getByRole('link', { name: 'HAR561' }).closest('tr');
  expect(within(saved).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
    'Harvard vs Boston', '2026-11-17', '3', 'Settled', '$10,000.00', '2.5000', '45%', '$3,000.00', '$5,000.00', '1.5000', '$1,500.00',
  ]);
  expect(screen.getByLabelText('Luke allocation (%)')).toHaveValue(45);
  expect(screen.getByLabelText('Risk / to-win cap ($)')).toHaveValue(3000);
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Risk / to-win cap ($)'), { target: { value: '2500' } });
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Luke allocation (%)'), { target: { value: '35.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Settings saved for all NCAA hockey Bet IDs.');
  expect(settings.allocationPercent).toBe(35.5);
  expect(settings.riskWinCap).toBe(2500);
  expect(screen.getByLabelText('Risk / to-win cap ($)')).toHaveValue(2500);
  expect(screen.getByText(/Above 2.00 decimal: risk capped at/)).toHaveTextContent('$2,500.00');
  expect(within(table).getByText('35.5%')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Open' } });
  expect(within(table).queryByText('HAR561')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(within(table).getByText('HAR561')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('From (ET)'), { target: { value: '2026-11-18' } });
  expect(within(table).queryByText('HAR561')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search Luke bets' }), { target: { value: 'Over 5.5' } });
  expect(within(table).getByText('HAR561')).toBeInTheDocument();
});

test('reports loading failures, retries, and warns about missing original history', async () => {
  fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Confirms unavailable.' }) });
  render(<LukeOriginatorPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirms unavailable.');
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ settings, rows: [{ ...row, missingHistory: 1 }] }) });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Confirms' }));
  expect(await screen.findByText('Original history unavailable for 1 fill')).toBeInTheDocument();
  expect(screen.getByText(/Some older fills have no complete original audit entry/)).toBeInTheDocument();
});

test('saves and restores the settlement check across app sessions and allows unchecking', async () => {
  const firstSession = render(<LukeOriginatorPage />);
  const checkbox = await screen.findByRole('checkbox', { name: 'Settled with Luke for HAR561' });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox).toBeChecked());
  expect(settlement.settledWithLuke).toBe(true);
  firstSession.unmount();
  render(<LukeOriginatorPage />);
  const restored = await screen.findByRole('checkbox', { name: 'Settled with Luke for HAR561' });
  expect(restored).toBeChecked();
  fireEvent.click(restored);
  await waitFor(() => expect(restored).not.toBeChecked());
  expect(settlement.settledWithLuke).toBe(false);
  expect(screen.getByRole('cell', { name: '$1,500.00' })).toBeInTheDocument();
});

test('a failed settlement save keeps the previous check state and reports the error', async () => {
  render(<LukeOriginatorPage />);
  const checkbox = await screen.findByRole('checkbox', { name: 'Settled with Luke for HAR561' });
  fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Unable to save settlement.' }) });
  fireEvent.click(checkbox);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save settlement.');
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeEnabled();
});
