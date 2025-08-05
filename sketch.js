// ----- 定数・初期値（GUIで操作するためparamsにまとめる） -----
function getGraphHeight() {
  const targetAspect = 5;
  const gridPixelWidth = params.gridSize * params.cellSize;
  return floor(gridPixelWidth / targetAspect);
}


const params = {
  gridSize: 50,
  cellSize: 18,
  updateInterval: 100,
  grassGrowInterval: 10,
  grassEnergy: 8,
  herbivoreInitialHealth: 10,
  herbivoreReproductionThreshold: 20, // 繁殖閾値（初期体力の2倍）
  herbivoreFullThreshold: 20,         // 追加：満腹閾値（草を食べるかの基準）
  movePreference: "Prefer Grass",
  initialGrassCount: 200,
  initialHerbivoreCount: 30,

  // GUI操作用関数
  stop: function() {
    isPaused = !isPaused;
    gui.__controllers[0].name(isPaused ? 'Start' : 'Stop');

    if (!isPaused && turnCounter === 0 && history.length === 0) {
      placeInitialEntities();
    }
  },
  restart: function() {
    resetSimulation();
  },
  saveHistory: function() {
    saveHistoryAsJSON();
  },
  loadHistory: function() {
    openFileSelector();
  },
  turnSlider: 0,
  setTurn: function(val) {
    let i = Math.floor(val);
    if (history.length > 0 && i >= 0 && i < history.length) {
      currentTurnIndex = i;
      restoreGridFromState(history[i]);
      isPaused = true;
      turnCounter = i;
      herbivoreCounts = [countEntitiesByType("Herbivore")];
      grassCounts = [countEntitiesByType("Grass")];
    }
  }
};

// ----- グローバル変数 -----
let grid = [];
let turnCounter = 0;
let lastUpdateTime = 0;

let herbivoreCounts = [];
let grassCounts = [];

let isPaused = true;  // 最初は停止状態
let doStep = false;

let gui;

let history = [];
let currentTurnIndex = -1;
let stopController;

// ----- p5.js setup -----
function setup() {
  const graphHeight = getGraphHeight();
  createCanvas(params.gridSize * params.cellSize, params.gridSize * params.cellSize + graphHeight);
  frameRate(60);
  initializeGrid();

  gui = new dat.GUI();

  stopController = gui.add(params, 'stop').name('Start');
  gui.add(params, 'restart').name('Restart');

  gui.add(params, 'gridSize', 20, 100, 1).name('Grid Size').onFinishChange(value => {
    params.gridSize = value;
    resetSimulation();
  });
  gui.add(params, 'cellSize', 5, 30, 1).name('Cell Size').onFinishChange(value => {
    params.cellSize = value;
    resetSimulation();
  });
  gui.add(params, 'updateInterval', 10, 1000, 10).name('Update Interval (ms)').onChange(value => {
    params.updateInterval = value;
  });
  gui.add(params, 'grassGrowInterval', 1, 50, 1).name('Grass Grow Interval').onChange(value => {
    params.grassGrowInterval = value;
  });
  gui.add(params, 'grassEnergy', 1, 30, 1).name('Grass Energy').onChange(value => {
    params.grassEnergy = value;
  });
  gui.add(params, 'herbivoreInitialHealth', 1, 50, 1).name('Herbivore Init Health').onFinishChange(value => {
    params.herbivoreInitialHealth = value;
    params.herbivoreReproductionThreshold = value * 2;
    if(params.herbivoreFullThreshold < value) {
      params.herbivoreFullThreshold = value;  // 満腹閾値も最低初期体力に調整
    }
    resetSimulation();
  });
  gui.add(params, 'herbivoreReproductionThreshold', 2, 100, 1).name('Herbivore Repro Threshold').onChange(value => {
    params.herbivoreReproductionThreshold = value;
  });
  gui.add(params, 'herbivoreFullThreshold', 1, 100, 1).name('Herbivore Full Threshold').onChange(value => {
    params.herbivoreFullThreshold = value;
  });
  gui.add(params, 'initialGrassCount', 10, 1000, 1).name('Initial Grass Count').onFinishChange(value => {
    resetSimulation();
  });
  gui.add(params, 'initialHerbivoreCount', 1, 200, 1).name('Initial Herbivore Count').onFinishChange(value => {
    resetSimulation();
  });

  gui.add(params, 'saveHistory').name("Save History");
  gui.add(params, 'loadHistory').name("Load History");
  gui.add(params, 'movePreference', ['Prefer Grass', 'Random']).name('Move Strategy');
  gui.add(params, 'turnSlider', 0, 0, 1).name("Turn").onChange(val => {
    params.setTurn(val);
  }).listen();
}

