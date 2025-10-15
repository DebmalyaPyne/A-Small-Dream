'use strict';

// --- Visual tone ---
setShowSplashScreen(false);
canvasClearColor = rgb(0.04, 0.04, 0.07);
canvasPixelated = false;
tilesPixelated = false;
// Defer audio until user interacts (avoids autoplay warning)
setSoundEnable(false);
// Set default UI font
setFontDefault('Nunito, Arial');

// Math helpers
function lerp(a,b,t){ return a + (b-a) * t; }
function mix(a,b,t){ return lerp(a,b,t); }
function smoothstep(a,b,x){ const t = clamp((x-a)/(b-a), 0, 1); return t*t*(3-2*t); }

// Camera/world units
cameraPos = vec2(0, 0);
cameraScale = 28; // smaller -> zoom out

// --- Audio ---
const sfx_collect = new Sound([2,.5,522,.01,.17,.22,3,2.4,0,0,0,0,0,0,0,.2,.01,.51,0,0,.12,.18]); // soft chime
const sfx_pulse   = new Sound([1,.5,220,.02,.08,.23,1,3,0,0,0,0,0,0,0,.1,.02,.6,0,0,.01,.2]);
// Grow SFX removed

// --- Game state ---
let player;
let memoryOrbs = [];
// Pushable objects removed
let ui;
let dreamTimer;           // seconds
let dreamTimerStart = 135; // ~2m15s default; adjust later
let collected = 0;
let gameOver = false;
let gameWon = false;
// Simple state machine for menu/play/gameover
const STATE_MENU = 'menu';
const STATE_PLAY = 'play';
const STATE_GAMEOVER = 'gameover';
const STATE_LEVEL_COMPLETE = 'level_complete';
const STATE_ACT_INTRO = 'act_intro';
const STATE_ENDING = 'ending';
let gameState = STATE_MENU;
let currentLevel = 1;
const TOTAL_LEVELS = 3;
let orbsRequired = 3;
// After collecting the last orb, wait briefly so the final sentence is readable
let pendingLevelComplete = false;
let levelCompleteTimer = new Timer();

// Ending sequence state
let endingTimer;           // 17s scripted timeline
let endingOrbs = [];       // visual orbs orbiting around player during ending
let endingCameraScaleStart = 28;
let endingAmbientPlayed = false;
let endingNextChimeT = 0;
let endingNextAmbientT = 0;
let endingSustainPlayed = false;

function orbsRequiredForLevel(level){
  // Updated counts: L1:4, L2:6, L3:8
  if (level === 1) return 4;
  if (level === 2) return 6;
  return 8; // level 3
}

// Starting index into memoryLines for each level (so sentences can be sequenced across levels)
function memoryLineOffsetForLevel(level){
  if (level === 1) return 0;      // 0..3
  if (level === 2) return 4;      // 4..9
  return 10;                      // 10..17
}

// Grow/shrink ability removed

// Light pulse overlay
let vignetteLayer;

// Trail particles
let trailEmitter;
let audioArmed = false;

// Memory text fragments
const memoryLines = [
  // Act 1 — "The First Dream" (4)
  'A faint light stirs within the dark.',
  'Memories hum like distant stars.',
  'Shapes form where silence once slept.',
  'The small dream begins to breathe.',
  // Act 2 — "Echoes of a Memory" (6)
  'The dream stretches, reaching for forgotten warmth.',
  'Whispers trace the outline of something once known.',
  'Each fragment hums a note of hope.',
  'Colors bleed into the void — gentle and shy.',
  'The dream starts to remember its name.',
  'In the stillness, the heart awakens.',
  // Act 3 — "Where Light Remembers" (8)
  'The stars fall closer, drawn by the dream’s pulse.',
  'Every shard glows with a piece of truth.',
  'The small dream no longer fears the vastness.',
  'Echoes become voices, soft but certain.',
  'The dream finds its reflection in the void.',
  'Light and shadow dance without end.',
  'The world feels smaller, yet whole again.',
  'The small dream opens its eyes — and becomes real.'
];

// Title font (locked)
const TITLE_FONT = 'Cinzel Decorative, serif';

