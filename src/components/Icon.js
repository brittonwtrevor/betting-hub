import React from 'react';
const paths = {
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  layers: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5', 'm3 16 9 5 9-5'],
  spark: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'],
  sports: ['M6 3h12v5a6 6 0 0 1-12 0V3Z', 'M6 5H3v3a4 4 0 0 0 4 4', 'M18 5h3v3a4 4 0 0 1-4 4', 'M12 14v7', 'M8 21h8'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M16 3a4 4 0 0 1 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  chart: ['M4 3v18h17', 'M8 16v-5', 'M13 16V6', 'M18 16v-8'],
  checklist: ['m3 6 2 2 4-4', 'm3 12 2 2 4-4', 'm3 18 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  chevron: ['m9 5 7 7-7 7'],
  down: ['m6 9 6 6 6-6'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm15 15 6 6'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 7v5l3 2'],
  refresh: ['M20 7a9 9 0 1 0 1 8', 'M20 2v6h-6'],
  link: ['m10 13 4-4', 'm8 16-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0', 'm16 8 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'],
  database: ['M20 6c0 2-3.6 4-8 4S4 8 4 6s3.6-4 8-4 8 2 8 4Z', 'M4 6v12c0 2 3.6 4 8 4s8-2 8-4V6', 'M4 12c0 2 3.6 4 8 4s8-2 8-4'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 11v6', 'M12 7h.01'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 16v5h14v-5'],
  wallet: ['M20 8V5H5a2 2 0 0 1 0-4h14', 'M3 3v16a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1-2-2', 'M20 12h-5v5h5'],
  inbox: ['M4 4h16l2 12v4H2v-4L4 4Z', 'M2 16h6l2 3h4l2-3h6'],
  flag: ['M4 22V3', 'M4 3c6-4 10 4 16 0v10c-6 4-10-4-16 0'],
  game: ['M7 7h10a4 4 0 0 1 4 3l1 7a3 3 0 0 1-5 2l-3-3h-4l-3 3a3 3 0 0 1-5-2l1-7a4 4 0 0 1 4-3Z', 'M7 10v5', 'M4.5 12.5h5', 'M16 11h.01', 'M19 14h.01'],
  hockey: ['m6 3 8 15h6a2 2 0 0 1 0 4h-8L3 5', 'M15 4h6', 'M18 2v4'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
};
export default function Icon({ name, size = 20, className = '' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{(paths[name] || paths.grid).map((d, index) => <path key={index} d={d} />)}</svg>;
}