// ----- p5.js draw -----
function draw() {
  background(220);

  if (!isPaused) {
    if (millis() - lastUpdateTime >= params.updateInterval) {
      updateTurn();
      lastUpdateTime = millis();
    }
  } else {
    if (doStep) {
      updateTurn();
      doStep = false;
    }
  }

  drawGrid();
  drawPopulationGraph();
}

// ----- 初期化関数 -----
function initializeGrid() {
  grid = [];
  for (let y = 0; y < params.gridSize; y++) {
    let row = [];
    for (let x = 0; x < params.gridSize; x++) {
      row.push({grass: null, herbivore: null});
    }
    grid.push(row);
  }

  turnCounter = 0;
  herbivoreCounts = [];
  grassCounts = [];
  lastUpdateTime = millis();

  history = [];
  currentTurnIndex = -1;
  params.turnSlider = 0;
}

// ----- 初期個体配置 -----
function placeInitialEntities() {
  let grassPlaced = 0;
  while (grassPlaced < params.initialGrassCount) {
    let x = floor(random(params.gridSize));
    let y = floor(random(params.gridSize));
    if (grid[y][x].grass === null && grid[y][x].herbivore === null) {
      grid[y][x].grass = new Grass();
      grassPlaced++;
    }
  }

  let herbPlaced = 0;
  while (herbPlaced < params.initialHerbivoreCount) {
    let x = floor(random(params.gridSize));
    let y = floor(random(params.gridSize));
    if (grid[y][x].herbivore === null) {
      grid[y][x].herbivore = new Herbivore(params.herbivoreInitialHealth);
      herbPlaced++;
    }
  }

  history.push(serializeGrid());
  currentTurnIndex = 0;
  params.turnSlider = 0;
}

// ----- シミュレーション更新 -----
function updateTurn() {
  if (history.length > 0 && currentTurnIndex < history.length - 1) {
    // 履歴再生モード
    currentTurnIndex++;
    restoreGridFromState(history[currentTurnIndex]);
    turnCounter = currentTurnIndex;

    herbivoreCounts.push(countEntitiesByType("Herbivore"));
    grassCounts.push(countEntitiesByType("Grass"));
  } else {
    turnCounter++;

    // 草増殖
    if (turnCounter % params.grassGrowInterval === 0) {
      let newGrass = [];
      for (let y = 0; y < params.gridSize; y++) {
        for (let x = 0; x < params.gridSize; x++) {
          if (grid[y][x].grass instanceof Grass) {
            let candidates = getEmptyNeighbors(x, y);
            if (candidates.length > 0) {
              let [nx, ny] = random(candidates);
              newGrass.push([nx, ny]);
            }
          }
        }
      }
      for (let [x, y] of newGrass) {
        if (grid[y][x].grass === null && grid[y][x].herbivore === null) {
          grid[y][x].grass = new Grass();
        }
      }
    }

    // 草食動物行動リセット
    for (let y = 0; y < params.gridSize; y++) {
      for (let x = 0; x < params.gridSize; x++) {
        if (grid[y][x].herbivore instanceof Herbivore) {
          grid[y][x].herbivore.hasActed = false;
        }
      }
    }

    // 草食動物行動
    for (let y = 0; y < params.gridSize; y++) {
      for (let x = 0; x < params.gridSize; x++) {
        if (grid[y][x].herbivore instanceof Herbivore && !grid[y][x].herbivore.hasActed) {
          grid[y][x].herbivore.act(grid, x, y);
        }
      }
    }

    // 死亡処理
    for (let y = 0; y < params.gridSize; y++) {
      for (let x = 0; x < params.gridSize; x++) {
        const herb = grid[y][x].herbivore;
        if (herb instanceof Herbivore && herb.energy <= 0) {
          grid[y][x].herbivore = null;
        }
      }
    }

    herbivoreCounts.push(countEntitiesByType("Herbivore"));
    grassCounts.push(countEntitiesByType("Grass"));

    history.push(serializeGrid());
    currentTurnIndex = history.length - 1;
  }

  params.turnSlider = currentTurnIndex;
}