// Simple object classes
class Player extends EngineObject {
     constructor(pos) {
    super(pos, vec2(1.0, 1.0));
          this.color = rgb(1, 1, 1);
          this.additiveColor = rgb(0.3, 0.5, 1, 0.8);
    this.mass = 1; // enable physics/collisions
    this.damping = 0.95;
    this.setCollision(true, false, false, false); // collide with solid objects, but not solid
     }
  update() {
    if (gameState !== STATE_PLAY) return;
    // Movement (WASD/Arrows)
    const dir = keyDirection('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
    const wasd = keyDirection('KeyW', 'KeyS', 'KeyA', 'KeyD');
    const input = dir.add(wasd).clampLength(1);
  const speed = 7;
    // Set velocity for physics update (per-frame units)
    this.velocity = input.scale(speed * timeDelta);

    // Keep camera near player
    cameraPos = cameraPos.lerp(this.pos, 0.08);

    // Grow ability removed

    // Run physics/collisions
    super.update();

    // Emit motion trail (after physics updated pos)
    if (trailEmitter) {
      trailEmitter.pos = this.pos;
      trailEmitter.angle = this.velocity?.angle?.() ?? 0;
    }

    // Soft pulse sound occasionally
    if (rand() < 0.003) sfx_pulse.play(this.pos, 0.15, 1 + rand(-.02, .02));
  }
  render() {
    // base glow
    drawCircle(this.pos, 0.28, hsl(0.58, 0.8, 0.8, 0.5));
    drawCircle(this.pos, 0.12, rgb(1,1,1,0.9));
  }
}

class MemoryOrb extends EngineObject {
  constructor(pos, lineIndex) {
    super(pos, vec2(1.0, 1.0));
    // lineIndex is ignored; lines are shown based on collection order
    this.lineIndex = lineIndex;
    this.pulse = rand(.7, 1.1);
  }
  update() {
    if (gameState !== STATE_PLAY) return;
    // gentle hover
    this.pos.y += Math.sin(time * 2 + this.pulse) * 0.003;
    // faint audio ping sometimes
    if (rand() < 0.002) sfx_pulse.play(this.pos, 0.12, 1.5);

    // collect
    if (this.pos.distance(player.pos) < 0.85) {
      sfx_collect.play(this.pos, 0.5);
      this.destroy();
      const isFinalAct = currentLevel >= TOTAL_LEVELS;
      const willBeLastOrb = (collected + 1) >= orbsRequired;
      if (isFinalAct && willBeLastOrb) {
        // Skip showing the final Act 3 line (it repeats the cutscene text)
        collected++;
        // Start the ending immediately, no delay
        setupEnding();
        return;
      } else {
        // Determine next line purely by collection order within the current level
        const base = memoryLineOffsetForLevel(currentLevel);
        const idx = base + collected; // collected is count BEFORE increment
        showMemoryLine(idx);
        collected++;
        if (collected >= orbsRequired) {
          pendingLevelComplete = true;
          levelCompleteTimer.set(1.5);
        }
      }
    }
  }
  render() {
    const r = 0.30 + 0.035 * Math.sin(time * 6 + this.pulse);
    drawCircle(this.pos, r * 3.4, rgb(0.4, 0.7, 1, 0.07));
    drawCircle(this.pos, r * 2.0, rgb(0.4, 0.7, 1, 0.12));
    drawCircle(this.pos, r, rgb(0.9, 0.97, 1, 0.9));
  }
}

// Pushable class removed

// Static obstacle (solid)
class Obstacle extends EngineObject {
  constructor(pos, size=vec2(2,2)){
    super(pos, size);
    this.mass = 0; // static ground-like
    this.setCollision(true, true, false, false); // solid
    this.color = rgb(0.25, 0.35, 0.6, 0.2);
  }
  render(){
    // draw a soft glowing orb-like obstacle
    const r = Math.max(this.size.x, this.size.y) * 0.45;
    drawCircle(this.pos, r*2.0, rgb(0.35,0.55,0.9,0.06));
    drawCircle(this.pos, r*1.3, rgb(0.45,0.65,1,0.10));
    drawCircle(this.pos, r*0.9, rgb(0.85,0.95,1,0.25));
  }
}

// UI overlay and helper
function showMemoryLine(i){
  const t = memoryLines[i] || '';
  ui.flashText(t);
}

class UIOverlay {
  constructor(){
    this.text = '';
    this.textTimer = new Timer();
  }
  flashText(t){
    this.text = t;
    this.textTimer.set(3.5);
  }
  render(){
    const scr = (x, y) => {
      const w = (typeof overlayCanvas !== 'undefined' && overlayCanvas) ? overlayCanvas.width : 1280;
      const h = (typeof overlayCanvas !== 'undefined' && overlayCanvas) ? overlayCanvas.height : 720;
      return vec2(w * x, h * y);
    };
    // Dream fade vignette
    const fade = clamp(1 - dreamTimer.getPercent(), 0, 1);
    const darkness = 0.25 + 0.5 * (1 - fade);
    const camSize = getCameraSize();
    drawRect(cameraPos, camSize, rgb(0,0,0,darkness));

    // Timer text
    const p = clamp(dreamTimer.getPercent(), 0, 1);
    const secondsLeft = Math.max(0, Math.ceil(dreamTimerStart * (1 - p)));
  drawTextScreen(`${secondsLeft}s`, scr(0.96, 0.06), 18, rgb(0.8,0.85,1,0.7));

    // Memory text
    if (this.textTimer.active()) {
      const p = 1 - this.textTimer.getPercent();
  drawTextScreen(this.text, scr(0.5, 0.9), 24, rgb(0.9,0.95,1,0.9), 0, BLACK, 'center', 'Fira Code, monospace');
    }

  // Progress dots (dynamic per level)
  const dots = '●'.repeat(collected) + '○'.repeat(Math.max(0, orbsRequired - collected));
  drawTextScreen(dots, scr(0.5, 0.06), 22, rgb(0.8,0.85,1,0.8));

    // Win/lose banners
    if (gameOver){
      const msg = gameWon ? 'the dream dissolves into light' : 'the dream fades to dark';
      drawRect(cameraPos, getCameraSize(), rgb(0,0,0,0.3));
  drawTextScreen(msg, scr(0.5, 0.5), 32, rgb(1,1,1,0.95));
  drawTextScreen('Press R to restart', scr(0.5, 0.57), 20, rgb(1,1,1,0.7));
    }
  }
}

function endDream(won){
  gameOver = true;
  gameWon = !!won;
  gameState = STATE_GAMEOVER;
}

function onLevelComplete(){
  gameOver = false;
  gameWon = true;
  // If this was the final act, transition into the cinematic ending instead of the level complete screen
  if (currentLevel >= TOTAL_LEVELS) {
    setupEnding();
  } else {
    gameState = STATE_LEVEL_COMPLETE;
  }
}

function resetGame(level = currentLevel){
  currentLevel = level;
  orbsRequired = orbsRequiredForLevel(level);
  // Destroy existing objects
  engineObjectsDestroy();
  memoryOrbs = [];
  // pushables removed
  collected = 0;
  gameOver = false;
  gameWon = false;
  dreamTimer = new Timer();
  pendingLevelComplete = false;
  levelCompleteTimer = new Timer();
  gameState = STATE_ACT_INTRO;
  // Reset camera scale
  cameraScale = 28;
  // Clear ending state
  endingTimer = undefined; endingOrbs = []; endingAmbientPlayed = false; endingNextChimeT = 0; endingNextAmbientT = 0; endingSustainPlayed = false;
  // No explicit global time reset needed

  // Spawn
  player = new Player(vec2(0, 0));
  spawnLevelContent(currentLevel);

  // Trail emitter
  trailEmitter = new ParticleEmitter(
    player.pos,               // position
    0,                        // angle
    0,                        // emitSize (radius)
    0,                        // emitTime (0 = continuous)
    25,                       // emitRate (particles/sec)
    PI,                       // emitConeAngle
    undefined,                // tileInfo (none)
    rgb(0.7, 0.9, 1, .15),    // colorStartA
    rgb(0.5, 0.8, 1, .12),    // colorStartB
    rgb(0.4, 0.7, 1, 0),      // colorEndA
    rgb(0.4, 0.7, 1, 0),      // colorEndB
    0.35,                     // particleTime (seconds)
    0.04,                     // sizeStart
    0.18,                     // sizeEnd
    0.0,                      // speed
    0.0,                      // angleSpeed
    0.99,                     // damping
    1.0,                      // angleDamping
    0,                        // gravityScale
    PI,                       // particleConeAngle
    0.05,                     // fadeRate
    0.5,                      // randomness
    false,                    // collideTiles
    true,                     // additive
    true,                     // randomColorLinear
    undefined,                // renderOrder (use default based on additive)
    false                     // localSpace
  );
  trailEmitter.trailScale = 3;
}

function startGame(){
  ui = new UIOverlay();
  currentLevel = 1;
  resetGame(currentLevel);
}

function restartLevel(){
  resetGame(currentLevel);
}

function nextLevel(){
  if (currentLevel < TOTAL_LEVELS){
    currentLevel++;
    resetGame(currentLevel);
  } else {
    // Finished final level: start ending
    setupEnding();
  }
}

// ---------- Ending Sequence ----------
function setupEnding(){
  // Freeze gameplay and prepare visuals
  gameState = STATE_ENDING;
  endingTimer = new Timer();
  endingTimer.set(22.0); // extended duration to include credits card
  endingOrbs = [];
  endingAmbientPlayed = false;
  // Center the camera on the player so the orbit is visually centered
  if (player) cameraPos = player.pos.copy ? player.pos.copy() : vec2(player.pos.x, player.pos.y);
  // Seed visual orbs at positions of collected orbs around player
  const count = orbsRequiredForLevel(3); // 8
  const radius = 0.6; // start close
  for (let i=0; i<count; i++){
    endingOrbs.push({ angle: (i / count) * (PI*2), radius: radius + 0.02 * i, glow: 0.0 });
  }
  // Cache camera scale for zoom out
  endingCameraScaleStart = cameraScale;
}

// Game callbacks
function gameInit(){
  // Start in menu; wait for user to press Start or hit Enter/Space
  gameState = STATE_MENU;
}

function gameUpdate(){
  // Act Intro transition
  if (gameState === STATE_ACT_INTRO){
    // Allow skipping with Enter/Space/Click, or auto-advance after short delay
    if (!levelCompleteTimer.active()) levelCompleteTimer.set(2.0);
    const advance = keyWasPressed('Enter') || keyWasPressed('Space') || mouseWasPressed(0) || levelCompleteTimer.elapsed();
    if (advance){
      dreamTimer = new Timer();
      dreamTimer.set(dreamTimerStart);
      gameState = STATE_PLAY;
    }
    return;
  }
  // Arm audio on first user interaction
  if (!audioArmed && (mouseWasPressed(0) || mouseWasPressed(1))) {
    // Enable sound and initialize the audio graph now that we have a user gesture
    setSoundEnable(true);
    try { if (typeof audioContext !== 'undefined' && !audioIsRunning()) audioContext.resume(); } catch {}
    try { if (typeof audioInit === 'function') audioInit(); } catch {}
    audioArmed = true;
  }

  // Transition to level-complete after short delay so the last sentence shows
  // Allow skip of ending with Enter/Space/Click
  if (gameState === STATE_ENDING){
    if (keyWasPressed('Enter') || keyWasPressed('Space') || mouseWasPressed(0)) {
      // End immediately
      cameraScale = 28;
      gameState = STATE_MENU;
      return;
    }
    // No physics or gameplay updates during ending
    return;
  }

  if (gameState === STATE_PLAY && pendingLevelComplete && levelCompleteTimer.elapsed()){
    onLevelComplete();
    return;
  }
  // Title/menu input
  if (gameState === STATE_MENU){
    // Keyboard start
    if (keyWasPressed('Enter') || keyWasPressed('Space') || mouseWasPressed(0)) startGame();
    // Button-specific hover/click also supported in drawTitleScreen
    return;
  }

  // Level complete: handle button clicks in update (before inputs are cleared)
  if (gameState === STATE_LEVEL_COMPLETE){
    // Keyboard shortcuts
    if (keyWasPressed('KeyR')) return void restartLevel();
    if (keyWasPressed('Enter') || keyWasPressed('Space')) return void (currentLevel < TOTAL_LEVELS ? nextLevel() : (gameState = STATE_MENU));

    // Mouse click on buttons
    if (mouseWasPressed(0)){
      const w = overlayCanvas ? overlayCanvas.width : 1280;
      const h = overlayCanvas ? overlayCanvas.height : 720;
      const toScr = (x,y)=>vec2(w*x, h*y);
      const btnSize = vec2(260, 60);
      const restartPos = toScr(0.5 - 0.18, 0.55);
      const nextPos = toScr(0.5 + 0.18, 0.55);
      const mx = mousePosScreen.x, my = mousePosScreen.y;
      const inside = (pos)=> mx >= pos.x - btnSize.x/2 && mx <= pos.x + btnSize.x/2 && my >= pos.y - btnSize.y/2 && my <= pos.y + btnSize.y/2;
      if (inside(restartPos)) return void restartLevel();
      if (inside(nextPos)) return void (currentLevel < TOTAL_LEVELS ? nextLevel() : (gameState = STATE_MENU));
    }
    return;
  }

  if (gameOver){
    if (keyWasPressed('KeyR')) resetGame();
    return;
  }

  if (gameState === STATE_PLAY && dreamTimer.elapsed()) {
    endDream(false);
    return;
  }
}

function gameUpdatePost(){
  // nothing yet
}

function gameRender(){
  // dreamy background gradient filling the camera view
  const camSize = getCameraSize();
  const t = time * 0.1;
  const c1 = hsl(0.62, 0.55, 0.12 + 0.05 * Math.sin(t));
  const c2 = hsl(0.72, 0.55, 0.08 + 0.05 * Math.cos(t*0.8));
  drawRect(cameraPos, camSize, c1);
  drawRect(cameraPos, camSize, c2);
}

function gameRenderPost(){
  if (gameState === STATE_PLAY || gameState === STATE_GAMEOVER){
    ui.render();
  } else if (gameState === STATE_MENU){
    drawTitleScreen();
  } else if (gameState === STATE_LEVEL_COMPLETE){
    drawLevelCompleteScreen();
  } else if (gameState === STATE_ACT_INTRO){
    drawActIntroScreen();
  } else if (gameState === STATE_ENDING){
    drawEndingSequence();
  }
}

// Start engine
engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost);

