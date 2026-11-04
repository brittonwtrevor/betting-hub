export const sportDashboards = {
  hockey: {
    label: 'Hockey', icon: 'hockey', description: 'From league-wide projections to the players on the ice.',
    metrics: ['Upcoming games', 'Model coverage', 'Confirmed goalies', 'Roster freshness'],
    views: [
      { id: 'games', label: 'Future Games', columns: ['Matchup', 'League', 'Start time', 'Model probability', 'Market odds', 'Goalies'], description: 'Upcoming matchups, predictions, and market comparisons.' },
      { id: 'rosters', label: 'Roster Comparison', columns: ['Team', 'Opponent', 'Projected lineup', 'Missing players', 'Last update'], description: 'Projected lineups, player availability, and roster strength.' },
      { id: 'goalies', label: 'Goalies', columns: ['Goalie', 'Team', 'Games', 'Projected SV%', 'Confirmation', 'Last update'], description: 'Goalie projections, recent activity, and confirmation status.' },
    ],
    inputs: ['Game and player logs', 'Rosters and availability', 'Goalie information', 'Model predictions'],
  },
  lol: {
    label: 'League of Legends', icon: 'game', description: 'Match research, player performance, and draft context.',
    metrics: ['Upcoming matches', 'Model coverage', 'Confirmed lineups', 'Player-data freshness'],
    views: [
      { id: 'matches', label: 'Matches', columns: ['Matchup', 'Competition', 'Start time', 'Model probability', 'Market odds'], description: 'Upcoming matches, team projections, and market comparisons.' },
      { id: 'players', label: 'Players & Teams', columns: ['Player / Team', 'Competition', 'Games', 'KOE', 'AOE', 'DOE'], description: 'Player and team performance, including KOE, AOE, and DOE.' },
      { id: 'draft', label: 'Draft Analysis', columns: ['Matchup', 'Team composition', 'Opponent composition', 'Game state', 'Projection'], description: 'Composition matchups and projections by game state.' },
    ],
    inputs: ['Match and event data', 'Player statistics', 'Lineup information', 'Model predictions'],
  },
  nascar: {
    label: 'NASCAR', icon: 'flag', description: 'Race preparation, driver projections, and strategy context.',
    metrics: ['Upcoming races', 'Model coverage', 'Drivers covered', 'Session-data freshness'],
    views: [
      { id: 'races', label: 'Race Overview', columns: ['Race / Track', 'Series', 'Start time', 'Conditions', 'Model status'], description: 'Upcoming races, track context, and conditions.' },
      { id: 'drivers', label: 'Driver Projections', columns: ['Driver', 'Team', 'Start position', 'Win probability', 'Projected finish'], description: 'Driver ratings, finishing distributions, and market comparisons.' },
      { id: 'sessions', label: 'Practice & Qualifying', columns: ['Driver', 'Session', 'Position', 'Lap time', 'Last update'], description: 'Practice pace, qualifying results, and session coverage.' },
      { id: 'strategy', label: 'Strategy', columns: ['Race', 'Scenario', 'Fuel window', 'Tire falloff', 'Projection'], description: 'Fuel windows, tire falloff, cautions, and simulation scenarios.' },
    ],
    inputs: ['Race and track data', 'Practice and qualifying', 'Weather and conditions', 'Simulation outputs'],
  },
};
