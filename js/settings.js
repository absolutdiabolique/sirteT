import { cfg, keybinds, pieceColors, saveGlobal, keyLabel, resetKeybinds } from './state.js';
import { DEFAULT_BINDS, ACTION_LABELS, PKEYS, RANKED_DEFAULTS, PRESETS } from './constants.js';
import { showToast } from './ui.js';
import { ensureRunning } from './stupid.js';
import { setMusicVolume } from './sound.js';

export let selectedMode = 'sprint', selectedSub = null;

let listeningFor = null;

export function syncSettingsUI() {
  document.getElementById('s-sfx-vol').value   = cfg.sfxVolume;
  document.getElementById('s-sfx-val').textContent = cfg.sfxVolume + '%';
  document.getElementById('s-music-vol').value  = cfg.musicVolume;
  document.getElementById('s-music-val').textContent = cfg.musicVolume + '%';
  document.getElementById('g-das').value = cfg.das;
  document.getElementById('g-das-val').textContent = cfg.das + 'ms';
  document.getElementById('g-arr').value = cfg.arr;
  document.getElementById('g-arr-val').textContent = cfg.arr + 'ms';
  document.getElementById('g-sdf').value = cfg.sdf;
  document.getElementById('g-sdf-val').textContent = cfg.sdf === 41 ? '∞' : cfg.sdf + '×';
  const ghostPct = Math.round(cfg.ghostOpacity * 100);
  document.getElementById('s-ghost').value = ghostPct;
  document.getElementById('s-ghost-val').textContent = ghostPct + '%';
  document.getElementById('s-piece-outline').value = cfg.pieceOutline ? '1' : '0';
  document.getElementById('s-attack-splash').value = cfg.attackSplash ? '1' : '0';
  document.getElementById('s-motion-blur-trail').value     = cfg.motionBlurTrail;
  document.getElementById('s-mbt-val').textContent         = cfg.motionBlurTrail;
  document.getElementById('s-motion-blur-intensity').value = cfg.motionBlurIntensity;
  document.getElementById('s-mbi-val').textContent         = cfg.motionBlurIntensity;
  document.getElementById('s-board-bounce').value          = cfg.boardBounce;
  document.getElementById('s-bb-val').textContent          = cfg.boardBounce;
  document.getElementById('s-board-elasticity').value      = cfg.boardElasticity;
  document.getElementById('s-be-val').textContent          = cfg.boardElasticity;
  document.getElementById('s-drop-trail-intensity').value  = cfg.dropTrailIntensity;
  document.getElementById('s-dti-val').textContent         = cfg.dropTrailIntensity;
  document.getElementById('s-disintegrate').value          = cfg.disintegrate ? '1' : '0';
  document.getElementById('s-chromatic').value             = cfg.chromaticAberration ? '1' : '0';
  document.getElementById('s-chromatic-intensity').value   = cfg.chromaticIntensity;
  document.getElementById('s-ci-val').textContent          = cfg.chromaticIntensity;
  document.getElementById('s-grid').value = cfg.gridOn ? '1' : '0';
  document.getElementById('s-grid-sub').style.display = cfg.gridOn ? 'flex' : 'none';
  document.getElementById('s-gw').value = cfg.gridWidth;
  document.getElementById('s-gw-val').textContent = cfg.gridWidth + 'px';
  document.getElementById('s-gc').value = cfg.gridColor;
  document.getElementById('s-color-shift-bpm').value = cfg.colorShiftBpm;
  document.getElementById('s-limbo-bpm').value        = cfg.limboBpm;
  document.getElementById('s-drunk-bpm').value        = cfg.drunkBpm;
  document.getElementById('s-circles-bpm').value      = cfg.circlesBpm;
  document.getElementById('s-color-shift').value = cfg.colorShift ? '1' : '0';
  document.getElementById('s-limbo').value = cfg.limbo ? '1' : '0';
  document.getElementById('s-drunk').value = cfg.drunk ? '1' : '0';
  document.getElementById('s-circles').value = cfg.circles ? '1' : '0';
  document.getElementById('s-acid').value = cfg.acid ? '1' : '0';
  document.getElementById('s-acid-meter').value = cfg.acidMeter;
  document.getElementById('s-acid-meter-val').textContent = cfg.acidMeter;
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
  cfg.sfxVolume=100; cfg.musicVolume=80;
  cfg.das=167; cfg.arr=33; cfg.sdf=10;
  cfg.ghostOpacity=0.30; cfg.gridOn=true; cfg.gridWidth=0.5; cfg.gridColor='#222233'; cfg.pieceOutline=true; cfg.attackSplash=true; cfg.motionBlurTrail=5; cfg.motionBlurIntensity=5; cfg.boardBounce=5; cfg.boardElasticity=8; cfg.dropTrailIntensity=5;
  cfg.disintegrate=true; cfg.chromaticAberration=false; cfg.chromaticIntensity=5;
  cfg.colorShiftBpm=120; cfg.limboBpm=120; cfg.drunkBpm=120; cfg.circlesBpm=120;
  cfg.colorShift=false; cfg.limbo=false; cfg.drunk=false; cfg.circles=false; cfg.acid=false; cfg.acidMeter=5;
  resetKeybinds();
  Object.assign(pieceColors, {I:'#22d3ee',O:'#fde047',T:'#a855f7',S:'#4ade80',Z:'#f87171',J:'#60a5fa',L:'#fb923c'});
  syncSettingsUI(); buildKeybindTable(); buildPieceColorPickers(); saveGlobal();
  showToast('Reset to defaults');
}