// ---------- Title Screen ----------
function drawTitleScreen(){
  // Overlay coordinates helper
  const scr = (x, y) => {
    const w = overlayCanvas ? overlayCanvas.width : 1280;
    const h = overlayCanvas ? overlayCanvas.height : 720;
    return vec2(w * x, h * y);
  };

  // Title text with subtle outline/shadow
  const titlePos = scr(0.5, 0.32);
  const titleSize = 48;
  // Outline pass
  drawTextScreen('A Small Dream', titlePos, titleSize, rgb(0,0,0,0.85), 4, rgb(0,0,0,0.85), 'center', TITLE_FONT);
  // Fill pass
  drawTextScreen('A Small Dream', titlePos, titleSize, rgb(1,1,1,0.97), 0, BLACK, 'center', TITLE_FONT);
  drawTextScreen('A tiny spark inside a fading dream', scr(0.5, 0.38), 18, rgb(0.9,0.95,1,0.75), 0, BLACK, 'center', 'Cinzel, serif');

  // Player-like ball bobbing under the title (world-space drawing)
  const bob = 0.12 * Math.sin(time*2.2);
  const ballPos = cameraPos.add(vec2(0, -0.3 + bob));
  drawCircle(ballPos, 0.28, hsl(0.58, 0.8, 0.8, 0.5));
  drawCircle(ballPos, 0.12, rgb(1,1,1,0.9));

  // Start button (overlay)
  const btnPos = scr(0.5, 0.62);
  const btnSize = vec2(280, 64);

  const mx = mousePosScreen.x, my = mousePosScreen.y;
  const hovered = mx >= btnPos.x - btnSize.x/2 && mx <= btnPos.x + btnSize.x/2 &&
                  my >= btnPos.y - btnSize.y/2 && my <= btnPos.y + btnSize.y/2;

  const bg = hovered ? hsl(0.62, 0.55, 0.35, 0.95) : hsl(0.62, 0.55, 0.28, 0.9);
  const border = rgb(0.1,0.12,0.16, 0.9);
  // Button background (overlay pixel coordinates)
  drawRectGradient(btnPos, btnSize, bg, hsl(0.62,0.55,0.22,0.9), 0, false, true, overlayContext);
  drawLineList([
      btnPos.add(vec2(-btnSize.x/2, -btnSize.y/2)),
      btnPos.add(vec2( btnSize.x/2, -btnSize.y/2)),
      btnPos.add(vec2( btnSize.x/2,  btnSize.y/2)),
      btnPos.add(vec2(-btnSize.x/2,  btnSize.y/2)),
      btnPos.add(vec2(-btnSize.x/2, -btnSize.y/2))
    ],
    3,
    border,
    true,
    vec2(),
    0,
    false,
    true,
    overlayContext
  );
  drawTextScreen('Start', btnPos, 26, rgb(1,1,1,0.96), 0, BLACK, 'center', 'Cinzel, serif');

  // Hint
  drawTextScreen('Press Enter or Space', scr(0.5, 0.72), 16, rgb(0.86,0.9,1,0.85), 0, BLACK, 'center', 'Nunito, Arial');

  // Click to start
  if (hovered && mouseWasPressed(0)) startGame();
}

