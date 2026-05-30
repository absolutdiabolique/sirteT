export const COLS = 10, ROWS = 20, SZ = 28, VS_SZ = 28;
export const PKEYS = ['I','O','T','S','Z','J','L'];

// All 4 rotation states per piece: [state0, stateR, state2, stateL]
// Derived directly from Tetris guideline image. State index = piece.rot (0/1/2/3).
export const ROTATIONS = {
  I: [
    [[1,1,1,1]],
    [[1],[1],[1],[1]],
    [[1,1,1,1]],
    [[1],[1],[1],[1]],
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]],
    [[0,1,0],[0,1,0],[1,1,0]],
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1,0],[0,1,0],[0,1,0]],
  ],
  O: [
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
  ],
  S: [
    [[0,1,1],[1,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]],
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[0,1,0],[1,1,0],[0,1,0]],
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]],
    [[0,1,0],[1,1,0],[1,0,0]],
  ],
};

// Spawn shape (state 0) for mini previews / hold display
export const SHAPES = Object.fromEntries(Object.entries(ROTATIONS).map(([k,v])=>[k,v[0]]));

// SRS wall kick data — verbatim Tetris guideline.
// +x = right, +y = up (spec). Applied with dy negated for canvas (+y = down).
// State notation: 0=spawn, 1=R(CW), 2=180, 3=L(CCW)
export const SRS = {
  '0>>1': [[0,0],[-1,0],[-1,+1],[0,-2],[-1,-2]],  // 0->R
  '1>>0': [[0,0],[+1,0],[+1,-1],[0,+2],[+1,+2]],  // R->0
  '1>>2': [[0,0],[+1,0],[+1,-1],[0,+2],[+1,+2]],  // R->2
  '2>>1': [[0,0],[-1,0],[-1,+1],[0,-2],[-1,-2]],  // 2->R
  '2>>3': [[0,0],[+1,0],[+1,+1],[0,-2],[+1,-2]],  // 2->L
  '3>>2': [[0,0],[-1,0],[-1,-1],[0,+2],[-1,+2]],  // L->2
  '3>>0': [[0,0],[-1,0],[-1,-1],[0,+2],[-1,+2]],  // L->0
  '0>>3': [[0,0],[+1,0],[+1,+1],[0,-2],[+1,-2]],  // 0->L
};
export const SRS_I = {
  '0>>1': [[0,0],[-2,0],[+1,0],[-2,-1],[+1,+2]],  // 0->R
  '1>>0': [[0,0],[+2,0],[-1,0],[+2,+1],[-1,-2]],  // R->0
  '1>>2': [[0,0],[-1,0],[+2,0],[-1,+2],[+2,-1]],  // R->2
  '2>>1': [[0,0],[+1,0],[-2,0],[+1,-2],[-2,+1]],  // 2->R
  '2>>3': [[0,0],[+2,0],[-1,0],[+2,+1],[-1,-2]],  // 2->L
  '3>>2': [[0,0],[-2,0],[+1,0],[-2,-1],[+1,+2]],  // L->2
  '3>>0': [[0,0],[+1,0],[-2,0],[+1,-2],[-2,+1]],  // L->0
  '0>>3': [[0,0],[-1,0],[+2,0],[-1,+2],[+2,-1]],  // 0->L
};

export const LOCK_DELAY = 1000, LOCK_FLASH = 1000;

export const ACTION_LABELS = {
  moveLeft:'Move Left', moveRight:'Move Right', softDrop:'Soft Drop',
  hardDrop:'Hard Drop', rotateCW:'Rotate CW', rotateCCW:'Rotate CCW',
  rotate180:'Rotate 180°', hold:'Hold', pause:'Pause'
};
export const DEFAULT_BINDS = {
  moveLeft:  ['ArrowLeft',''],
  moveRight: ['ArrowRight',''],
  softDrop:  ['ArrowDown',''],
  hardDrop:  ['Space',''],
  rotateCW:  ['ArrowUp','KeyX'],
  rotateCCW: ['KeyZ',''],
  rotate180: ['KeyA',''],
  hold:      ['KeyC','ShiftLeft'],
  pause:     ['KeyP','']
};

// Standard settings for ranked play
export const RANKED_DEFAULTS = { gravMode:'leveled', kicks:'srs', holdMode:'normal' };

export const PRESETS = {
  marathon: {mode:'marathon',gravMode:'leveled',kicks:'srs',previewCount:5,holdMode:'normal',practice:false},
  sprint:   {mode:'sprint',  gravMode:'leveled',kicks:'srs',previewCount:5,holdMode:'normal',practice:false},
  blitz:    {mode:'blitz',   gravMode:'leveled',kicks:'srs',previewCount:5,holdMode:'normal',practice:false},
  zen:      {mode:'zen',     gravMode:'static',gravStatic:1,kicks:'srs',previewCount:5,holdMode:'infinite',practice:true},
};