// ----- 個体数カウント補助 -----
function countEntitiesByType(type) {
  let count = 0;
  for (let y = 0; y < params.gridSize; y++) {
    for (let x = 0; x < params.gridSize; x++) {
      const cell = grid[y][x];
      if (type === "Herbivore" && cell.herbivore instanceof Herbivore) count++;
      else if (type === "Grass" && cell.grass instanceof Grass) count++;
    }
  }
  return count;
}

// ----- グリッド描画 -----
function drawGrid() {
  // セルの塗りつぶし描画（草・空・草食動物）
  for (let y = 0; y < params.gridSize; y++) {
    for (let x = 0; x < params.gridSize; x++) {
      const cell = grid[y][x];
      // 草を先に描画
      if (cell.grass instanceof Grass) {
        fill(0, 200, 0);
        noStroke();
        rect(x * params.cellSize, y * params.cellSize, params.cellSize, params.cellSize);
      } else {
        fill(255);
        noStroke();
        rect(x * params.cellSize, y * params.cellSize, params.cellSize, params.cellSize);
      }
      // 草食動物を上に描画
      if (cell.herbivore instanceof Herbivore) {
        fill(200, 100, 0);
        stroke(120, 60, 0);
        strokeWeight(1);
        const cx = x * params.cellSize + params.cellSize / 2;
        const cy = y * params.cellSize + params.cellSize / 2;
        ellipse(cx, cy, params.cellSize * 0.8, params.cellSize * 0.8);
      }
    }
  }

  // すべてのセルの上にグリッド線を一括で描画
  stroke(150);
  strokeWeight(1);
  noFill();
  for (let y = 0; y <= params.gridSize; y++) {
    line(0, y * params.cellSize, params.gridSize * params.cellSize, y * params.cellSize); // 横線
  }
  for (let x = 0; x <= params.gridSize; x++) {
    line(x * params.cellSize, 0, x * params.cellSize, params.gridSize * params.cellSize); // 縦線
  }
}