// ---------- Level Complete Screen ----------
function drawLevelCompleteScreen(){
  const scr = (x, y) => {
    const w = overlayCanvas ? overlayCanvas.width : 1280;
    const h = overlayCanvas ? overlayCanvas.height : 720;
    return vec2(w * x, h * y);
  };

  // Dim background
  drawRect(cameraPos, getCameraSize(), rgb(0,0,0,0.35));

  // Title
  const title = currentLevel < TOTAL_LEVELS ? 'Act Complete' : 'All Memories Found';
  drawTextScreen(title, scr(0.5, 0.35), 36, rgb(1,1,1,0.97), 3, rgb(0,0,0,0.85), 'center', TITLE_FONT);

  // Buttons: Restart and Next/Menu
  const btnSize = vec2(260, 60);
  const restartPos = scr(0.5 - 0.18, 0.55);
  const nextPos = scr(0.5 + 0.18, 0.55);

  const drawButton = (label, pos) => {
    const mx = mousePosScreen.x, my = mousePosScreen.y;
    const hovered = mx >= pos.x - btnSize.x/2 && mx <= pos.x + btnSize.x/2 && my >= pos.y - btnSize.y/2 && my <= pos.y + btnSize.y/2;
    const bg = hovered ? hsl(0.62, 0.55, 0.35, 0.95) : hsl(0.62, 0.55, 0.28, 0.9);
    const border = rgb(0.1,0.12,0.16, 0.9);
    drawRectGradient(pos, btnSize, bg, hsl(0.62,0.55,0.22,0.9), 0, false, true, overlayContext);
    drawLineList([
      pos.add(vec2(-btnSize.x/2, -btnSize.y/2)),
      pos.add(vec2( btnSize.x/2, -btnSize.y/2)),
      pos.add(vec2( btnSize.x/2,  btnSize.y/2)),
      pos.add(vec2(-btnSize.x/2,  btnSize.y/2)),
      pos.add(vec2(-btnSize.x/2, -btnSize.y/2))
    ], 3, border, true, vec2(), 0, false, true, overlayContext);
    drawTextScreen(label, pos, 24, rgb(1,1,1,0.96), 0, BLACK, 'center', 'Cinzel, serif');
    return hovered && mouseWasPressed(0);
  };

  const nextLabel = currentLevel < TOTAL_LEVELS ? 'Next Act' : 'Menu';
  if (drawButton('Restart', restartPos)) restartLevel();
  if (drawButton(nextLabel, nextPos)) currentLevel < TOTAL_LEVELS ? nextLevel() : (gameState = STATE_MENU);

  // Hints under buttons (match title hint style)
  const hintColor = rgb(0.86,0.9,1,0.85);
  const hintFont = 'Nunito, Arial';
  drawTextScreen('Press R', restartPos.add(vec2(0, 48)), 16, hintColor, 0, BLACK, 'center', hintFont);
  drawTextScreen('Press Enter or Space', nextPos.add(vec2(0, 48)), 16, hintColor, 0, BLACK, 'center', hintFont);

  // Keyboard shortcuts
  if (keyWasPressed('KeyR')) restartLevel();
  if (keyWasPressed('Enter') || keyWasPressed('Space')) currentLevel < TOTAL_LEVELS ? nextLevel() : (gameState = STATE_MENU);
}

