import { cfg, keybinds, pieceColors, saveGlobal, keyLabel, resetKeybinds } from './state.js';
import { DEFAULT_BINDS, ACTION_LABELS, PKEYS, RANKED_DEFAULTS, PRESETS } from './constants.js';
import { showToast } from './ui.js';

export let selectedMode = 'sprint', selectedSub = null;

let listeningFor = null;

export function syncSettingsUI() {
  document.getElementById('g-das').value = cfg.das;
  document.getElementById('g-das-val').textContent = cfg.das + 'ms';
  document.getElementById('g-arr').value = cfg.arr;
  document.getElementById('g-arr-val').textContent = cfg.arr + 'ms';
  document.getElementById('g-sdf').value = cfg.sdf;
  document.getElementById('g-sdf-val').textContent = cfg.sdf === 41 ? '∞' : cfg.sdf + '×';
  const ghostPct = Math.round(cfg.ghostOpacity * 100);
  document.getElementById('s-ghost').value = ghostPct;
  document.getElementById('s-ghost-val').textContent = ghostPct + '%';
  document.getElementById('s-grid').value = cfg.gridOn ? '1' : '0';
  document.getElementById('s-grid-sub').style.display = cfg.gridOn ? 'flex' : 'none';
  document.getElementById('s-gw').value = cfg.gridWidth;
  document.getElementById('s-gw-val').textContent = cfg.gridWidth + 'px';
  document.getElementById('s-gc').value = cfg.gridColor;
}

export function updateHandlingSummary() {
  const el = document.getElementById('handling-summary');
  if (el) el.textContent = `DAS ${cfg.das}ms  ARR ${cfg.arr}ms  SDF ${cfg.sdf===41?'∞':cfg.sdf+'×'}`;
}

export function buildKeybindTable() {
  const tbl = document.getElementById('keybind-table');
  tbl.innerHTML = '';
  Object.keys(ACTION_LABELS).forEach(action => {
    const tr = document.createElement('tr');
    const tdL = document.createElement('td');
    tdL.textContent = ACTION_LABELS[action];
    tr.appendChild(tdL);
    const tdS = document.createElement('td');
    [0,1].forEach(slot => {
      const btn = document.createElement('span');
      btn.className = 'key-slot' + (keybinds[action][slot] ? '' : ' empty');
      btn.id = `kb-${action}-${slot}`;
      btn.textContent = keybinds[action][slot] ? keyLabel(keybinds[action][slot]) : '–';
      btn.onclick = () => startListening(action, slot);
      tdS.appendChild(btn);
    });
    const clr = document.createElement('span');
    clr.style.cssText = 'font-size:10px;color:var(--muted);cursor:pointer;margin-left:4px;';
    clr.textContent = '✕';
    clr.onclick = () => { keybinds[action] = ['','']; buildKeybindTable(); saveGlobal(); };
    tdS.appendChild(clr);
    tr.appendChild(tdS);
    tbl.appendChild(tr);
  });
}

export function startListening(action, slot) {
  if (listeningFor) {
    const prev = document.getElementById(`kb-${listeningFor.action}-${listeningFor.slot}`);
    if (prev) prev.classList.remove('listening');
  }
  listeningFor = { action, slot };
  const btn = document.getElementById(`kb-${action}-${slot}`);
  if (btn) { btn.classList.add('listening'); btn.textContent = '...'; }
}

export function buildPieceColorPickers() {
  const g = document.getElementById('piece-color-grid');
  g.innerHTML = '';
  PKEYS.forEach(k => {
    const item = document.createElement('div'); item.className = 'piece-color-item';
    const sw   = document.createElement('div'); sw.className = 'piece-swatch'; sw.style.background = pieceColors[k];
    const lbl  = document.createElement('span'); lbl.className = 'piece-swatch-label'; lbl.textContent = k;
    const inp  = document.createElement('input'); inp.type = 'color'; inp.value = pieceColors[k];
    inp.oninput = () => { pieceColors[k] = inp.value; sw.style.background = inp.value; saveGlobal(); };
    item.appendChild(sw); item.appendChild(lbl); item.appendChild(inp);
    g.appendChild(item);
  });
}

export function resetSettings() {
  if (!confirm('Reset keybinds, DAS/ARR/SDF, and piece colors to defaults?')) return;
  cfg.das=167; cfg.arr=33; cfg.sdf=10;
  cfg.ghostOpacity=0.30; cfg.gridOn=true; cfg.gridWidth=0.5; cfg.gridColor='#222233';
  resetKeybinds();
  Object.assign(pieceColors, {I:'#22d3ee',O:'#fde047',T:'#a855f7',S:'#4ade80',Z:'#f87171',J:'#60a5fa',L:'#fb923c'});
  syncSettingsUI(); buildKeybindTable(); buildPieceColorPickers(); saveGlobal();
  showToast('Reset to defaults');
}

export function selectMode(mode) {
  if (!['sprint','blitz','zen'].includes(mode)) mode = 'sprint';
  selectedMode = mode;
  selectedSub = null;
  ['sprint','blitz','zen'].forEach(m => {
    document.getElementById('mc-'+m).classList.toggle('active', m===mode);
  });
  document.getElementById('sprint-sub').style.display = mode==='sprint' ? 'block' : 'none';
  document.getElementById('blitz-sub').style.display  = mode==='blitz'  ? 'block' : 'none';
  if (mode==='sprint') { selectSub('sprint','40'); return; }
  if (mode==='blitz')  { selectSub('blitz','2m'); return; }
  updateAsterisks();
}

