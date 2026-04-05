function AI(gameManager) {
  this.gameManager = gameManager;
  this.running = false;
  this.moveInterval = null;
  this.speed = 50;
}



AI.prototype.cloneGrid = function (grid) {
  var size = grid.size;
  var cells = [];
  for (var x = 0; x < size; x++) {
    cells[x] = [];
    for (var y = 0; y < size; y++) {
      var tile = grid.cells[x][y];
      cells[x][y] = tile ? tile.value : 0;
    }
  }
  return cells;
};

AI.prototype.cloneCells = function (cells) {
  var size = cells.length;
  var copy = [];
  for (var x = 0; x < size; x++) {
    copy[x] = [];
    for (var y = 0; y < size; y++) {
      copy[x][y] = cells[x][y];
    }
  }
  return copy;
};


AI.prototype.simulateMove = function (cells, direction) {
  var size = cells.length;
  var newCells = this.cloneCells(cells);
  var score = 0;
  var moved = false;

  var vectors = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 }
  ];
  var vector = vectors[direction];


  var traversalsX = [];
  var traversalsY = [];
  for (var pos = 0; pos < size; pos++) {
    traversalsX.push(pos);
    traversalsY.push(pos);
  }
  if (vector.x === 1) traversalsX.reverse();
  if (vector.y === 1) traversalsY.reverse();


  var merged = [];
  for (var x = 0; x < size; x++) {
    merged[x] = [];
    for (var y = 0; y < size; y++) {
      merged[x][y] = false;
    }
  }

  for (var i = 0; i < traversalsX.length; i++) {
    for (var j = 0; j < traversalsY.length; j++) {
      var cx = traversalsX[i];
      var cy = traversalsY[j];
      var value = newCells[cx][cy];

      if (value === 0) continue;


      var prevX = cx, prevY = cy;
      var nextX = cx + vector.x, nextY = cy + vector.y;

      while (nextX >= 0 && nextX < size && nextY >= 0 && nextY < size && newCells[nextX][nextY] === 0) {
        prevX = nextX;
        prevY = nextY;
        nextX += vector.x;
        nextY += vector.y;
      }


      if (nextX >= 0 && nextX < size && nextY >= 0 && nextY < size &&
          newCells[nextX][nextY] === value && !merged[nextX][nextY]) {

        newCells[cx][cy] = 0;
        newCells[nextX][nextY] = value * 2;
        merged[nextX][nextY] = true;
        score += value * 2;
        moved = true;
      } else if (prevX !== cx || prevY !== cy) {

        newCells[cx][cy] = 0;
        newCells[prevX][prevY] = value;
        moved = true;
      }
    }
  }

  return { cells: newCells, score: score, moved: moved };
};



AI.prototype.evaluate = function (cells) {
  var empty = this.countEmpty(cells);
  var monotonicity = this.monotonicity(cells);
  var smoothness = this.smoothness(cells);
  var maxVal = this.maxValue(cells);
  var cornerBonus = this.cornerBonus(cells, maxVal);
  var mergeScore = this.mergePotential(cells);

  // weights found through trial and error
  return monotonicity * 1.0 +
         smoothness * 0.1 +
         Math.log2(empty + 1) * 2.7 +
         cornerBonus * 1.0 +
         mergeScore * 0.7;
};

AI.prototype.countEmpty = function (cells) {
  var count = 0;
  var size = cells.length;
  for (var x = 0; x < size; x++) {
    for (var y = 0; y < size; y++) {
      if (cells[x][y] === 0) count++;
    }
  }
  return count;
};

AI.prototype.maxValue = function (cells) {
  var max = 0;
  var size = cells.length;
  for (var x = 0; x < size; x++) {
    for (var y = 0; y < size; y++) {
      if (cells[x][y] > max) max = cells[x][y];
    }
  }
  return max;
};


AI.prototype.cornerBonus = function (cells, maxVal) {
  var size = cells.length;
  var corners = [
    cells[0][0], cells[0][size - 1],
    cells[size - 1][0], cells[size - 1][size - 1]
  ];
  if (corners.indexOf(maxVal) !== -1) {
    return Math.log2(maxVal);
  }
  return 0;
};


AI.prototype.monotonicity = function (cells) {
  var size = cells.length;
  var totals = [0, 0, 0, 0];


  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size - 1; x++) {
      var cur = cells[x][y] ? Math.log2(cells[x][y]) : 0;
      var next = cells[x + 1][y] ? Math.log2(cells[x + 1][y]) : 0;
      if (cur > next) {
        totals[0] += next - cur;
      } else if (next > cur) {
        totals[1] += cur - next;
      }
    }
  }


  for (var x2 = 0; x2 < size; x2++) {
    for (var y2 = 0; y2 < size - 1; y2++) {
      var curV = cells[x2][y2] ? Math.log2(cells[x2][y2]) : 0;
      var nextV = cells[x2][y2 + 1] ? Math.log2(cells[x2][y2 + 1]) : 0;
      if (curV > nextV) {
        totals[2] += nextV - curV;
      } else if (nextV > curV) {
        totals[3] += curV - nextV;
      }
    }
  }

  return Math.max(totals[0], totals[1]) + Math.max(totals[2], totals[3]);
};