// ----- グラフ描画 -----
function drawPopulationGraph() {
  const graphHeight = getGraphHeight();
  const leftMargin = 40;
  const rightMargin = 10;
  const innerGap = 10;

  const graphWidth = width - leftMargin - rightMargin;
  const graphHeightEach = (graphHeight - 3 * innerGap) / 2;

  const startX = leftMargin;
  const startYGrass = params.gridSize * params.cellSize + innerGap;
  const startYHerb = startYGrass + graphHeightEach + innerGap;

  const maxTurn = max(grassCounts.length, herbivoreCounts.length, 1);
  const maxGrass = max(grassCounts) || 1;
  const maxHerbivore = max(herbivoreCounts) || 1;

  // 軸描画関数
  function drawAxes(x, y, w, h, label, maxVal) {
    fill(255);
    stroke(0);
    rect(x, y, w, h);

    fill(0);
    textSize(10);
    textAlign(RIGHT, CENTER);

    for (let i = 0; i <= 5; i++) {
      let val = floor(maxVal * (i / 5));
      let ty = y + h - (h * i / 5);
      text(val, x - 5, ty);
      stroke(220);
      line(x, ty, x + w, ty);
    }

    textAlign(CENTER, TOP);
    for (let i = 0; i <= 5; i++) {
      let turn = floor((maxTurn - 1) * (i / 5));
      let tx = x + w * i / 5;
      text(turn, tx, y + h + 2);
      stroke(220);
      line(tx, y, tx, y + h);
    }

    textAlign(LEFT, TOP);
    text(label, x + 5, y + 5);
  }

  // 折れ線グラフ描画
  function drawLine(x, y, w, h, data, maxVal, colorVal) {
    stroke(colorVal);
    noFill();
    beginShape();
    const len = data.length;
    const denom = max(len - 1, 1);  // 配列長さに応じた動的スケーリング
    for (let i = 0; i < len; i++) {
      const tx = x + (w * i) / denom;
      const ty = y + h - map(data[i], 0, maxVal, 0, h);
      vertex(tx, ty);
    }
    endShape();
  }

  drawAxes(startX, startYGrass, graphWidth, graphHeightEach, "Grass", maxGrass);
  drawLine(startX, startYGrass, graphWidth, graphHeightEach, grassCounts, maxGrass, color(0, 200, 0));

  drawAxes(startX, startYHerb, graphWidth, graphHeightEach, "Herbivore", maxHerbivore);
  drawLine(startX, startYHerb, graphWidth, graphHeightEach, herbivoreCounts, maxHerbivore, color(200, 100, 0));
}

// ----- 空きセル探索 -----
function getEmptyNeighbors(x, y) {
  let dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ];
  let result = [];
  for (let [dx, dy] of dirs) {
    let nx = x + dx;
    let ny = y + dy;
    if (
      nx >= 0 && nx < params.gridSize &&
      ny >= 0 && ny < params.gridSize &&
      grid[ny][nx].herbivore === null && // 移動先に草食動物がいない
      grid[ny][nx].grass === null         // 空セルなら
    ) {
      result.push([nx, ny]);
    }
  }
  return result;
}

// ----- 繁殖候補セル取得（空セル＋草セル） -----
function getReproductionCandidates(x, y) {
  let dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ];
  let result = [];
  for (let [dx, dy] of dirs) {
    let nx = x + dx;
    let ny = y + dy;
    if (
      nx >= 0 && nx < params.gridSize &&
      ny >= 0 && ny < params.gridSize
    ) {
      const cell = grid[ny][nx];
      if (cell.herbivore === null) {
        // 空セルか草セルなら繁殖可能
        if (cell.grass === null || cell.grass instanceof Grass) {
          result.push([nx, ny]);
        }
      }
    }
  }
  return result;
}

// ----- 草クラス -----
class Grass {
  constructor() {
    // 今後成長度や毒性の属性も入れられます
  }
}

// ----- 草食動物クラス -----
class Herbivore {
  constructor(energy) {
    this.energy = energy;
    this.hasActed = false;
  }

