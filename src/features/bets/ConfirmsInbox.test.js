import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import ConfirmsInbox from './ConfirmsInbox';
import { normalizeFields } from './confirmationFields';

const reply = { botId: '1', updateId: 42, messageId: 10, kind: 'message', chat: 'trevor_partner', from: 'TrevorBRedSox', chatId: '-5550868176', text: 'HAN187 $1 -110 ML', betIds: ['HAN187'], date: '2026-11-04T18:17:00.000Z' };
const id = 'a'.repeat(64);
const base = { id: 'bet-1', sourceId: id, revision: 1, ...normalizeFields({ betId: 'HAN187', game: 'Hanwha Life Esports vs Bilibili Gaming', team: 'Hanwha Life Esports', bet: 'Moneyline', risk: 1, odds: -110, grade: 'UNGRADED' }) };
const response = (value, ok = true) => ({ ok, json: async () => value });
let stored;
beforeEach(() => {
  window.history.replaceState(null, '', '/'); window.scrollTo = jest.fn();
  stored = { sources: [{ id, revision: 2, status: 'parsed', message: reply, partner: { name: 'Trevor' }, issues: [], bets: [{ ...base }] }],
    receiver: { enabled: true, lastPolledAt: new Date().toISOString() }, parser: { configured: true, enabled: true } };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/send-drafts') return response({ drafts: [] });
    if (options.method === 'PATCH') {
      const input = JSON.parse(options.body);
      const bet = { id: input.id, sourceId: id, revision: input.revision + 1, ...normalizeFields(input) };
      stored.sources[0].bets = [bet]; return response({ bet });
    }
    if (url.endsWith('/manual')) {
      const bet = { ...base, id: 'bet-2', risk: null, odds: null, complete: false };
      stored.sources[0].bets.push(bet); stored.sources[0].revision++; return response({ bet });
    }
    return response(JSON.parse(JSON.stringify(stored)));
  });
});
afterEach(() => { delete global.fetch; jest.useRealTimers(); });

test('loads six editable fields, grading options and original source without credential controls or all-messages filter', async () => {
  render(<ConfirmsInbox />);
  await screen.findByLabelText('Bet ID for bet-1');
  for (const [label, value] of [['Bet ID', 'HAN187'], ['Game', base.game], ['Team', base.team], ['Bet', 'Moneyline'], ['Risk', '1'], ['Odds', '-110']]) expect(screen.getByLabelText(`${label} for bet-1`)).toHaveValue(value);
  const grade = screen.getByRole('combobox', { name: 'Grade for bet-1' });
  expect(within(grade).getAllByRole('option').map(option => option.value)).toEqual(['UNGRADED', 'VOID', 'WIN', 'LOSS', 'PARTRETURN']);
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('—');
  expect(screen.getByText(reply.text)).toBeInTheDocument();
  expect(screen.queryByLabelText('Bot token')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/confirms', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
});

test('edits all six fields, saves a WIN and persists net P/L', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  for (const [label, value] of [['Bet ID', 'BOS145'], ['Game', 'Other game'], ['Team', 'Other team'], ['Bet', 'Spread -1.5'], ['Risk', '500'], ['Odds', '+150']]) fireEvent.change(screen.getByLabelText(`${label} for bet-1`), { target: { value } });
  fireEvent.change(screen.getByLabelText('Grade for bet-1'), { target: { value: 'WIN' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('+$750.00');
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled());
  expect(stored.sources[0].bets[0]).toMatchObject({ betId: 'BOS145', game: 'Other game', team: 'Other team', bet: 'Spread -1.5', risk: 500, odds: 150, grade: 'WIN', pl: 750 });
  const patch = fetch.mock.calls.find(([, options]) => options.method === 'PATCH');
  expect(patch[1].headers['X-Betting-Hub']).toBe('confirms');
});

test('PARTRETURN accepts negative or positive net amounts and VOID/LOSS recalculate P/L', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Grade for bet-1');
  const grade = screen.getByLabelText('Grade for bet-1');
  fireEvent.change(grade, { target: { value: 'PARTRETURN' } });
  fireEvent.change(screen.getByLabelText('PARTRETURN net P/L for bet-1'), { target: { value: '-25.50' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('-$25.50');
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(stored.sources[0].bets[0].pl).toBe(-25.5));
  fireEvent.change(grade, { target: { value: 'LOSS' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('-$1.00');
  fireEvent.change(grade, { target: { value: 'VOID' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('$0.00');
});

test('polling does not overwrite unsaved corrections and failed saves retain edits', async () => {
  jest.useFakeTimers();
  await act(async () => { render(<ConfirmsInbox />); });
  fireEvent.change(screen.getByLabelText('Risk for bet-1'), { target: { value: '250' } });
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(screen.getByLabelText('Risk for bet-1')).toHaveValue('250');
  fetch.mockResolvedValueOnce(response({ message: 'This bet changed on another screen.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('changed on another screen');
  expect(screen.getByLabelText('Risk for bet-1')).toHaveValue('250');
  fireEvent.click(screen.getByRole('button', { name: 'Reset edits' }));
  expect(screen.getByLabelText('Risk for bet-1')).toHaveValue('1');
});

test('manual entry remains available when AI is not configured', async () => {
  stored.sources[0].bets = []; stored.sources[0].status = 'pending'; stored.parser.configured = false;
  render(<ConfirmsInbox />); await screen.findByText(/AI parsing needs/);
  expect(screen.getByRole('button', { name: 'Retry AI' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add bet manually' }));
  await screen.findByLabelText('Risk for bet-2');
  expect(screen.getByLabelText('Risk for bet-2')).toHaveValue('');
});

test('refreshes every 10 seconds, searches fields and stops refreshing when unmounted', async () => {
  jest.useFakeTimers(); let mounted;
  await act(async () => { mounted = render(<ConfirmsInbox />); });
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search saved replies' }), { target: { value: 'unrelated' } });
  expect(screen.getByText('No matching replies')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  mounted.unmount();
  await act(async () => { jest.advanceTimersByTime(20000); });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('keeps loaded data visible after an inbox refresh failure', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  fetch.mockResolvedValueOnce(response({ message: 'Database temporarily unavailable.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh replies' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Previously loaded replies remain below.');
  expect(screen.getByLabelText('Bet ID for bet-1')).toHaveValue('HAN187');
});

test('Confirms deep links and old Telegram bookmarks open the editable bet table without a Telegram tab', async () => {
  window.history.replaceState(null, '', '/#/bets');
  const mounted = render(<App />); await screen.findByText('No Sends drafts yet');
  fireEvent.click(screen.getByRole('tab', { name: 'Confirms' }));
  await screen.findByLabelText('Bet ID for bet-1');
  expect(window.location.hash).toBe('#/bets?tab=confirms');
  mounted.unmount();
  window.history.replaceState(null, '', '/#/telegram');
  render(<App />); await screen.findByLabelText('Bet ID for bet-1');
  expect(document.title).toBe('Active Bets · Betting Hub');
  expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).queryByRole('link', { name: 'Telegram', exact: true })).not.toBeInTheDocument();
});
