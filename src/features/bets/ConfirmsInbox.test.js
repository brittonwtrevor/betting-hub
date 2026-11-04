import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import ConfirmsInbox from './ConfirmsInbox';
import { normalizeFields } from './confirmationFields';

const reply = { botId: '1', updateId: 42, messageId: 10, kind: 'message', chat: 'trevor_partner', from: 'TrevorBRedSox', chatId: '-5550868176', text: 'HAN187 $1 -110 ML', betIds: ['HAN187'], date: '2026-11-04T18:17:00.000Z' };
const id = 'a'.repeat(64);
const base = { id: 'bet-1', sourceId: id, revision: 1, partnerId: 'trevor', partnerName: 'Trevor', bettorName: 'Trevor Britton',
  betDate: '2026-11-04', betAt: reply.date, gameAt: '2026-11-05T00:00:00.000Z', telegramSenderId: '123', telegramSenderUsername: 'TrevorBRedSox',
  ...normalizeFields({ betId: 'HAN187', game: 'Hanwha Life Esports vs Bilibili Gaming', team: 'Hanwha Life Esports', bet: 'Moneyline', risk: 1, odds: -110, grade: 'UNGRADED' }) };
const response = (value, ok = true) => ({ ok, json: async () => value });
let stored;
beforeEach(() => {
  window.history.replaceState(null, '', '/'); window.scrollTo = jest.fn();
  stored = { sources: [{ id, revision: 2, status: 'parsed', message: reply, partner: { name: 'Trevor' }, issues: [], bets: [{ ...base }] }],
    receiver: { enabled: true, lastPolledAt: new Date().toISOString() }, parser: { configured: true, enabled: true } };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/partners') return response({ partners: [] });
    if (url === '/api/send-drafts') return response({ drafts: [] });
    if (options.method === 'PATCH') {
      const input = JSON.parse(options.body);
      const bet = { ...input, sourceId: id, revision: input.revision + 1, ...normalizeFields(input) };
      stored.sources[0].bets = [bet]; return response({ bet });
    }
    if (options.method === 'DELETE') {
      stored.sources[0].bets = []; stored.sources[0].deletedBetCount = 1;
      return response({ bet: { id: base.id, deletedAt: new Date().toISOString() } });
    }
    if (url.endsWith('/manual')) {
      const bet = { ...base, id: 'bet-2', risk: null, odds: null, complete: false };
      stored.sources[0].bets.push(bet); stored.sources[0].revision++; return response({ bet });
    }
    return response(JSON.parse(JSON.stringify(stored)));
  });
});

test('shows partner and read-only bet details, hides bettor, and preserves metadata when saving', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  expect(screen.getByLabelText('Bet ID for bet-1')).toHaveTextContent('HAN187');
  expect(screen.getByLabelText('Bet date (ET) for bet-1')).toHaveTextContent('2026-11-04');
  expect(screen.getByLabelText('Game for bet-1')).toHaveTextContent(base.game);
  for (const label of ['Bet ID', 'Bet date (ET)', 'Game']) expect(screen.getByLabelText(`${label} for bet-1`)).not.toHaveAttribute('contenteditable');
  expect(screen.queryByRole('textbox', { name: /Bet ID|Bet date|Game/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'BETTOR' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Bettor for bet-1')).not.toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Trevor' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Risk for bet-1'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(stored.sources[0].bets[0]).toMatchObject({ id: base.id, betId: base.betId, game: base.game, bettorName: base.bettorName, betDate: base.betDate, partnerId: 'trevor', risk: 250 }));
});

test('deletion can be cancelled, removes only the selected bet, and polling does not restore it', async () => {
  jest.useFakeTimers();
  await act(async () => { render(<ConfirmsInbox />); });
  fireEvent.click(screen.getByRole('button', { name: 'Delete bet' }));
  expect(screen.getByText(/Delete HAN187/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
  expect(fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Delete bet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  await act(async () => {});
  expect(screen.queryByLabelText('Bet ID for bet-1')).not.toBeInTheDocument();
  expect(screen.getByText(/1 deleted bet/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry AI' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/confirms/bets/bet-1', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ revision: 1 }) }));
  // An older in-flight refresh must not resurrect a row just deleted locally.
  stored.sources[0].bets = [{ ...base }];
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(screen.queryByLabelText('Bet ID for bet-1')).not.toBeInTheDocument();
});

test('a failed delete keeps the saved bet visible with an error', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  fireEvent.click(screen.getByRole('button', { name: 'Delete bet' }));
  fetch.mockResolvedValueOnce(response({ message: 'This bet changed on another screen.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed on another screen');
  expect(screen.getByLabelText('Bet ID for bet-1')).toBeInTheDocument();
});
afterEach(() => { delete global.fetch; jest.useRealTimers(); });

test('shows queued and failed Telegram receipts and refreshes their delivery status', async () => {
  stored.sources[0].bets[0].notifications = [{ id: 'receipt-1', kind: 'logged', status: 'pending' },
    { id: 'receipt-2', kind: 'grade', status: 'error', error: 'Bot cannot access that chat.' }];
  render(<ConfirmsInbox />);
  expect(await screen.findByText('Telegram log: Queued')).toBeInTheDocument();
  expect(screen.getByText(/Telegram grade: Delivery failed/)).toHaveTextContent('Bot cannot access that chat.');
  stored.sources[0].bets[0].notifications[0].status = 'sent';
  fireEvent.click(screen.getByRole('button', { name: 'Refresh replies' }));
  expect(await screen.findByText('Telegram log: Sent')).toBeInTheDocument();
});

test('loads editable wager fields, grading options and original source without credential controls or all-messages filter', async () => {
  render(<ConfirmsInbox />);
  await screen.findByLabelText('Bet ID for bet-1');
  for (const [label, value] of [['Team', base.team], ['Bet', 'Moneyline'], ['Risk', '1'], ['Odds', '-110']]) expect(screen.getByLabelText(`${label} for bet-1`)).toHaveValue(value);
  const grade = screen.getByRole('combobox', { name: 'Grade for bet-1' });
  expect(within(grade).getAllByRole('option').map(option => option.value)).toEqual(['UNGRADED', 'VOID', 'WIN', 'LOSS', 'PARTRETURN']);
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('—');
  expect(screen.getByText(reply.text)).toBeInTheDocument();
  expect(screen.queryByLabelText('Bot token')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/confirms', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
});

test('edits wager fields, saves a WIN and persists net P/L', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  for (const [label, value] of [['Team', 'Other team'], ['Bet', 'Spread -1.5'], ['Risk', '500'], ['Odds', '+150']]) fireEvent.change(screen.getByLabelText(`${label} for bet-1`), { target: { value } });
  fireEvent.change(screen.getByLabelText('Grade for bet-1'), { target: { value: 'WIN' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('+$750.00');
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled());
  expect(stored.sources[0].bets[0]).toMatchObject({ betId: base.betId, game: base.game, team: 'Other team', bet: 'Spread -1.5', risk: 500, odds: 150, grade: 'WIN', pl: 750 });
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
  expect(screen.getByLabelText('Bet ID for bet-1')).toHaveTextContent('HAN187');
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