  act(grid, x, y) {
    const dirs = shuffle([
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ]);

    let grassCells = [];
    let emptyCells = [];

    for (let [dx, dy] of dirs) {
      let nx = x + dx;
      let ny = y + dy;
      if (nx >= 0 && nx < params.gridSize && ny >= 0 && ny < params.gridSize) {
        const target = grid[ny][nx];
        if (target.grass instanceof Grass) grassCells.push([nx, ny]);
        else if (target.grass === null && target.herbivore === null) emptyCells.push([nx, ny]);
      }
    }

    let moveTo = null;
    let eatGrass = false;

    if (params.movePreference === "Prefer Grass") {
      if (grassCells.length > 0) {
        moveTo = random(grassCells);
        if (this.energy < params.herbivoreFullThreshold) {
          eatGrass = true;
        }
      } else if (emptyCells.length > 0) {
        moveTo = random(emptyCells);
      }
    } else if (params.movePreference === "Random") {
      const allOptions = grassCells.concat(emptyCells);
      if (allOptions.length > 0) {
        moveTo = random(allOptions);
        const [nx, ny] = moveTo;
        if (grid[ny][nx].grass instanceof Grass && this.energy < params.herbivoreFullThreshold) {
          eatGrass = true;
        }
      }
    }

    if (moveTo) {
      const [nx, ny] = moveTo;

      // 移動前セルの草食動物を移動後にコピーして空セルにする
      grid[ny][nx].herbivore = this;
      grid[y][x].herbivore = null;

      // 草を食べる
      if (eatGrass) {
        grid[ny][nx].grass = null;
        this.energy += params.grassEnergy;
      }

      // 毎ターン体力消費
      this.energy -= 1;

      // 繁殖判定
      if (this.energy >= params.herbivoreReproductionThreshold) {
        let candidates = getReproductionCandidates(nx, ny);
        if (candidates.length > 0) {
          let [rx, ry] = random(candidates);
          if (grid[ry][rx].herbivore === null) {
            grid[ry][rx].herbivore = new Herbivore(params.herbivoreInitialHealth);
            this.energy = this.energy - params.herbivoreInitialHealth;
            if (this.energy < 0) this.energy = 0;
          }
        }
      }

      this.hasActed = true;
    } else {
      // 移動不可、でも体力は減る
      this.energy -= 1;
      this.hasActed = true;
    }
  }
}

// ----- グリッド状態の保存・復元 -----
function serializeGrid() {
  let state = [];
  for (let y = 0; y < params.gridSize; y++) {
    let row = [];
    for (let x = 0; x < params.gridSize; x++) {
      const cell = grid[y][x];
      row.push({
        grass: cell.grass instanceof Grass ? 1 : 0,
        herbivore: cell.herbivore instanceof Herbivore ? cell.herbivore.energy : 0
      });
    }
    state.push(row);
  }
  return state;
}

function restoreGridFromState(state) {
  for (let y = 0; y < params.gridSize; y++) {
    for (let x = 0; x < params.gridSize; x++) {
      const cellState = state[y][x];
      grid[y][x].grass = cellState.grass ? new Grass() : null;
      grid[y][x].herbivore = cellState.herbivore > 0 ? new Herbivore(cellState.herbivore) : null;
      if (grid[y][x].herbivore) {
        grid[y][x].herbivore.hasActed = false;
      }
    }
  }
}

// ----- 保存・読み込み関連 -----
function saveHistoryAsJSON() {
  const json = JSON.stringify(history);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = "alife_history.json";
  a.click();
  URL.revokeObjectURL(url);
}

function openFileSelector() {
  let input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const loaded = JSON.parse(e.target.result);
        if (Array.isArray(loaded)) {
          history = loaded;
          currentTurnIndex = 0;
          restoreGridFromState(history[0]);
          turnCounter = 0;
          isPaused = true;
          herbivoreCounts = [countEntitiesByType("Herbivore")];
          grassCounts = [countEntitiesByType("Grass")];
          params.turnSlider = 0;
        } else {
          alert("不正なデータ形式です");
        }
      } catch {
        alert("ファイルの読み込みに失敗しました");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ----- リセット -----
function resetSimulation() {
  const graphHeight = getGraphHeight();
  initializeGrid();             // 1. グリッドを空で初期化
  placeInitialEntities();       // 2. 草と草食動物を配置（←ここまでで grid 完成）
  resizeCanvas(params.gridSize * params.cellSize, params.gridSize * params.cellSize + graphHeight); // ←3. 安全にサイズ変更
  isPaused = true;
  stopController.name('Start');
}


// ----- ヘルパー: 配列シャッフル -----
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = floor(random(i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
