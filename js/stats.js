import { fmtTime } from './ui.js';

export function loadStats()  { try { return JSON.parse(localStorage.getItem('sirtet_stats')||'{}'); } catch(e) { return {}; } }
export function saveStats(s) { localStorage.setItem('sirtet_stats', JSON.stringify(s)); }

// Only store best (single record per sub-mode)
export function recordSprintTime(ms, subKey) {
  const s = loadStats();
  const key = 'sprint_' + subKey;
  if (!s[key] || ms < s[key].ms) {
    s[key] = { ms, date: new Date().toISOString() };
    saveStats(s);
  }
}

export function recordBlitzScore(lines, subKey) {
  const s = loadStats();
  const key = 'blitz_' + subKey;
  if (!s[key] || lines > s[key].lines) {
    s[key] = { lines, date: new Date().toISOString() };
    saveStats(s);
  }
}

export function renderSprintHistory() {
  const s = loadStats();
  ['20','40','100'].forEach(sub => {
    const el = document.getElementById('sprint-best-' + sub);
    if (!el) return;
    const rec = s['sprint_' + sub];
    el.textContent = rec ? fmtTime(rec.ms) : '—';
    el.style.fontFamily = rec ? "'Space Mono', monospace" : '';
    el.style.color = rec ? 'var(--accent2)' : 'var(--muted)';
  });
}

export function renderBlitzHistory() {
  const s = loadStats();
  ['30s','1m','2m'].forEach(sub => {
    const el = document.getElementById('blitz-best-' + sub);
    if (!el) return;
    const rec = s['blitz_' + sub];
    el.textContent = rec ? rec.lines + ' lines' : '—';
    el.style.fontFamily = rec ? "'Space Mono', monospace" : '';
    el.style.color = rec ? 'var(--accent2)' : 'var(--muted)';
  });
}

export function renderStats() {
  renderSprintHistory();
  renderBlitzHistory();
}