// ---------- Act Intro Screen ----------
function actNameFor(level){
  return level === 1 ? 'The First Dream' : level === 2 ? 'Echoes of a Memory' : 'Where Light Remembers';
}

function drawActIntroScreen(){
  const scr = (x, y) => {
    const w = overlayCanvas ? overlayCanvas.width : 1280;
    const h = overlayCanvas ? overlayCanvas.height : 720;
    return vec2(w * x, h * y);
  };

  // Dim background
  drawRect(cameraPos, getCameraSize(), rgb(0,0,0,0.55));

  // Title lines
  const actLine = `Act ${currentLevel}`;
  const titleLine = actNameFor(currentLevel);

  // Simple fade using levelCompleteTimer as a short timer for intro
  if (!levelCompleteTimer.active()) levelCompleteTimer.set(2.0);
  const p = clamp(levelCompleteTimer.getPercent(), 0, 1);
  const alpha = p < 0.2 ? p/0.2 : (p > 0.8 ? (1 - p)/0.2 : 1);
  const headerColor = rgb(1,1,1,0.95 * alpha);
  const subColor = rgb(0.95,0.98,1,0.92 * alpha);

  drawTextScreen(actLine, scr(0.5, 0.44), 34, headerColor, 3, rgb(0,0,0,0.75*alpha), 'center', 'Cinzel, serif');
  drawTextScreen(titleLine, scr(0.5, 0.52), 28, subColor, 0, BLACK, 'center', 'Cinzel Decorative, serif');

  // Hint
  drawTextScreen('Press Enter or Click to continue', scr(0.5, 0.66), 14, rgb(0.86,0.9,1,0.75*alpha), 0, BLACK, 'center', 'Nunito, Arial');
}

