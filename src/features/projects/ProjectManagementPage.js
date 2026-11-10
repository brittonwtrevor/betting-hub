import React, { useEffect, useRef, useState } from 'react';
import { sports } from '../../app/navigation';
import { Panel } from '../../components/ui';
import './projects.css';

const endpoint = '/api/project-tasks';
const levels = ['Low', 'Medium', 'High'];
const fields = [
  { key: 'category', label: 'Category', maxLength: 80 },
  { key: 'importance', label: 'Importance', options: levels },
  { key: 'taskName', label: 'Task Name', maxLength: 200 },
  { key: 'sport', label: 'Sport', maxLength: 80 },
  { key: 'effort', label: 'Effort', options: levels },
];
const columns = [...fields, { key: 'notes', label: 'Notes' }];
const emptyTask = { category: '', importance: '', taskName: '', sport: '', effort: '', notes: '' };

async function requestTasks(options, fallback) {
  const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', ...options });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.message || fallback);
  return result;
}

export default function ProjectManagementPage() {
  const [draft, setDraft] = useState(emptyTask);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const draftId = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const fallback = 'Unable to load tasks. Try refreshing.';
    requestTasks({ signal: controller.signal }, fallback)
      .then(result => {
        if (!Array.isArray(result.tasks)) throw new Error(fallback);
        if (!controller.signal.aborted) setTasks(result.tasks);
      })
      .catch(error => {
        if (!controller.signal.aborted) setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  function updateDraft(key, value) {
    draftId.current = null;
    setDraft(current => ({ ...current, [key]: value }));
    setSaveError('');
  }

  async function createTask(event) {
    event.preventDefault();
    if (saving || loading) return;
    const fallback = 'Unable to save the task. Try again.';
    setSaving(true);
    setSaveError('');
    try {
      draftId.current ??= window.crypto.randomUUID();
      const { task } = await requestTasks({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'project-tasks' },
        body: JSON.stringify({ id: draftId.current, ...draft }),
      }, fallback);
      if (task?.id !== draftId.current) throw new Error(fallback);
      setTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
      setDraft(emptyTask);
      draftId.current = null;
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  function refreshTasks() {
    setLoading(true);
    setLoadError('');
    setRefresh(value => value + 1);
  }

  return <>
    <h1>Project Management</h1>
    <Panel title="New task">
      <form className="project-form" onSubmit={createTask}>
        <div className="project-fields">
          {fields.map(({ key, label, maxLength, options }) => {
            const props = {
              required: true,
              disabled: saving,
              value: draft[key],
              onChange: event => updateDraft(key, event.target.value),
            };
            return <label key={key}>
              <span>{label}</span>
              {options ? <select {...props}>
                <option value="">Select {label.toLowerCase()}</option>
                {options.map(option => <option key={option}>{option}</option>)}
              </select> : <input {...props} maxLength={maxLength} list={key === 'sport' ? 'project-sports' : undefined} />}
            </label>;
          })}
          <label className="project-notes-field">
            <span>Notes (optional)</span>
            <textarea rows={4} maxLength={5000} disabled={saving} value={draft.notes}
              onChange={event => updateDraft('notes', event.target.value)}
              placeholder="Add task specs, requirements, or context" />
          </label>
        </div>
        <datalist id="project-sports">
          {sports.map(sport => <option key={sport.id} value={sport.label} />)}
          <option value="All sports" />
        </datalist>
        <button type="submit" className="button button-primary" disabled={saving || loading}>
          {saving ? 'Saving…' : 'Add task'}
        </button>
        {saveError && <p role="alert" className="project-message">{saveError}</p>}
      </form>
    </Panel>
    <Panel title="Tasks" action={
      <button type="button" className="button button-secondary" disabled={loading || saving} onClick={refreshTasks}>
        Refresh tasks
      </button>
    }>
      {loading && <p role="status" className="project-message">Loading tasks…</p>}
      {loadError && <p role="alert" className="project-message">{loadError}</p>}
      <div className="table-scroll">
        <table className="data-table project-table" aria-label="Project tasks">
          <thead><tr>{columns.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            {tasks.map(task => <tr key={task.id}>{columns.map(({ key }) => <td key={key} className={key === 'notes' ? 'project-notes-cell' : undefined}>{task[key]}</td>)}</tr>)}
            {!loading && !loadError && !tasks.length && <tr><td colSpan={columns.length}>No tasks yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  </>;
}
