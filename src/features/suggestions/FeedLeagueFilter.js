import React, { useEffect, useRef } from 'react';
import Icon from '../../components/Icon';
import { feedLeagueGroups } from './FeedSettings';

export default function FeedLeagueFilter({ games, settings, onChange }) {
  const dropdown = useRef(null);
  useEffect(() => {
    function dismiss(event) {
      if (!dropdown.current.contains(event.target)) dropdown.current.open = false;
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  const groups = feedLeagueGroups(games, settings).filter(group => group.enabled);
  const all = groups.length > 0 && groups.every(group => group.leagues === null);
  const selected = groups.flatMap(group => group.leagues ?? group.options);
  const summary = all ? 'All leagues' : selected.length === 1 ? selected[0]
    : selected.length ? `${selected.length} leagues` : 'No leagues selected';

  function setAll(checked) {
    onChange({
      ...settings,
      ...Object.fromEntries(groups.map(({ value }) => [value, { ...settings[value], leagues: checked ? null : [] }])),
    });
  }

  function changeLeague(group, league, checked) {
    const next = { ...settings };
    // A first explicit selection replaces the all-leagues default.
    if (all) {
      for (const { value } of groups) next[value] = { ...settings[value], leagues: [] };
    }
    const leagues = next[group.value].leagues ?? group.options;
    next[group.value] = { ...next[group.value], leagues: checked ? [...leagues, league] : leagues.filter(item => item !== league) };
    onChange(next);
  }

  return <details className="feed-league-filter" ref={dropdown} onKeyDown={event => {
    if (event.key === 'Escape' && dropdown.current.open) {
      dropdown.current.open = false;
      dropdown.current.querySelector('summary').focus();
    }
  }}>
    <summary aria-label={`Leagues: ${summary}`}>
      <span>League</span>
      <span className="feed-league-value">{summary}<Icon name="down" size={14} /></span>
    </summary>
    <div className="feed-league-options">
      <label className="lol-checkbox">
        <input type="checkbox" checked={all} disabled={!groups.length} onChange={event => setAll(event.target.checked)} />
        All leagues
      </label>
      {groups.filter(group => group.options.length).map(group => <fieldset key={group.value}>
        <legend>{group.label}</legend>
        {group.options.map(league => <label key={league} className="lol-checkbox">
          <input type="checkbox" checked={!all && (group.leagues === null || group.leagues.includes(league))}
            onChange={event => changeLeague(group, league, event.target.checked)} />
          {league}
        </label>)}
      </fieldset>)}
      {!groups.length && <p>Enable a sport in Feed settings.</p>}
    </div>
  </details>;
}