export function selectSub(mode, sub) {
  selectedSub = sub;
  const grp = mode==='sprint' ? 'sprint-sub' : 'blitz-sub';
  document.querySelectorAll('#'+grp+' .sub-btn').forEach(b => b.classList.remove('active'));
  const map = {'20':'sb-20','40':'sb-40','100':'sb-100','30s':'sb-30s','1m':'sb-1m','2m':'sb-2m'};
  const el = document.getElementById(map[sub]); if(el) el.classList.add('active');
  updateAsterisks();
}

export function isRankedMode() {
  return (selectedMode==='sprint' || selectedMode==='blitz') && !cfg.practice;
}

export function isRankedSettings() {
  return cfg.gravMode === RANKED_DEFAULTS.gravMode
    && cfg.kicks === RANKED_DEFAULTS.kicks
    && document.getElementById('s-hold').value === RANKED_DEFAULTS.holdMode;
}

export function updateAsterisks() {
  const ranked = isRankedMode();
  ['grav-asterisk','kicks-asterisk','hold-asterisk','practice-asterisk'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = ranked ? 'inline' : 'none';
  });
  const legend = document.getElementById('asterisk-legend');
  if(legend) legend.style.display = ranked ? 'block' : 'none';
  const warn = document.getElementById('ranked-warning');
  if(warn) {
    if(ranked && !isRankedSettings()) {
      warn.textContent = '⚠ Non-standard settings — score won\'t count in records';
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  }
}

export function applyPreset(name) {
  const p = PRESETS[name]; if (!p) return;
  selectMode(p.mode);
  document.getElementById('s-grav-mode').value = p.gravMode;
  if (p.gravStatic) { document.getElementById('s-grav').value = p.gravStatic; document.getElementById('s-grav-val').textContent = p.gravStatic.toFixed(1)+'×'; }
  document.getElementById('s-static-row').style.display = p.gravMode==='static' ? 'flex' : 'none';
  document.getElementById('s-kicks').value = p.kicks;
  document.getElementById('s-preview').value = p.previewCount;
  document.getElementById('s-preview-val').textContent = p.previewCount;
  document.getElementById('s-hold').value = p.holdMode;
  document.getElementById('s-practice').value = p.practice ? 1 : 0;
  document.getElementById('s-practice-val').textContent = p.practice ? 'On' : 'Off';
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().startsWith(name.slice(0,3))));
}

export function readSetupCfg() {
  cfg.mode        = selectedMode;
  cfg.subMode     = selectedSub;
  cfg.ranked      = isRankedMode() && isRankedSettings();
  cfg.practice    = document.getElementById('s-practice').value === '1';
  cfg.gravMode    = document.getElementById('s-grav-mode').value;
  cfg.gravStatic  = parseFloat(document.getElementById('s-grav').value);
  cfg.kicks       = document.getElementById('s-kicks').value;
  cfg.previewCount= parseInt(document.getElementById('s-preview').value);
  cfg.holdMode    = document.getElementById('s-hold').value;
  cfg.invisibleLocked = document.getElementById('s-invisible').value === '1';
  // ghostOpacity, gridOn, gridWidth, gridColor are global settings (managed in Settings screen)
  // das/arr/sdf come from cfg already (global settings)
}

export function getListeningFor() {
  return listeningFor;
}

export function captureKey(code) {
  if (!listeningFor) return false;
  keybinds[listeningFor.action][listeningFor.slot] = code;
  listeningFor = null;
  buildKeybindTable();
  saveGlobal();
  return true;
}

// ── Wire up DOM event handlers at module load time ────────────────

// Settings screen sliders (DAS/ARR/SDF)
document.getElementById('g-das').oninput = function() {
  cfg.das = parseInt(this.value);
  document.getElementById('g-das-val').textContent = this.value + 'ms';
  saveGlobal(); updateHandlingSummary();
};
document.getElementById('g-arr').oninput = function() {
  cfg.arr = parseInt(this.value);
  document.getElementById('g-arr-val').textContent = this.value + 'ms';
  saveGlobal(); updateHandlingSummary();
};
document.getElementById('g-sdf').oninput = function() {
  cfg.sdf = parseInt(this.value);
  document.getElementById('g-sdf-val').textContent = parseInt(this.value)===41 ? '∞' : this.value + '×';
  saveGlobal(); updateHandlingSummary();
};

// Setup screen slider labels (label-only)
['s-grav','s-preview'].forEach(id => {
  const outId = id+'-val';
  const fmts  = { 's-grav': v => parseFloat(v).toFixed(1)+'×', 's-preview': v => v };
  document.getElementById(id).oninput = function() {
    document.getElementById(outId).textContent = fmts[id](this.value);
  };
});
document.getElementById('s-practice').oninput = function() {
  document.getElementById('s-practice-val').textContent = this.value==='1' ? 'On' : 'Off';
  updateAsterisks();
};
document.getElementById('s-grav-mode').onchange = function() {
  document.getElementById('s-static-row').style.display = this.value==='static' ? 'flex' : 'none';
};

// Visual settings handlers (Settings screen — global, persisted)
document.getElementById('s-ghost').oninput = function() {
  cfg.ghostOpacity = parseInt(this.value) / 100;
  document.getElementById('s-ghost-val').textContent = this.value + '%';
  saveGlobal();
};
document.getElementById('s-gw').oninput = function() {
  cfg.gridWidth = parseFloat(this.value);
  document.getElementById('s-gw-val').textContent = parseFloat(this.value) + 'px';
  saveGlobal();
};
document.getElementById('s-gc').oninput = function() {
  cfg.gridColor = this.value;
  saveGlobal();
};
document.getElementById('s-grid').onchange = function() {
  cfg.gridOn = this.value === '1';
  document.getElementById('s-grid-sub').style.display = this.value === '1' ? 'flex' : 'none';
  saveGlobal();
};

// Watch for setting changes that affect ranking
['s-grav-mode','s-kicks','s-hold'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', updateAsterisks);
});
