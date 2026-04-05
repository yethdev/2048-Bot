const http = require('http');
const fs = require('fs');
const path = require('path');


const PORT = 3000;
const NUM_VALUES = 15;
const TABLE_SIZE = Math.pow(NUM_VALUES, 6);
const TRAINING_HOURS = 4;
const TRAINING_DURATION_MS = TRAINING_HOURS * 60 * 60 * 1000;
const MAX_RNG_RATIO = 0.25;
const WEIGHTS_FILE = path.join(__dirname, 'model_weights.bin');
const META_FILE = path.join(__dirname, 'model_meta.json');
const SAVE_INTERVAL_GAMES = 10000;
const LOG_INTERVAL_GAMES = 5000;
const BATCH_GAMES = 100;


const PATTERNS = [
  [[0,0],[1,0],[2,0],[3,0],[0,1],[1,1]],
  [[0,0],[1,0],[0,1],[1,1],[0,2],[1,2]],
  [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]],
  [[0,0],[1,0],[0,1],[1,1],[2,1],[3,1]],
  [[0,0],[1,0],[2,0],[3,0],[2,1],[3,1]],
  [[0,0],[1,0],[2,0],[1,1],[2,1],[3,1]],
  [[0,0],[1,0],[0,1],[1,1],[2,1],[2,2]],
  [[0,0],[1,0],[2,0],[0,1],[1,1],[1,2]],
];
const NUM_PATTERNS = PATTERNS.length;


const SYMMETRY_FNS = [
  (x, y) => [x, y],
  (x, y) => [3 - x, y],
  (x, y) => [x, 3 - y],
  (x, y) => [3 - x, 3 - y],
  (x, y) => [y, x],
  (x, y) => [3 - y, x],
  (x, y) => [y, 3 - x],
  (x, y) => [3 - y, 3 - x],
];


// precompute tuple coordinate lookups for speed
const NUM_TUPLES = NUM_PATTERNS * 8;
const tupleCoords = new Int32Array(NUM_TUPLES * 6);
const tupleTable = new Int32Array(NUM_TUPLES);

let ti = 0;
for (let p = 0; p < NUM_PATTERNS; p++) {
  for (let s = 0; s < 8; s++) {
    tupleTable[ti] = p;
    for (let i = 0; i < 6; i++) {
      const [tx, ty] = SYMMETRY_FNS[s](PATTERNS[p][i][0], PATTERNS[p][i][1]);
      tupleCoords[ti * 6 + i] = tx * 4 + ty;
    }
    ti++;
  }
}


console.log('Allocating weight tables (' + NUM_PATTERNS + ' x ' +
  (TABLE_SIZE * 4 / 1024 / 1024).toFixed(1) + ' MB = ' +
  (NUM_PATTERNS * TABLE_SIZE * 4 / 1024 / 1024).toFixed(0) + ' MB)...');

const weights = [];
for (let i = 0; i < NUM_PATTERNS; i++) {
  weights.push(new Float32Array(TABLE_SIZE));
}
console.log('Weight tables allocated.');


const TILE_TO_IDX = new Uint8Array(65536);
TILE_TO_IDX[0] = 0;
for (let i = 1; i <= 16; i++) {
  TILE_TO_IDX[Math.min(1 << i, 65535)] = Math.min(i, NUM_VALUES - 1);
}
const IDX_TO_TILE = new Int32Array(NUM_VALUES);
for (let i = 0; i < NUM_VALUES; i++) IDX_TO_TILE[i] = i === 0 ? 0 : (1 << i);


const VECTORS_X = new Int8Array([0, 1, 0, -1]);
const VECTORS_Y = new Int8Array([-1, 0, 1, 0]);
const TRAV_FWD = [0, 1, 2, 3];
const TRAV_REV = [3, 2, 1, 0];


