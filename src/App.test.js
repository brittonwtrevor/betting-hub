import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { navigation } from './app/navigation';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.scrollTo = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ games: [], columns: [], source: {}, drafts: [], partners: [], bets: [], feeds: [], tasks: [] }) });
});
afterEach(() => { delete global.fetch; });

async function navigate(path) {
  await act(async () => {
    window.history.replaceState(null, '', `/#${path}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

test('opens Monitoring and reports missing publication timestamps', async () => {
  render(<App />);
  expect(document.title).toBe('Monitoring · Betting Hub');
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(nav).getAllByRole('link')).toHaveLength(7);
  expect(within(nav).queryByRole('link', { name: 'Telegram', exact: true })).not.toBeInTheDocument();
  const sources = screen.getByRole('table', { name: 'Source health' });
  expect(within(sources).getAllByText('Not connected')).toHaveLength(5);
  expect(await within(sources).findAllByText('No timestamp')).toHaveLength(2);
  expect(screen.getByText('Run history requires collector telemetry.')).toBeInTheDocument();
});

test('supports every workspace and sports deep links, including hash navigation', async () => {
  window.history.replaceState(null, '', '/#/sports/lol');
  render(<App />);
  expect(screen.getByRole('navigation', { name: 'Sports dashboards' })).toBeInTheDocument();
  await screen.findByText('Database connected');
  const destinations = [
    ['/bets', 'Active Bets'], ['/suggestions', 'Trading Dashboard'],
    ['/partners', 'Partner Accounting'], ['/analytics', 'Analytics'],
    ['/project-management', 'Project Management'], ['/', 'Monitoring'],
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

test('saves all five project task fields and reloads the saved task from the API', async () => {
  window.history.replaceState(null, '', '/#/project-management');
  const id = '0e6f4608-8a57-4b8f-8289-6c1cd2e7fd63';
  const originalCrypto = Object.getOwnPropertyDescriptor(window, 'crypto');
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => id } });
  const defaultFetch = fetch.getMockImplementation();
  const fields = { category: 'Data', importance: 'High', taskName: 'Refresh goalie inputs', sport: 'Hockey', effort: 'Medium' };
  let savedTask;
  fetch.mockImplementation(async (url, options) => {
    if (url !== '/api/project-tasks') return defaultFetch(url, options);
    if (options.method !== 'POST') return { ok: true, json: async () => ({ tasks: savedTask ? [savedTask] : [] }) };
    savedTask = JSON.parse(options.body);
    return { ok: true, json: async () => ({ task: savedTask }) };
  });

  try {
    const { unmount } = render(<App />);
    await screen.findByText('No tasks yet.');
    for (const [label, value] of Object.entries({ Category: fields.category, Importance: fields.importance, 'Task Name': fields.taskName, Sport: fields.sport, Effort: fields.effort })) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    await screen.findByRole('cell', { name: fields.taskName });
    expect(savedTask).toEqual({ id, ...fields });

    unmount();
    render(<App />);
    const row = await screen.findByRole('row', { name: 'Data High Refresh goalie inputs Hockey Medium' });
    expect(within(row).getAllByRole('cell')).toHaveLength(5);
  } finally {
    if (originalCrypto) Object.defineProperty(window, 'crypto', originalCrypto);
    else delete window.crypto;
  }
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


test('Raw Bet Data filters confirmed bets and downloads all matching rows across pages', async () => {
  const fill = { partnerId: 'a', partnerName: 'Partner A', betDate: '2026-11-04', sport: 'hockey', league: 'NCAA',
    selection: 'Over 5.5, incl "OT"', event: '=1+1', stake: 100, odds: -110, status: 'LOSS', settledProfit: -100 };
  const bets = [
    ...Array.from({ length: 51 }, (_, index) => ({ ...fill, id: `fill-${index}`, betId: `BOS${String(index).padStart(3, '0')}` })),
    { ...fill, id: 'older', betId: 'OLD123', betDate: '2026-11-03' },
    { ...fill, id: 'other-partner', betId: 'PAR123', partnerId: 'b', partnerName: 'Partner B' },
    { ...fill, id: 'other-sport', betId: 'LOL123', sport: 'lol' },
    { ...fill, id: 'other-league', betId: 'NHL123', league: 'NHL' },
    { ...fill, id: 'later', betId: 'NEW123', betDate: '2026-11-05' },
  ];
  const defaultFetch = fetch.getMockImplementation();
  fetch.mockImplementation((url, ...args) => url === '/api/confirms/bets?includeIncomplete=true'
    ? Promise.resolve({ ok: true, json: async () => ({ bets }) }) : defaultFetch(url, ...args));
  const createObjectURL = jest.fn(() => 'blob:bet-export');
  const revokeObjectURL = jest.fn();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/#/bets');
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Raw Bet Data' }));
    const table = await screen.findByRole('table', { name: 'Raw bet data' });
    await screen.findByRole('button', { name: 'Download CSV (56)' });
    expect(screen.getByRole('tab', { name: 'Raw Bet Data' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getByLabelText('From (ET)'), { target: { value: '2026-11-04' } });
    fireEvent.change(screen.getByLabelText('Through (ET)'), { target: { value: '2026-11-04' } });
    await user.selectOptions(screen.getByLabelText('Partner'), 'a');
    await user.selectOptions(screen.getByLabelText('Sport'), 'hockey');
    await user.selectOptions(screen.getByLabelText('League'), 'NCAA');
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    expect(within(table).queryByText('BOS050')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download CSV (51)' }));
    const csv = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(createObjectURL.mock.calls[0][0]);
    });
    expect(click.mock.instances[0].download).toBe('raw-bet-data.csv');
    expect(csv).toContain('"League"');
    expect(csv).toContain('"NCAA"');
    expect(csv).toContain('"BOS050"');
    expect(csv).not.toMatch(/PAR123|OLD123|NHL123|LOL123|NEW123/);
    expect(csv).toContain('"Over 5.5, incl ""OT"""');
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain(',-110,');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(table).getByText('BOS050')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Download CSV (56)' })).toBeEnabled();
  } finally {
    click.mockRestore();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});


test('monitoring flags stale publications and counts distinct upcoming games by league', async () => {
  const now = Date.now();
  const game = { id: 'game-1', dateTime: new Date(now + 3600000).toISOString(), leagueName: 'NCAA',
    winoddsfulltime: -150, away_winoddsfulltime: 150, goalie_team: 'Home goalie' };
  fetch.mockImplementation(async url => ({ ok: true, json: async () => url === '/api/monitoring/feeds' ? {
    feeds: [
      { id: 'hockey-odds', lastRunAt: new Date(now).toISOString(), lastSuccessAt: new Date(now - 20 * 60000).toISOString(), status: 'failed' },
      { id: 'ep-rosters', lastRunAt: new Date(now - 7 * 86400000).toISOString(), lastSuccessAt: new Date(now - 7 * 86400000).toISOString(), status: 'success' },
    ],
  } : url === '/api/hockey/future-games' ? {
    games: [game, { ...game, HomeML: -155, AwayML: 135, goalie_opp: 'Away goalie' },
      { ...game, id: 'past', dateTime: new Date(now - 3600000).toISOString() }, { ...game, id: 'game-2', winoddsfulltime: null }],
    source: { updatedAt: new Date(now - 48 * 3600000).toISOString() },
  } : { games: [], source: { updatedAt: new Date(now).toISOString() } } }));
  render(<App />);
  expect(await screen.findByText(/Last published/)).toHaveTextContent('Hockey · Stale output');
  const coverage = await screen.findByRole('table', { name: 'Hockey coverage by league' });
  const cells = within(coverage).getAllByRole('cell').map(cell => cell.textContent);
  expect(cells).toEqual(['2', '1 / 2', '1 / 2', '1 / 2']);
  expect(within(screen.getByRole('table', { name: 'League of Legends source inventory' })).getByText('GRID')).toBeInTheDocument();
  expect(await screen.findByText('No upcoming matches in this publication.')).toBeInTheDocument();
  const freshness = within(screen.getByRole('table', { name: 'Data freshness by feed' }));
  expect(freshness.getByRole('row', { name: /^Odds scraper / })).toHaveTextContent('Check run');
  expect(freshness.getByRole('row', { name: /^Elite Prospects current rosters / })).toHaveTextContent('CurrentWeekly');
  expect(freshness.getByRole('row', { name: /^PandaScore Minute frames / })).toHaveTextContent('No telemetry');
});