AI.prototype.smoothness = function (cells) {
  var size = cells.length;
  var smoothness = 0;

  for (var x = 0; x < size; x++) {
    for (var y = 0; y < size; y++) {
      if (cells[x][y] !== 0) {
        var val = Math.log2(cells[x][y]);

        if (x + 1 < size && cells[x + 1][y] !== 0) {
          smoothness -= Math.abs(val - Math.log2(cells[x + 1][y]));
        }

        if (y + 1 < size && cells[x][y + 1] !== 0) {
          smoothness -= Math.abs(val - Math.log2(cells[x][y + 1]));
        }
      }
    }
  }

  return smoothness;
};


AI.prototype.mergePotential = function (cells) {
  var size = cells.length;
  var merges = 0;

  for (var x = 0; x < size; x++) {
    for (var y = 0; y < size; y++) {
      if (cells[x][y] !== 0) {
        if (x + 1 < size && cells[x + 1][y] === cells[x][y]) merges++;
        if (y + 1 < size && cells[x][y + 1] === cells[x][y]) merges++;
      }
    }
  }

  return merges;
};



AI.prototype.getBestMove = function () {
  var grid = this.gameManager.grid;
  var cells = this.cloneGrid(grid);
  var empty = this.countEmpty(cells);

  // deeper search when the board is tight
  var depth;
  if (empty <= 3) {
    depth = 5;
  } else if (empty <= 6) {
    depth = 4;
  } else {
    depth = 3;
  }

  var bestScore = -Infinity;
  var bestMove = -1;

  for (var direction = 0; direction < 4; direction++) {
    var result = this.simulateMove(cells, direction);
    if (!result.moved) continue;

    var score = result.score + this.expectimax(result.cells, depth - 1, false);

    if (score > bestScore) {
      bestScore = score;
      bestMove = direction;
    }
  }

  return bestMove;
};


AI.prototype.expectimax = function (cells, depth, isPlayer) {
  if (depth === 0) {
    return this.evaluate(cells);
  }

  if (isPlayer) {

    var bestScore = -Infinity;
    var anyMoved = false;

    for (var direction = 0; direction < 4; direction++) {
      var result = this.simulateMove(cells, direction);
      if (!result.moved) continue;
      anyMoved = true;

      var score = result.score + this.expectimax(result.cells, depth - 1, false);
      if (score > bestScore) {
        bestScore = score;
      }
    }

    return anyMoved ? bestScore : this.evaluate(cells);
  } else {

    var size = cells.length;
    var emptyCells = [];

    for (var x = 0; x < size; x++) {
      for (var y = 0; y < size; y++) {
        if (cells[x][y] === 0) {
          emptyCells.push({ x: x, y: y });
        }
      }
    }

    if (emptyCells.length === 0) {
      return this.evaluate(cells);
    }


    var cellsToCheck = emptyCells;
    if (emptyCells.length > 6 && depth <= 2) {

      cellsToCheck = this.sampleCells(emptyCells, 6);
    }

    var totalScore = 0;
    var totalWeight = 0;

    for (var i = 0; i < cellsToCheck.length; i++) {
      var cell = cellsToCheck[i];


      var cells2 = this.cloneCells(cells);
      cells2[cell.x][cell.y] = 2;
      var score2 = this.expectimax(cells2, depth - 1, true);
      totalScore += 0.9 * score2;
      totalWeight += 0.9;


      var cells4 = this.cloneCells(cells);
      cells4[cell.x][cell.y] = 4;
      var score4 = this.expectimax(cells4, depth - 1, true);
      totalScore += 0.1 * score4;
      totalWeight += 0.1;
    }

    return totalScore / totalWeight;
  }
};

AI.prototype.sampleCells = function (arr, count) {
  var shuffled = arr.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled.slice(0, count);
};



AI.prototype.start = function () {
  if (this.running) return;
  this.running = true;
  this.run();
};

AI.prototype.stop = function () {
  this.running = false;
  if (this.moveInterval) {
    clearTimeout(this.moveInterval);
    this.moveInterval = null;
  }
};

AI.prototype.run = function () {
  var self = this;

  if (!this.running) return;

  var gm = this.gameManager;


  if (gm.over) {
    this.running = false;
    console.log("Game Over! Final score: " + gm.score);
    return;
  }

  if (gm.won && !gm.keepPlaying) {

    gm.keepPlaying = true;
    gm.actuator.continueGame();
    console.log("Reached 2048! Continuing to play...");
  }

  var bestMove = this.getBestMove();

  if (bestMove === -1) {

    for (var d = 0; d < 4; d++) {
      var result = this.simulateMove(this.cloneGrid(gm.grid), d);
      if (result.moved) {
        bestMove = d;
        break;
      }
    }
  }

  if (bestMove !== -1) {
    gm.move(bestMove);
  }

  this.moveInterval = setTimeout(function () {
    self.run();
  }, self.speed);
};

AI.prototype.setSpeed = function (ms) {
  this.speed = ms;
};