const _simBoard = new Uint8Array(16);
const _merged = new Uint8Array(16);
const _tempBoards = [new Uint8Array(16), new Uint8Array(16), new Uint8Array(16), new Uint8Array(16)];
const _prevAfter = new Uint8Array(16);
const _moveRewards = new Float64Array(4);

function getEmpty(board) {
  const empty = [];
  for (let i = 0; i < 16; i++) {
    if (board[i] === 0) empty.push(i);
  }
  return empty;
}

function addRandomTile(board) {
  const empty = getEmpty(board);
  if (empty.length === 0) return;
  const pos = empty[(Math.random() * empty.length) | 0];
  board[pos] = Math.random() < 0.9 ? 1 : 2;
}

function addMaxRNGTile(board) {
  const empty = getEmpty(board);
  if (empty.length === 0) return;

  let bestScore = -Infinity;
  let bestPos = empty[0];
  let bestVal = 1;

  for (let i = 0; i < empty.length; i++) {
    const pos = empty[i];
    board[pos] = 1;
    const s1 = evaluate(board);
    if (s1 > bestScore) { bestScore = s1; bestPos = pos; bestVal = 1; }
    board[pos] = 2;
    const s2 = evaluate(board);
    if (s2 > bestScore) { bestScore = s2; bestPos = pos; bestVal = 2; }
    board[pos] = 0;
  }
  board[bestPos] = bestVal;
}

function maxTileIdx(board) {
  let m = 0;
  for (let i = 0; i < 16; i++) if (board[i] > m) m = board[i];
  return m;
}

function movesAvailable(board) {
  for (let i = 0; i < 16; i++) if (board[i] === 0) return true;
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      const v = board[x * 4 + y];
      if (x + 1 < 4 && board[(x + 1) * 4 + y] === v) return true;
      if (y + 1 < 4 && board[x * 4 + y + 1] === v) return true;
    }
  }
  return false;
}


function evaluate(board) {
  let score = 0;
  let ci = 0;
  for (let t = 0; t < NUM_TUPLES; t++) {
    let idx = board[tupleCoords[ci]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 1]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 2]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 3]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 4]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 5]];
    score += weights[tupleTable[t]][idx];
    ci += 6;
  }
  return score;
}

function updateWeights(board, delta, lr) {
  const upd = lr * delta;
  let ci = 0;
  for (let t = 0; t < NUM_TUPLES; t++) {
    let idx = board[tupleCoords[ci]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 1]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 2]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 3]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 4]];
    idx = idx * NUM_VALUES + board[tupleCoords[ci + 5]];
    weights[tupleTable[t]][idx] += upd;
    ci += 6;
  }
}


function simulateMove(board, direction, outBoard) {
  outBoard.set(board);
  _merged.fill(0);
  let reward = 0;
  let moved = false;

  const vx = VECTORS_X[direction];
  const vy = VECTORS_Y[direction];
  const tx = vx === 1 ? TRAV_REV : TRAV_FWD;
  const ty = vy === 1 ? TRAV_REV : TRAV_FWD;

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = tx[i], cy = ty[j];
      const ci = cx * 4 + cy;
      const val = outBoard[ci];
      if (val === 0) continue;

      let px = cx, py = cy;
      let nx = cx + vx, ny = cy + vy;
      while (nx >= 0 && nx < 4 && ny >= 0 && ny < 4 && outBoard[nx * 4 + ny] === 0) {
        px = nx; py = ny;
        nx += vx; ny += vy;
      }

      const ni = nx * 4 + ny;
      const pi = px * 4 + py;

      if (nx >= 0 && nx < 4 && ny >= 0 && ny < 4 &&
          outBoard[ni] === val && !_merged[ni]) {
        outBoard[ci] = 0;
        const newVal = val + 1;
        outBoard[ni] = newVal;
        _merged[ni] = 1;
        reward += IDX_TO_TILE[Math.min(newVal, NUM_VALUES - 1)];
        moved = true;
      } else if (pi !== ci) {
        outBoard[ci] = 0;
        outBoard[pi] = val;
        moved = true;
      }
    }
  }
  return { reward, moved };
}