// ---------- Per-Level Content ----------
function spawnLevelContent(level){
  // Helper to choose safe random positions
  const spawnBounds = { xMin:-5, xMax:5, yMin:-5, yMax:5 };
  const minFromPlayer = 1.6;
  const minBetweenOrbs = 1.2;
  const obstacleBuffer = 1.0; // extra distance beyond obstacle radius
  const orbPositions = [];
  const isSafe = (p, obstacles)=>{
    // away from player
    if (p.distance(vec2(0,0)) < minFromPlayer) return false;
    // away from obstacles
    for (const o of obstacles){
      const rad = Math.max(o.size.x, o.size.y) * 0.5; // conservative radius
      if (p.distance(o.pos) < rad + obstacleBuffer) return false;
    }
    // away from other orbs
    for (const op of orbPositions){
      if (p.distance(op) < minBetweenOrbs) return false;
    }
    return true;
  };
  const randomPos = ()=> vec2(rand(spawnBounds.xMin, spawnBounds.xMax), rand(spawnBounds.yMin, spawnBounds.yMax));

  // Level-specific obstacles (kept similar to previous layout)
  let obstaclesInfo = [];
  if (level === 1){
    obstaclesInfo = [
      {pos:vec2(-2.5, -2.0), size:vec2(2.2,2.2)},
      {pos:vec2( 2.8,  1.8), size:vec2(2.0,2.0)},
      {pos:vec2( 0.0, -3.2), size:vec2(2.6,2.6)},
    ];
  }
  else if (level === 2){
    obstaclesInfo = [
      {pos:vec2(-3.0, 2.2), size:vec2(2.4,2.4)},
      {pos:vec2( 3.2, 0.0), size:vec2(2.2,2.2)},
      {pos:vec2( 0.0,-3.6), size:vec2(2.8,2.8)},
    ];
  }
  else if (level === 3){
    obstaclesInfo = [
      {pos:vec2(-3.4,-2.6), size:vec2(2.8,2.8)},
      {pos:vec2( 3.6,-0.8), size:vec2(2.6,2.6)},
      {pos:vec2( 0.0, 3.6), size:vec2(3.0,3.0)},
    ];
  }

  // Instantiate obstacles
  for (const o of obstaclesInfo){
    new Obstacle(o.pos, o.size);
  }

  // Spawn orbs randomly with safety checks
  const base = memoryLineOffsetForLevel(level);
  const count = orbsRequiredForLevel(level);
  for (let i=0; i<count; i++){
    let p = randomPos();
    let attempts = 0;
    while (!isSafe(p, obstaclesInfo) && attempts < 200){
      p = randomPos();
      attempts++;
    }
    // If still not safe, slightly relax by reducing buffer and try a few more times
    if (!isSafe(p, obstaclesInfo)){
      const savedBuffer = obstacleBuffer;
      // Temporarily reduce checks within this scope
      const isSafeRelaxed = (q)=>{
        if (q.distance(vec2(0,0)) < minFromPlayer*0.8) return false;
        for (const o of obstaclesInfo){
          const rad = Math.max(o.size.x, o.size.y) * 0.5;
          if (q.distance(o.pos) < rad + savedBuffer*0.7) return false;
        }
        for (const op of orbPositions){
          if (q.distance(op) < minBetweenOrbs*0.8) return false;
        }
        return true;
      };
      let tries = 0;
      while (!isSafeRelaxed(p) && tries < 200){
        p = randomPos();
        tries++;
      }
    }
    orbPositions.push(p);
    memoryOrbs.push(new MemoryOrb(p, base + i));
  }
}