function _syncOverhangVisibility() {
  const w = parseInt(document.getElementById('s-board-width').value);
  const row = document.getElementById('s-overhang-row');
  if (w === 4) { row.style.display = 'flex'; }
  else { row.style.display = 'none'; document.getElementById('s-overhang').value = '0'; }
}

export function selectMode(mode) {
  if (!['sprint','blitz','zen','combo-race'].includes(mode)) mode = 'sprint';
  selectedMode = mode;
  selectedSub = null;
  ['sprint','blitz','zen','combo-race'].forEach(m => {
    const el = document.getElementById('mc-'+m); if (el) el.classList.toggle('active', m===mode);
  });
  document.getElementById('sprint-sub').style.display = mode==='sprint' ? 'block' : 'none';
  document.getElementById('blitz-sub').style.display  = mode==='blitz'  ? 'block' : 'none';
  const bw = document.getElementById('s-board-width');
  const bh = document.getElementById('s-board-height');
  const oh = document.getElementById('s-overhang');
  if (mode === 'combo-race') {
    bw.value = '4';  document.getElementById('s-bw-val').textContent  = '4';  bw.disabled = true;
    bh.value = '20'; document.getElementById('s-bh-val').textContent  = '20'; bh.disabled = true;
    document.getElementById('s-overhang-row').style.display = 'flex'; oh.value = '1'; oh.disabled = true;
    document.getElementById('s-grav-mode').value = 'leveled';
    document.getElementById('s-static-row').style.display = 'none';
    document.getElementById('s-kicks').value = 'srs';
    document.getElementById('s-hold').value  = 'normal';
    document.getElementById('s-practice').value = '0';
    document.getElementById('s-practice-val').textContent = 'Off';
  } else {
    bw.disabled = false; bh.disabled = false; oh.disabled = false;
    _syncOverhangVisibility();
  }
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
  return (selectedMode==='sprint' || selectedMode==='blitz')
    && document.getElementById('s-practice').value !== '1';
}

export function isRankedSettings() {
  return document.getElementById('s-grav-mode').value === RANKED_DEFAULTS.gravMode
    && document.getElementById('s-kicks').value       === RANKED_DEFAULTS.kicks
    && document.getElementById('s-hold').value        === RANKED_DEFAULTS.holdMode
    && parseInt(document.getElementById('s-board-width').value)  === 10
    && parseInt(document.getElementById('s-board-height').value) === 20;
}