function getBestMoveInfo(board) {
  let bestScore = -Infinity;
  let bestDir = -1;

  for (let d = 0; d < 4; d++) {
    const { reward, moved } = simulateMove(board, d, _tempBoards[d]);
    if (!moved) continue;
    _moveRewards[d] = reward;
    const score = reward + evaluate(_tempBoards[d]);
    if (score > bestScore) {
      bestScore = score;
      bestDir = d;
    }
  }
  return bestDir;
}


function getBestTilePlacement(afterstate) {
  const empty = getEmpty(afterstate);
  if (empty.length === 0) return null;

  let bestScore = -Infinity;
  let bestPos = empty[0];
  let bestVal = 1;

  for (let i = 0; i < empty.length; i++) {
    const pos = empty[i];
    afterstate[pos] = 1;
    const s1 = evaluate(afterstate);
    if (s1 > bestScore) { bestScore = s1; bestPos = pos; bestVal = 1; }
    afterstate[pos] = 2;
    const s2 = evaluate(afterstate);
    if (s2 > bestScore) { bestScore = s2; bestPos = pos; bestVal = 2; }
    afterstate[pos] = 0;
  }

  return {
    x: (bestPos / 4) | 0,
    y: bestPos % 4,
    value: IDX_TO_TILE[bestVal]
  };
}


let totalGamesPlayed = 0;
let trainingActive = false;
let trainingStartTime = 0;
let recentScores = [];
let recentWins = 0;
let recentMaxTile = 0;
let recentGames = 0;
let allTimeMaxTile = 0;
let learningRate = 0.0025;
const tileDistAll = {};

function trainOneGame(useMaxRNG) {
  const board = new Uint8Array(16);
  addRandomTile(board);
  addRandomTile(board);

  let totalScore = 0;
  let hasPrev = false;
  let prevReward = 0;

  while (true) {
    const bestDir = getBestMoveInfo(board);
    if (bestDir === -1) break;

    const afterstate = _tempBoards[bestDir];
    const reward = _moveRewards[bestDir];
    totalScore += reward;

    // TD(0) afterstate learning
    if (hasPrev) {
      const vCurr = evaluate(afterstate);
      const vPrev = evaluate(_prevAfter);
      updateWeights(_prevAfter, prevReward + vCurr - vPrev, learningRate);
    }

    _prevAfter.set(afterstate);
    prevReward = reward;
    hasPrev = true;


    board.set(afterstate);
    if (useMaxRNG) {
      addMaxRNGTile(board);
    } else {
      addRandomTile(board);
    }

    if (!movesAvailable(board)) break;
  }


  if (hasPrev) {
    const vFinal = evaluate(_prevAfter);
    updateWeights(_prevAfter, prevReward - vFinal, learningRate);
  }

  const mt = maxTileIdx(board);
  const mtVal = IDX_TO_TILE[mt];
  return { score: totalScore, maxTile: mtVal };
}

function updateTrainingStats(result) {
  recentScores.push(result.score);
  recentGames++;
  if (result.maxTile >= 2048) recentWins++;
  if (result.maxTile > recentMaxTile) recentMaxTile = result.maxTile;
  if (result.maxTile > allTimeMaxTile) allTimeMaxTile = result.maxTile;

  const key = String(result.maxTile);
  tileDistAll[key] = (tileDistAll[key] || 0) + 1;
}

