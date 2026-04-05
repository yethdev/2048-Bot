var NTupleAI = (function () {
  "use strict";


  var NUM_VALUES = 17;


  var PATTERNS = [

    [[0,0],[1,0],[2,0],[3,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1],[0,2],[1,2]],
    [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]],
    [[0,0],[1,0],[0,1],[1,1],[2,1],[3,1]],


    [[0,0],[1,0],[2,0],[3,0]],
    [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[2,0],[1,1]],
  ];


  // 8 symmetries (rotations + reflections)
  var SYMMETRIES = [
    function (x, y) { return [x, y]; },
    function (x, y) { return [3 - x, y]; },
    function (x, y) { return [x, 3 - y]; },
    function (x, y) { return [3 - x, 3 - y]; },
    function (x, y) { return [y, x]; },
    function (x, y) { return [3 - y, x]; },
    function (x, y) { return [y, 3 - x]; },
    function (x, y) { return [3 - y, 3 - x]; },
  ];


  function NTupleAI() {
    this.weights = [];
    this.tupleInfo = [];
    this.learningRate = 0.0025;
    this.trained = false;
    this.totalGamesPlayed = 0;
    this._initWeights();
  }

  NTupleAI.prototype._initWeights = function () {
    this.tupleInfo = [];
    this.weights = [];
    for (var p = 0; p < PATTERNS.length; p++) {
      var pattern = PATTERNS[p];
      var tableSize = Math.pow(NUM_VALUES, pattern.length);

      var table = new Float32Array(tableSize);
      this.weights.push(table);
      this.tupleInfo.push({ tableSize: tableSize, pattern: pattern, len: pattern.length });
    }
  };


  NTupleAI.prototype._tileIndex = function (value) {
    if (value === 0) return 0;

    var idx = 0;
    var v = value;
    while (v > 1) { v >>= 1; idx++; }
    return idx;
  };


  NTupleAI.prototype._tupleIndex = function (cells, pattern, sym) {
    var index = 0;
    for (var i = 0; i < pattern.length; i++) {
      var coord = sym(pattern[i][0], pattern[i][1]);
      var tileVal = cells[coord[0]][coord[1]];
      index = index * NUM_VALUES + this._tileIndex(tileVal);
    }
    return index;
  };


  NTupleAI.prototype.evaluate = function (cells) {
    var score = 0;
    for (var p = 0; p < PATTERNS.length; p++) {
      var table = this.weights[p];
      var pattern = PATTERNS[p];
      for (var s = 0; s < SYMMETRIES.length; s++) {
        var idx = this._tupleIndex(cells, pattern, SYMMETRIES[s]);
        score += table[idx];
      }
    }
    return score;
  };


  // TD(0) afterstate update
  NTupleAI.prototype._updateWeights = function (cells, delta) {
    var lr = this.learningRate;
    var update = lr * delta;
    for (var p = 0; p < PATTERNS.length; p++) {
      var table = this.weights[p];
      var pattern = PATTERNS[p];
      for (var s = 0; s < SYMMETRIES.length; s++) {
        var idx = this._tupleIndex(cells, pattern, SYMMETRIES[s]);
        table[idx] += update;
      }
    }
  };



  NTupleAI.prototype._emptyBoard = function () {
    return [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  };

  NTupleAI.prototype._cloneCells = function (cells) {
    return [
      [cells[0][0], cells[0][1], cells[0][2], cells[0][3]],
      [cells[1][0], cells[1][1], cells[1][2], cells[1][3]],
      [cells[2][0], cells[2][1], cells[2][2], cells[2][3]],
      [cells[3][0], cells[3][1], cells[3][2], cells[3][3]]
    ];
  };

  NTupleAI.prototype._getEmpty = function (cells) {
    var empty = [];
    for (var x = 0; x < 4; x++) {
      for (var y = 0; y < 4; y++) {
        if (cells[x][y] === 0) empty.push([x, y]);
      }
    }
    return empty;
  };

  NTupleAI.prototype._addRandomTile = function (cells) {
    var empty = this._getEmpty(cells);
    if (empty.length === 0) return;
    var pos = empty[Math.floor(Math.random() * empty.length)];
    cells[pos[0]][pos[1]] = Math.random() < 0.9 ? 2 : 4;
  };


  // picks the tile placement that maximizes board value
  NTupleAI.prototype._addMaxRNGTile = function (cells) {
    var empty = this._getEmpty(cells);
    if (empty.length === 0) return;

    var bestScore = -Infinity;
    var bestX = empty[0][0], bestY = empty[0][1], bestVal = 2;

    for (var i = 0; i < empty.length; i++) {

      cells[empty[i][0]][empty[i][1]] = 2;
      var s2 = this.evaluate(cells);
      if (s2 > bestScore) {
        bestScore = s2;
        bestX = empty[i][0];
        bestY = empty[i][1];
        bestVal = 2;
      }
      cells[empty[i][0]][empty[i][1]] = 0;


      cells[empty[i][0]][empty[i][1]] = 4;
      var s4 = this.evaluate(cells);
      if (s4 > bestScore) {
        bestScore = s4;
        bestX = empty[i][0];
        bestY = empty[i][1];
        bestVal = 4;
      }
      cells[empty[i][0]][empty[i][1]] = 0;
    }

    cells[bestX][bestY] = bestVal;
  };


  NTupleAI.prototype.simulateMove = function (cells, direction) {
    var size = 4;
    var newCells = this._cloneCells(cells);
    var reward = 0;
    var moved = false;

    var vectors = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ];
    var vx = vectors[direction][0], vy = vectors[direction][1];

    var tx = [0,1,2,3], ty = [0,1,2,3];
    if (vx === 1) tx = [3,2,1,0];
    if (vy === 1) ty = [3,2,1,0];

    var merged = [[false,false,false,false],[false,false,false,false],
                  [false,false,false,false],[false,false,false,false]];

    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 4; j++) {
        var cx = tx[i], cy = ty[j];
        var value = newCells[cx][cy];
        if (value === 0) continue;

        var px = cx, py = cy;
        var nx = cx + vx, ny = cy + vy;

        while (nx >= 0 && nx < size && ny >= 0 && ny < size && newCells[nx][ny] === 0) {
          px = nx; py = ny;
          nx += vx; ny += vy;
        }

        if (nx >= 0 && nx < size && ny >= 0 && ny < size &&
            newCells[nx][ny] === value && !merged[nx][ny]) {
          newCells[cx][cy] = 0;
          newCells[nx][ny] = value * 2;
          merged[nx][ny] = true;
          reward += value * 2;
          moved = true;
        } else if (px !== cx || py !== cy) {
          newCells[cx][cy] = 0;
          newCells[px][py] = value;
          moved = true;
        }
      }
    }

    return { cells: newCells, reward: reward, moved: moved };
  };

  NTupleAI.prototype._movesAvailable = function (cells) {

    for (var x = 0; x < 4; x++)
      for (var y = 0; y < 4; y++)
        if (cells[x][y] === 0) return true;

    for (var x2 = 0; x2 < 4; x2++) {
      for (var y2 = 0; y2 < 4; y2++) {
        var v = cells[x2][y2];
        if (x2 + 1 < 4 && cells[x2 + 1][y2] === v) return true;
        if (y2 + 1 < 4 && cells[x2][y2 + 1] === v) return true;
      }
    }
    return false;
  };

  NTupleAI.prototype._maxTile = function (cells) {
    var m = 0;
    for (var x = 0; x < 4; x++)
      for (var y = 0; y < 4; y++)
        if (cells[x][y] > m) m = cells[x][y];
    return m;
  };


  NTupleAI.prototype.getBestMove = function (cells) {
    var bestScore = -Infinity;
    var bestDir = -1;

    for (var d = 0; d < 4; d++) {
      var result = this.simulateMove(cells, d);
      if (!result.moved) continue;
      var score = result.reward + this.evaluate(result.cells);
      if (score > bestScore) {
        bestScore = score;
        bestDir = d;
      }
    }
    return bestDir;
  };




  NTupleAI.prototype.trainOneGame = function (useMaxRNG) {
    var cells = this._emptyBoard();
    this._addRandomTile(cells);
    this._addRandomTile(cells);

    var totalScore = 0;
    var prevAfterstate = null;
    var prevReward = 0;

    while (true) {
      var bestDir = this.getBestMove(cells);
      if (bestDir === -1) break;

      var result = this.simulateMove(cells, bestDir);
      var afterstate = result.cells;
      var reward = result.reward;
      totalScore += reward;


      if (prevAfterstate !== null) {
        var vCurrent = this.evaluate(afterstate);
        var vPrev = this.evaluate(prevAfterstate);
        var tdError = prevReward + vCurrent - vPrev;
        this._updateWeights(prevAfterstate, tdError);
      }

      prevAfterstate = afterstate;
      prevReward = reward;


      cells = this._cloneCells(afterstate);
      if (useMaxRNG) {
        this._addMaxRNGTile(cells);
      } else {
        this._addRandomTile(cells);
      }

      if (!this._movesAvailable(cells)) break;
    }


    if (prevAfterstate !== null) {
      var vFinal = this.evaluate(prevAfterstate);
      var tdErrorFinal = prevReward - vFinal;
      this._updateWeights(prevAfterstate, tdErrorFinal);
    }

    return { score: totalScore, maxTile: this._maxTile(cells) };
  };


  NTupleAI.prototype.train = function (numGames, useMaxRNGRatio, progressCallback, doneCallback) {
    var self = this;
    var gamesPlayed = 0;
    var batchSize = 50;
    var stats = { totalScore: 0, maxTileReached: 0, wins: 0, tileDistribution: {} };

    function runBatch() {
      var batchEnd = Math.min(gamesPlayed + batchSize, numGames);

      while (gamesPlayed < batchEnd) {
        var useMaxRNG = Math.random() < useMaxRNGRatio;
        var result = self.trainOneGame(useMaxRNG);

        stats.totalScore += result.score;
        if (result.maxTile > stats.maxTileReached) stats.maxTileReached = result.maxTile;
        if (result.maxTile >= 2048) stats.wins++;

        var tileKey = result.maxTile.toString();
        stats.tileDistribution[tileKey] = (stats.tileDistribution[tileKey] || 0) + 1;

        gamesPlayed++;
        self.totalGamesPlayed++;
      }

      if (progressCallback) {
        progressCallback({
          gamesPlayed: gamesPlayed,
          totalGames: numGames,
          avgScore: Math.round(stats.totalScore / gamesPlayed),
          winRate: ((stats.wins / gamesPlayed) * 100).toFixed(1) + "%",
          maxTileReached: stats.maxTileReached,
          tileDistribution: stats.tileDistribution
        });
      }

      if (gamesPlayed < numGames) {

        setTimeout(runBatch, 0);
      } else {
        self.trained = true;
        if (doneCallback) {
          doneCallback({
            gamesPlayed: gamesPlayed,
            avgScore: Math.round(stats.totalScore / gamesPlayed),
            winRate: ((stats.wins / gamesPlayed) * 100).toFixed(1) + "%",
            maxTileReached: stats.maxTileReached,
            tileDistribution: stats.tileDistribution
          });
        }
      }
    }


    if (this.totalGamesPlayed > 50000) {
      this.learningRate = 0.00025;
    } else if (this.totalGamesPlayed > 20000) {
      this.learningRate = 0.001;
    } else {
      this.learningRate = 0.0025;
    }

    runBatch();
  };



  NTupleAI.prototype.saveWeights = function () {
    try {
      var data = {
        totalGamesPlayed: this.totalGamesPlayed,
        learningRate: this.learningRate,
        weights: []
      };
      for (var p = 0; p < this.weights.length; p++) {

        data.weights.push(Array.from(this.weights[p]));
      }
      localStorage.setItem("ntuple_ai_weights", JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn("Failed to save weights:", e.message);
      return false;
    }
  };

  NTupleAI.prototype.loadWeights = function () {
    try {
      var json = localStorage.getItem("ntuple_ai_weights");
      if (!json) return false;
      var data = JSON.parse(json);
      if (!data.weights || data.weights.length !== this.weights.length) return false;

      for (var p = 0; p < this.weights.length; p++) {
        var arr = data.weights[p];
        if (arr.length !== this.weights[p].length) return false;
        this.weights[p] = new Float32Array(arr);
      }
      this.totalGamesPlayed = data.totalGamesPlayed || 0;
      this.learningRate = data.learningRate || 0.0025;
      this.trained = true;
      return true;
    } catch (e) {
      console.warn("Failed to load weights:", e.message);
      return false;
    }
  };

  NTupleAI.prototype.clearWeights = function () {
    this._initWeights();
    this.totalGamesPlayed = 0;
    this.trained = false;
    localStorage.removeItem("ntuple_ai_weights");
  };


  NTupleAI.prototype.getMemoryUsageMB = function () {
    var bytes = 0;
    for (var p = 0; p < this.weights.length; p++) {
      bytes += this.weights[p].byteLength;
    }
    return (bytes / (1024 * 1024)).toFixed(1);
  };

  return NTupleAI;
})();
