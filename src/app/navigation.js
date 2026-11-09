export const sports = [
  { id: 'hockey', label: 'Hockey', icon: 'hockey' },
  { id: 'lol', label: 'League of Legends', icon: 'wizard' },
  { id: 'nascar', label: 'NASCAR', icon: 'raceCar' },
];

export const navigation = [
  { id: 'monitoring', path: '/', label: 'Monitoring', icon: 'activity', description: 'Every feed. Every model. One place to keep it all in check.' },
  { id: 'bets', path: '/bets', label: 'Active Bets', icon: 'mailSend', description: 'Your outstanding bets, across accounts and partners.' },
  { id: 'suggestions', path: '/suggestions', label: 'Trading Dashboard', icon: 'spark', description: 'Games and markets across your sports.' },
  ...sports.map(({ id, label, icon }) => ({ id: 'sports', sportId: id, path: `/sports/${id}`, label, icon })),
  { id: 'partners', path: '/partners', label: 'Partner Accounting', icon: 'users', description: 'Bet reports, shared exposure, and balances with your partners.' },
  { id: 'analytics', path: '/analytics', label: 'Analytics', icon: 'chart', description: 'Understand your performance, from the full picture to every placement.' },
  { id: 'projects', path: '/project-management', label: 'Project Management', icon: 'checklist', description: 'Create and review project tasks.' },
];