function getTrainingStatus() {
  const elapsed = trainingActive ? Date.now() - trainingStartTime : 0;
  const elapsedSec = elapsed / 1000;
  const avgScoreRecent = recentScores.length > 0
    ? (recentScores.reduce((a, b) => a + b, 0) / recentScores.length) | 0
    : 0;
  const winRateRecent = recentGames > 0
    ? ((recentWins / recentGames) * 100).toFixed(1)
    : '0.0';
  const gps = elapsedSec > 0 ? (totalGamesPlayed / elapsedSec).toFixed(0) : '0';
  const remaining = trainingActive
    ? Math.max(0, TRAINING_DURATION_MS - elapsed)
    : 0;
  const remMin = (remaining / 60000) | 0;
  const remSec = ((remaining / 1000) % 60) | 0;

  return {
    training: trainingActive,
    gamesPlayed: totalGamesPlayed,
    elapsedSeconds: elapsedSec | 0,
    gamesPerSecond: parseInt(gps),
    avgScore: avgScoreRecent,
    winRate: winRateRecent + '%',
    maxTile: allTimeMaxTile,
    recentMaxTile: recentMaxTile,
    remaining: remMin + 'm ' + remSec + 's',
    learningRate: learningRate,
    memoryMB: ((NUM_PATTERNS * TABLE_SIZE * 4) / 1024 / 1024) | 0,
    tileDistribution: tileDistAll
  };
}

function logProgress() {
  const status = getTrainingStatus();
  const elapsed = status.elapsedSeconds;
  const h = (elapsed / 3600) | 0;
  const m = ((elapsed % 3600) / 60) | 0;
  const s = elapsed % 60;
  const timeStr = String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');


  const distParts = [];
  const sortedKeys = Object.keys(tileDistAll).map(Number).sort((a, b) => a - b);
  for (const k of sortedKeys) {
    if (k >= 512) {
      const pct = ((tileDistAll[k] / totalGamesPlayed) * 100).toFixed(1);
      distParts.push(k + ':' + pct + '%');
    }
  }

  console.log(
    '[' + timeStr + '] Games: ' + totalGamesPlayed.toLocaleString() +
    ' | ' + status.gamesPerSecond + '/sec' +
    ' | Avg: ' + status.avgScore.toLocaleString() +
    ' | Win: ' + status.winRate +
    ' | Max: ' + status.maxTile +
    ' | LR: ' + learningRate
  );
  if (distParts.length > 0) {
    console.log('  Tiles: ' + distParts.join(' | '));
  }
}

function startTraining() {
  if (trainingActive) return;
  trainingActive = true;
  trainingStartTime = Date.now();
  recentScores = [];
  recentWins = 0;
  recentMaxTile = 0;
  recentGames = 0;

  console.log('========================================');
  console.log('Training started (' + TRAINING_HOURS + 'h, ' + MAX_RNG_RATIO * 100 + '% Max RNG)');
  console.log('Model: ' + NUM_PATTERNS + ' patterns, NUM_VALUES=' + NUM_VALUES +
    ', ~' + ((NUM_PATTERNS * TABLE_SIZE * 4) / 1024 / 1024 | 0) + ' MB');
  console.log('========================================');

  function trainBatch() {
    if (!trainingActive) return;

    const elapsed = Date.now() - trainingStartTime;
    if (elapsed >= TRAINING_DURATION_MS) {
      trainingActive = false;
      saveWeights();
      logProgress();
      console.log('========================================');
      console.log('Training complete! ' + totalGamesPlayed.toLocaleString() + ' games.');
      console.log('Weights saved to ' + WEIGHTS_FILE);
      console.log('========================================');
      return;
    }


// decay LR over the training duration
    const progress = elapsed / TRAINING_DURATION_MS;
    if (progress < 0.25) learningRate = 0.005;
    else if (progress < 0.50) learningRate = 0.0025;
    else if (progress < 0.75) learningRate = 0.001;
    else learningRate = 0.0005;


    for (let i = 0; i < BATCH_GAMES; i++) {
      const useMaxRNG = Math.random() < MAX_RNG_RATIO;
      const result = trainOneGame(useMaxRNG);
      totalGamesPlayed++;
      updateTrainingStats(result);
    }


    if (totalGamesPlayed % LOG_INTERVAL_GAMES < BATCH_GAMES) {
      logProgress();

      recentScores = [];
      recentWins = 0;
      recentMaxTile = 0;
      recentGames = 0;
    }


    if (totalGamesPlayed % SAVE_INTERVAL_GAMES < BATCH_GAMES) {
      saveWeights();
    }

    setImmediate(trainBatch);
  }

  setImmediate(trainBatch);
}