// --------- Ending Visuals & Timeline ---------
function drawEndingSequence(){
  // Timeline (seconds)
  // 0-3: slow motion orbit, faint chimes, glow
  // 3-6: camera zoom out, world fade to white, player glow bloom
  // 6-8: final line appears phrase by phrase (continues)
  // 8-10: full white, music fade to warm sustain then silence
  // 10-12: fade to black
  // 12-17: epilogue text, then fade to black

  if (!endingTimer) return;
  const total = 22.0; // extended to include credits card
  const t = clamp(endingTimer.getPercent(), 0, 1) * total; // time progressed from 0..17

  // Base background: fade to white over time
  const camSize = getCameraSize();
  const whiteFade = smoothstep(3.0, 6.0, t); // begin at 3s
  const whiteAlpha = clamp(whiteFade, 0, 1);
  drawRect(cameraPos, camSize, rgb(1,1,1,0.0 + 0.0)); // ensure draw order

  // Camera zoom out between 3-6s
  const zoom = mix(endingCameraScaleStart, endingCameraScaleStart * 1.6, smoothstep(3.0, 6.0, t));
  cameraScale = zoom;
  if (player) cameraPos = player.pos; // hard lock center on player during ending

  // Player glow bloom based on t
  const bloom = smoothstep(3.0, 6.0, t);
  const glowR1 = 0.28 + 1.2 * bloom;
  const glowR2 = 0.12 + 0.9 * bloom;
  // Player-centered bloom during ending
  drawCircle(player.pos, glowR1, rgb(1,1,1,0.22 + 0.35 * bloom));
  drawCircle(player.pos, glowR2, rgb(1,1,1,0.85 + 0.1 * bloom));

  // Orbiting orbs around player 0-3s, then they rise and dissolve by 6s
  const orbRise = smoothstep(0.0, 3.0, t);
  const dissolve = smoothstep(3.0, 6.0, t);
  const orbitCenter = player.pos; // keep center locked to player at all times
  const count = endingOrbs.length;
  for (let i=0; i<count; i++){
    const o = endingOrbs[i];
    const speed = mix(0.6, 1.2, orbRise);
    o.angle += speed * timeDelta;
    let r = mix(0.7, 1.1, orbRise) + i * 0.02;
    r *= 1 + 0.03 * Math.sin(time*0.7 + i*0.6) * (0.3 + 0.7*bloom);
    const pos = orbitCenter.add(vec2(Math.cos(o.angle), Math.sin(o.angle)).scale(r));
    const a = (1 - dissolve) * 0.9;
    drawCircle(pos, 0.25, rgb(0.9,0.97,1, a));
    drawCircle(pos, 0.5, rgb(0.5,0.8,1, 0.12 * a));
  }

  // Audio scheduling (reuse existing sfx as musical cues)
  if (audioArmed){
    // Faint chimes during 0-3s, about every 0.4s
    if (t < 3.0 && time > endingNextChimeT){
      endingNextChimeT = time + 0.4 + rand(-0.08, 0.08);
      sfx_collect.play(player.pos, 0.2, 1 + rand(-0.05, 0.05));
    }
    // Ambient swell hint via pulse every ~0.8s between 0-6s with increasing volume
    if (t < 6.0 && time > endingNextAmbientT){
      endingNextAmbientT = time + 0.8 + rand(-0.1, 0.1);
      const vol = lerp(0.05, 0.18, smoothstep(0.0, 6.0, t));
      sfx_pulse.play(player.pos, vol, 0.5 + 0.5 * smoothstep(0.0, 6.0, t));
    }
    // Warm sustained note at 8s (simulated by a longer pulse)
    if (t >= 8.0 && !endingSustainPlayed){
      endingSustainPlayed = true;
      // Multiple quick pulses to simulate a sustained feel
      for (let i=0;i<4;i++) setTimeout(()=> sfx_pulse.play(player.pos, 0.15, 0.8), 120*i);
    }
  }

  // Draw white overlay as the world fades to light (no special caps during text; rely on adaptive text color)
  const overlayAlpha = whiteAlpha * 0.95;
  drawRect(cameraPos, camSize, rgb(1,1,1, overlayAlpha));

  // Final lines word-by-word between 6-8s (phrases appear overlapping)
  const scr = (x, y) => {
    const w = overlayCanvas ? overlayCanvas.width : 1280;
    const h = overlayCanvas ? overlayCanvas.height : 720;
    return vec2(w * x, h * y);
  };
  const textColor = rgb(1,1,1, 0.98 * (1 - clamp(smoothstep(8.0, 10.0, t), 0, 1)) );
  const lines = [
    'The small dream…',
    'opens its eyes…',
    'and becomes real.'
  ];
  // Schedule: overlaps slightly; durations are longer (3s each) with 1.5s in/out
  const schedule = [6.0, 6.7, 7.4];
  for (let i=0; i<lines.length; i++){
    const start = schedule[i];
    const dur = 3.0; // 1.5s fade in + 1.5s fade out
    const end = start + dur;
    if (t >= start - 0.2 && t <= end + 0.5){
      const p = clamp((t - start) / dur, 0, 1);
      // 1.5s in, 1.5s out
      const alpha = p < 0.5 ? smoothstep(0.0, 0.5, p) : (1 - smoothstep(0.5, 1.0, p));
      // Adaptive text color based on background brightness (whiteAlpha):
      // - As it gets brighter, favor dark near-black text (slightly transparent)
      // - As it gets darker, fade to white text
      const b = whiteAlpha; // 0..1 brightness proxy
      const darkAmt = clamp(b, 0, 1);
      const lightAmt = 1 - darkAmt;
      // Dark pass (near-black), subtle outline
      const y = 0.44 + i*0.08;
      if (darkAmt > 0.01)
        drawTextScreen(
          lines[i], scr(0.5, y), 30,
          rgb(0.05,0.06,0.08, alpha * darkAmt * 0.95),
          2, rgb(0,0,0, alpha * darkAmt * 0.25),
          'center', 'Cinzel, serif'
        );
      // Light pass (white)
      if (lightAmt > 0.01)
        drawTextScreen(
          lines[i], scr(0.5, y), 30,
          rgb(1,1,1, alpha * lightAmt * 0.98),
          0, BLACK,
          'center', 'Cinzel, serif'
        );
    }
  }

  // At 8-10s, full white and then silence (text window is 6-8s)
  if (t >= 8.0 && t < 10.0){
    drawRect(cameraPos, camSize, rgb(1,1,1, 1.0));
  }

  // 10-12s fade from white to black
  if (t >= 10.0 && t < 12.0){
    const a = smoothstep(10.0, 12.0, t);
    drawRect(cameraPos, camSize, rgb(0,0,0, a));
  }

  // 12-17s epilogue text on black
  if (t >= 12.0){
    drawRect(cameraPos, camSize, rgb(0,0,0,1));
    const epStart = 12.0;
    const p = clamp((t - epStart) / 1.5, 0, 1); // fade in over 1.5s
    // Linger, then fade out between 16-17s
    const linger = clamp((t - 12.0 - 1.5) / 3.5, 0, 1); // ~5s linger total
    const fadeOut = smoothstep(16.0, 17.0, t);
    const a = smoothstep(0, 1, p) * (1 - fadeOut);
    // Clean, soft text on black (no glow)
    if (a > 0){
      const pos = scr(0.5, 0.5);
      drawTextScreen('“And even the smallest spark remembers.”', pos, 24, rgb(0.98,0.99,1, a), 0, BLACK, 'center', 'Cinzel, serif');
    }
  }

  // 17-22s: Credits card on black (title and author)
  if (t >= 17.0){
    drawRect(cameraPos, camSize, rgb(0,0,0,1));
    const fadeIn = smoothstep(17.0, 18.0, t);
    const titlePos = scr(0.5, 0.46);
    const byPos    = scr(0.5, 0.56);
    // Title with micro shadow (clean main text + slight offset shadow)
    const tpShadow = vec2(titlePos.x, titlePos.y + 2);
    drawTextScreen('A Small Dream', tpShadow, 42, rgb(0,0,0, fadeIn * 0.22), 0, BLACK, 'center', TITLE_FONT);
    drawTextScreen('A Small Dream', titlePos, 42, rgb(1,1,1, fadeIn * 0.96), 0, BLACK, 'center', TITLE_FONT);
    // Author line (Cinzel)
    const byAlpha = clamp(fadeIn - 0.15, 0, 1);
    drawTextScreen('by Debmalya Pyne', byPos, 22, rgb(1,1,1, byAlpha * 0.92), 0, BLACK, 'center', 'Cinzel, serif');
  }

  // End after full timeline
  if (endingTimer.elapsed()){
    cameraScale = 28;
    gameState = STATE_MENU;
  }
}
