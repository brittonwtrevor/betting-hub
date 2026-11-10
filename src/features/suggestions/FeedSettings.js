import React, { useState } from 'react';
import Drawer from '../../components/Drawer';
import { sportOptions } from '../../components/ui';

const storageKey = 'betting-hub.trading-feed.v1';
const feedSports = sportOptions.filter(({ value }) => value === 'hockey' || value === 'lol');
const defaultSettings = Object.fromEntries(feedSports.map(({ value }) => [value, { enabled: true, leagues: null }]));
const sportOf = game => game.sport || 'lol';

export function readFeedSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey));
    return Object.fromEntries(feedSports.map(({ value }) => {
      const sport = saved?.[value];
      return [value, {
        enabled: sport?.enabled !== false,
        leagues: Array.isArray(sport?.leagues) ? sport.leagues.filter(league => typeof league === 'string' && league) : null,
      }];
    }));
  } catch {
    return defaultSettings;
  }
}

export function saveFeedSettings(settings) {
  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}

export function matchesFeedSettings(game, settings) {
  const sport = settings[sportOf(game)];
  return !sport || (sport.enabled && (sport.leagues === null || sport.leagues.includes(game.league)));
}

export default function FeedSettings({ games, settings, onSave, onClose }) {
  const [draft, setDraft] = useState(settings);
  function change(sport, values) {
    setDraft(current => ({ ...current, [sport]: { ...current[sport], ...values } }));
  }

  return <Drawer title="Feed settings" onClose={onClose}>
    <form className="feed-settings" onSubmit={event => { event.preventDefault(); onSave(draft); }}>
      <p>Choose which sports and leagues appear in the Trading Dashboard. Your choices are saved in this browser.</p>
      {feedSports.map(({ value, label }) => {
        const { enabled, leagues } = draft[value];
        const options = [...new Set([
          ...(leagues || []), ...games.filter(game => sportOf(game) === value).map(game => game.league).filter(Boolean),
        ])].sort((a, b) => a.localeCompare(b));
        return <fieldset key={value}>
          <legend>{label}</legend>
          <label className="lol-checkbox">
            <input type="checkbox" checked={enabled} onChange={event => change(value, { enabled: event.target.checked })} />
            Show {label}
          </label>
          {enabled && <>
            <label className="lol-checkbox">
              <input type="checkbox" checked={leagues === null}
                onChange={event => change(value, { leagues: event.target.checked ? null : [] })} />
              All leagues
            </label>
            {leagues !== null && (options.length ? <div className="feed-league-list">
              {options.map(league => <label className="lol-checkbox" key={league}>
                <input type="checkbox" checked={leagues.includes(league)} onChange={event => change(value, {
                  leagues: event.target.checked ? [...leagues, league] : leagues.filter(item => item !== league),
                })} />
                {league}
              </label>)}
            </div> : <p>League options appear when this feed has published games.</p>)}
          </>}
        </fieldset>;
      })}
      <div className="feed-settings-actions">
        <button type="button" className="button button-secondary" onClick={() => setDraft(defaultSettings)}>Reset to all</button>
        <button type="submit" className="button button-primary">Save filters</button>
      </div>
    </form>
  </Drawer>;
}
