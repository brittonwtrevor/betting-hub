import React from 'react';
import { SelectField, sportOptions } from '../../components/ui';

const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayMs = 86400000;
const dayNumber = day => Date.parse(`${day}T00:00:00Z`) / dayMs;
const dateString = day => new Date(day * dayMs).toISOString().slice(0, 10);

export function easternBetDay(time) {
  if (!time) return '';
  const { year, month, day } = Object.fromEntries(eastern.formatToParts(time).map(part => [part.type, part.value]));
  return `${year}-${month}-${day}`;
}

export function defaultBetDates(confirms = false) {
  const today = easternBetDay(new Date());
  return confirms ? { from: dateString(dayNumber(today) - 6), through: today } : { from: today, through: '' };
}

export function matchesBetDates(day, { from, through }) {
  return (!from && !through) || Boolean(day && (!from || day >= from) && (!through || day <= through));
}

export function sportLabel(sport) {
  return sportOptions.find(option => option.value === sport)?.label || sport || '';
}

export function newestDateFirst(left, right) {
  return (right || '').localeCompare(left || '');
}

export default function BetFilters({ sport, onSportChange, dates, onDatesChange, defaults, defaultLabel, dateLabel, days }) {
  const { from, through } = dates ?? defaults;
  const sliderDays = [defaults.from, defaults.through, from, through, ...days].filter(Boolean);
  const min = sliderDays.reduce((oldest, day) => day < oldest ? day : oldest, defaults.from);
  const max = sliderDays.reduce((latest, day) => day > latest ? day : latest, defaults.from);
  const summary = !dates ? defaultLabel : !from && !through ? 'All dates'
    : from && through ? `${from} to ${through}` : from ? `From ${from}` : `Through ${through}`;
  return <>
    <SelectField label="Sport" value={sport} onChange={onSportChange} options={sportOptions} />
    <details className="bet-date-filter">
      <summary>{dateLabel} (ET) · {summary}</summary>
      <div className="bet-date-fields">
        <label>From (ET)<input type="date" value={from} max={through || undefined}
          onChange={event => onDatesChange({ from: event.target.value, through })} /></label>
        <label>Through (ET)<input type="date" value={through} min={from || undefined}
          onChange={event => onDatesChange({ from, through: event.target.value })} /></label>
        <label>Adjust start date
          <input type="range" min={dayNumber(min)} max={dayNumber(through && through >= min && through >= from ? through : max)}
            value={dayNumber(from || min)} aria-valuetext={from || 'Any start date'}
            onChange={event => onDatesChange({ from: dateString(Number(event.target.value)), through })} />
        </label>
        <button type="button" className="button button-secondary" onClick={() => onDatesChange({ from: '', through: '' })}>All dates</button>
        <button type="button" className="button button-secondary" onClick={() => onDatesChange(null)}>Reset dates</button>
      </div>
    </details>
  </>;
}