function saveWeights() {
  try {
    const totalBytes = NUM_PATTERNS * TABLE_SIZE * 4;
    const buf = Buffer.alloc(totalBytes);
    let offset = 0;
    for (let i = 0; i < NUM_PATTERNS; i++) {
      Buffer.from(weights[i].buffer, weights[i].byteOffset, weights[i].byteLength)
        .copy(buf, offset);
      offset += TABLE_SIZE * 4;
    }
    fs.writeFileSync(WEIGHTS_FILE, buf);
    fs.writeFileSync(META_FILE, JSON.stringify({
      gamesPlayed: totalGamesPlayed,
      patterns: NUM_PATTERNS,
      numValues: NUM_VALUES,
      tupleSize: 6,
      maxTile: allTimeMaxTile,
      learningRate: learningRate,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.error('Failed to save weights:', e.message);
  }
}

function loadWeights() {
  try {
    if (!fs.existsSync(WEIGHTS_FILE) || !fs.existsSync(META_FILE)) return false;
    const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    if (meta.patterns !== NUM_PATTERNS || meta.numValues !== NUM_VALUES) {
      console.log('Weight file incompatible, starting fresh.');
      return false;
    }

    const buf = fs.readFileSync(WEIGHTS_FILE);
    let offset = 0;
    for (let i = 0; i < NUM_PATTERNS; i++) {
      const byteLen = TABLE_SIZE * 4;
      const src = new Float32Array(buf.buffer, buf.byteOffset + offset, TABLE_SIZE);
      weights[i].set(src);
      offset += byteLen;
    }
    totalGamesPlayed = meta.gamesPlayed || 0;
    allTimeMaxTile = meta.maxTile || 0;
    learningRate = meta.learningRate || 0.0025;
    console.log('Loaded weights: ' + totalGamesPlayed.toLocaleString() +
      ' games, max tile ' + allTimeMaxTile);
    return true;
  } catch (e) {
    console.error('Failed to load weights:', e.message);
    return false;
  }
}


const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

const projectDir = path.resolve(__dirname);

function serveStatic(reqPath, res) {
  let safePath = reqPath === '/' ? '/index.html' : reqPath;
  safePath = decodeURIComponent(safePath);
  const filePath = path.resolve(projectDir, '.' + safePath);


// path traversal guard
  if (!filePath.startsWith(projectDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 100) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function boardFromCells(cells) {
  const board = new Uint8Array(16);
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      const val = cells[x][y];
      board[x * 4 + y] = val === 0 ? 0 : TILE_TO_IDX[val] || 0;
    }
  }
  return board;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;


  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(getTrainingStatus()));
    return;
  }

  if (pathname === '/api/move' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const board = boardFromCells(body.cells);
      const bestDir = getBestMoveInfo(board);

      let tile = null;
      if (body.maxRNG && bestDir >= 0) {

        const afterCopy = new Uint8Array(_tempBoards[bestDir]);
        tile = getBestTilePlacement(afterCopy);
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ direction: bestDir, tile: tile }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }


  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }


  serveStatic(pathname, res);
});


loadWeights();

server.listen(PORT, () => {
  console.log('');
  console.log('2048 AI Training Server running at http://localhost:' + PORT);
  console.log('Open the URL in your browser to play while training.');
  console.log('');
  startTraining();
});


process.on('SIGINT', () => {
  console.log('\nSaving weights before exit...');
  trainingActive = false;
  saveWeights();
  logProgress();
  console.log('Done. Exiting.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  trainingActive = false;
  saveWeights();
  process.exit(0);
});