export function updateAsterisks() {
  const ranked = isRankedMode();
  ['grav-asterisk','kicks-asterisk','hold-asterisk','practice-asterisk','board-size-asterisk'].forEach(id => {
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
  cfg.boardWidth  = Math.min(20, Math.max(4, parseInt(document.getElementById('s-board-width').value)  || 10));
  cfg.boardHeight = Math.min(100, Math.max(4, parseInt(document.getElementById('s-board-height').value) || 20));
  cfg.overhang    = document.getElementById('s-overhang').value === '1';
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

// Sound settings handlers
document.getElementById('s-sfx-vol').oninput = function() {
  cfg.sfxVolume = parseInt(this.value);
  document.getElementById('s-sfx-val').textContent = this.value + '%';
  saveGlobal();
};
document.getElementById('s-music-vol').oninput = function() {
  cfg.musicVolume = parseInt(this.value);
  document.getElementById('s-music-val').textContent = this.value + '%';
  setMusicVolume(cfg.musicVolume);
  saveGlobal();
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
document.getElementById('s-piece-outline').onchange = function() {
  cfg.pieceOutline = this.value === '1';
  saveGlobal();
};
document.getElementById('s-attack-splash').onchange = function() {
  cfg.attackSplash = this.value === '1';
  saveGlobal();
};
document.getElementById('s-motion-blur-trail').oninput = function() {
  cfg.motionBlurTrail = parseInt(this.value);
  document.getElementById('s-mbt-val').textContent = this.value;
  saveGlobal();
};
document.getElementById('s-motion-blur-intensity').oninput = function() {
  cfg.motionBlurIntensity = parseInt(this.value);
  document.getElementById('s-mbi-val').textContent = this.value;
  saveGlobal();
};
document.getElementById('s-board-bounce').oninput = function() {
  cfg.boardBounce = parseInt(this.value);
  document.getElementById('s-bb-val').textContent = this.value;
  saveGlobal();
};
document.getElementById('s-board-elasticity').oninput = function() {
  cfg.boardElasticity = parseInt(this.value);
  document.getElementById('s-be-val').textContent = this.value;
  saveGlobal();
};
document.getElementById('s-drop-trail-intensity').oninput = function() {
  cfg.dropTrailIntensity = parseInt(this.value);
  document.getElementById('s-dti-val').textContent = this.value;
  saveGlobal();
};
document.getElementById('s-disintegrate').onchange = function() {
  cfg.disintegrate = this.value === '1';
  saveGlobal();
};
document.getElementById('s-chromatic').onchange = function() {
  cfg.chromaticAberration = this.value === '1';
  saveGlobal();
};
document.getElementById('s-chromatic-intensity').oninput = function() {
  cfg.chromaticIntensity = parseInt(this.value);
  document.getElementById('s-ci-val').textContent = this.value;
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
document.getElementById('s-board-width').addEventListener('input', function() {
  document.getElementById('s-bw-val').textContent = this.value;
  _syncOverhangVisibility();
  updateAsterisks();
});
document.getElementById('s-board-height').addEventListener('input', function() {
  document.getElementById('s-bh-val').textContent = this.value;
  updateAsterisks();
});

// Stupid settings — per-effect BPM inputs
function _clampBpm(v) { return Math.min(500, Math.max(30, v)); }
document.getElementById('s-color-shift-bpm').oninput = function() {
  const v = parseInt(this.value); if (!isNaN(v)) { cfg.colorShiftBpm = _clampBpm(v); saveGlobal(); }
};
document.getElementById('s-limbo-bpm').oninput = function() {
  const v = parseInt(this.value); if (!isNaN(v)) { cfg.limboBpm = _clampBpm(v); saveGlobal(); }
};
document.getElementById('s-drunk-bpm').oninput = function() {
  const v = parseInt(this.value); if (!isNaN(v)) { cfg.drunkBpm = _clampBpm(v); saveGlobal(); }
};
document.getElementById('s-circles-bpm').oninput = function() {
  const v = parseInt(this.value); if (!isNaN(v)) { cfg.circlesBpm = _clampBpm(v); saveGlobal(); }
};
export function applyBpmToAll() {
  const v = parseInt(document.getElementById('s-apply-bpm').value);
  if (isNaN(v)) return;
  const bpm = _clampBpm(v);
  cfg.colorShiftBpm = cfg.limboBpm = cfg.drunkBpm = cfg.circlesBpm = bpm;
  document.getElementById('s-color-shift-bpm').value = bpm;
  document.getElementById('s-limbo-bpm').value        = bpm;
  document.getElementById('s-drunk-bpm').value        = bpm;
  document.getElementById('s-circles-bpm').value      = bpm;
  saveGlobal();
}
document.getElementById('s-color-shift').onchange = function() {
  cfg.colorShift = this.value === '1';
  if (cfg.colorShift || cfg.limbo || cfg.drunk) ensureRunning();
  saveGlobal();
};
document.getElementById('s-limbo').onchange = function() {
  cfg.limbo = this.value === '1';
  if (cfg.colorShift || cfg.limbo || cfg.drunk) ensureRunning();
  saveGlobal();
};
document.getElementById('s-drunk').onchange = function() {
  cfg.drunk = this.value === '1';
  if (cfg.colorShift || cfg.limbo || cfg.drunk) ensureRunning();
  saveGlobal();
};
document.getElementById('s-circles').onchange = function() {
  cfg.circles = this.value === '1';
  saveGlobal();
};
document.getElementById('s-acid').onchange = function() {
  cfg.acid = this.value === '1';
  saveGlobal();
};
document.getElementById('s-acid-meter').oninput = function() {
  cfg.acidMeter = parseInt(this.value);
  document.getElementById('s-acid-meter-val').textContent = this.value;
  saveGlobal();
};
