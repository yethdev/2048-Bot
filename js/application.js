window.requestAnimationFrame(function () {
  var gm = new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
  var legacyAI = new AI(gm);
  var rlAI = new NTupleAI();
  var currentAIRunning = null;
  var serverAvailable = false;

  gm.ntupleAI = rlAI;
  rlAI.loadWeights(); // try loading from localStorage

  var modeSelect   = document.querySelector(".ai-mode-select");
  var startBtn     = document.querySelector(".ai-start-button");
  var stopBtn      = document.querySelector(".ai-stop-button");
  var speedSelect  = document.querySelector(".ai-speed-select");
  var maxRNGCheck  = document.querySelector(".max-rng-checkbox");
  var statusEl     = document.querySelector(".ai-status");

  function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  // poll the node server if it's up
  function checkServer() {
    fetch("/api/status").then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!serverAvailable) {
        serverAvailable = true;
        if (modeSelect) modeSelect.value = "rl-server";
      }
      showServerStatus(data);
    }).catch(function () {
      if (serverAvailable) {
        serverAvailable = false;
        updateStatus("Server disconnected.");
        if (modeSelect && modeSelect.value === "rl-server") {
          modeSelect.value = rlAI.trained ? "rl" : "legacy";
        }
      }
    });
  }

  function showServerStatus(d) {
    if (!d) return;
    var msg = "Server: " + d.gamesPlayed.toLocaleString() + " games";
    msg += " | " + d.gamesPerSecond + "/sec";
    msg += " | Avg: " + d.avgScore.toLocaleString();
    msg += " | Win: " + d.winRate;
    msg += " | Max: " + d.maxTile;
    if (d.training) {
      msg += " | " + d.remaining + " left";
    }
    if (!currentAIRunning) updateStatus(msg);
  }

  checkServer();
  setInterval(checkServer, 5000);

  if (maxRNGCheck) {
    maxRNGCheck.addEventListener("change", function () {
      gm.maxRNG = this.checked;
    });
  }

  var rlRunning = false;
  var rlTimeout = null;

  function stopAllAI() {
    legacyAI.stop();
    rlRunning = false;
    if (rlTimeout) { clearTimeout(rlTimeout); rlTimeout = null; }
    currentAIRunning = null;
  }

  function getCellsArray() {
    var cells = [];
    for (var x = 0; x < 4; x++) {
      cells[x] = [];
      for (var y = 0; y < 4; y++) {
        var t = gm.grid.cells[x][y];
        cells[x][y] = t ? t.value : 0;
      }
    }
    return cells;
  }

  function handleWinState() {
    // keep going past 2048
    if (gm.won && typeof gm.keepPlaying !== "boolean") {
      gm.keepPlaying();
    } else if (gm.won && !gm.keepPlaying) {
      gm.keepPlaying = true;
      gm.actuator.continueGame();
    }
  }

  function runServerRL() {
    if (!rlRunning) return;

    if (gm.over) {
      rlRunning = false;
      currentAIRunning = null;
      updateStatus("Game Over! Score: " + gm.score);
      return;
    }

    handleWinState();

    var cells = getCellsArray();
    var useMaxRNG = maxRNGCheck && maxRNGCheck.checked;

    fetch("/api/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells: cells, maxRNG: useMaxRNG })
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!rlRunning) return;

      if (data.direction >= 0) {
        if (data.tile && useMaxRNG) {
          gm.pendingTile = data.tile;
        }
        gm.move(data.direction);
      }

      var speed = parseInt(speedSelect.value, 10) || 50;
      rlTimeout = setTimeout(runServerRL, speed);
    }).catch(function () {
      runBrowserRLOnce(); // fallback if server drops
      var speed = parseInt(speedSelect.value, 10) || 50;
      rlTimeout = setTimeout(runServerRL, speed);
    });
  }

  function runBrowserRL() {
    if (!rlRunning) return;

    if (gm.over) {
      rlRunning = false;
      currentAIRunning = null;
      updateStatus("Game Over! Score: " + gm.score);
      return;
    }

    handleWinState();
    runBrowserRLOnce();
    var speed = parseInt(speedSelect.value, 10) || 50;
    rlTimeout = setTimeout(runBrowserRL, speed);
  }

  function runBrowserRLOnce() {
    var cells = getCellsArray();
    var bestDir = rlAI.getBestMove(cells);
    if (bestDir === -1) {
      for (var d = 0; d < 4; d++) {
        var res = rlAI.simulateMove(cells, d);
        if (res.moved) { bestDir = d; break; }
      }
    }
    if (bestDir !== -1) gm.move(bestDir);
  }

  if (startBtn) {
    startBtn.addEventListener("click", function () {
      stopAllAI();

      if (gm.over || gm.isGameTerminated()) {
        gm.storageManager.clearGameState();
        gm.actuator.continueGame();
        gm.setup();
      }

      var mode = modeSelect.value;

      if (mode === "rl-server") {
        if (!serverAvailable) {
          updateStatus("Server not available. Start server.js or pick another mode.");
          return;
        }
        rlRunning = true;
        currentAIRunning = "rl-server";
        updateStatus("RL AI (Server) playing...");
        runServerRL();
      } else if (mode === "rl") {
        if (!rlAI.trained) {
          updateStatus("Browser RL not trained. Use Server or Legacy mode.");
          return;
        }
        rlRunning = true;
        currentAIRunning = "rl";
        updateStatus("RL AI (Browser) playing...");
        runBrowserRL();
      } else {
        legacyAI.setSpeed(parseInt(speedSelect.value, 10) || 50);
        legacyAI.start();
        currentAIRunning = "legacy";
        updateStatus("Expectimax AI playing...");
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", function () {
      stopAllAI();
      updateStatus("AI stopped.");
    });
  }

  if (speedSelect) {
    speedSelect.addEventListener("change", function () {
      legacyAI.setSpeed(parseInt(this.value, 10) || 50);
    });
  }
});
