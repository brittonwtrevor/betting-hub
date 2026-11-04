import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { navigation } from './app/navigation';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.scrollTo = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ games: [], columns: [], source: {}, drafts: [] }) });
});
afterEach(() => { delete global.fetch; });

async function navigate(path) {
  await act(async () => {
    window.history.replaceState(null, '', `/#${path}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

test('opens Monitoring with planned connections and no invented health results', () => {
  render(<App />);
  expect(document.title).toBe('Monitoring · Betting Hub');
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(nav).getAllByRole('link')).toHaveLength(6);
  expect(within(nav).queryByRole('link', { name: 'Telegram', exact: true })).not.toBeInTheDocument();
  const sources = screen.getByRole('table', { name: 'Source health' });
  expect(within(sources).getAllByText('Not connected')).toHaveLength(7);
  expect(screen.getByText('No freshness checks have run', { exact: false })).toBeInTheDocument();
});

test('supports every workspace and sports deep links, including hash navigation', async () => {
  window.history.replaceState(null, '', '/#/sports/lol');
  render(<App />);
  expect(screen.getByRole('navigation', { name: 'Sports dashboards' })).toBeInTheDocument();
  await screen.findByText('Database connected');
  const destinations = [
    ['/bets', 'Active Bets'], ['/suggestions', 'Trading Dashboard'],
    ['/partners', 'Partner Accounting'], ['/analytics', 'Analytics'], ['/', 'Monitoring'],
  ];
  for (const [path, label] of destinations) {
    await navigate(path);
    expect(document.title).toBe(`${label} · Betting Hub`);
  }
  for (const sport of ['hockey', 'lol', 'nascar']) {
    await navigate(`/sports/${sport}`);
    expect(screen.getByRole('navigation', { name: 'Sports dashboards' })).toBeInTheDocument();
  }
  await navigate('/unknown-page');
  expect(screen.getByRole('link', { name: 'Back to Monitoring' })).toHaveAttribute('href', '#/');
});

test('filters planned sources and opens accessible source details', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Accounts', exact: true }));
  const table = screen.getByRole('table', { name: 'Source health' });
  expect(within(table).getAllByText('Not connected')).toHaveLength(2);
  await user.type(screen.getByRole('searchbox', { name: 'Search sources' }), 'Polymarket');
  expect(within(table).queryByText('Kalshi')).not.toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'View Polymarket details' });
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Polymarket' });
  expect(within(dialog).getByText('Hub ingestion')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('sidebar links change workspaces and alerts open without connecting a source', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('link', { name: 'Active Bets', exact: true }));
  await waitFor(() => expect(document.title).toBe('Active Bets · Betting Hub'));
  await user.click(screen.getByRole('button', { name: 'Open alerts' }));
  expect(screen.getByRole('dialog', { name: 'Alerts' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
