// ============================================================
// RogueMap — Tactical branching node-map generator.
//
// Each floor is a graph of node columns. The player enters at the
// leftmost entry node and advances one column at a time, along
// connected edges. A boss node sits at the far right of the final
// floor. Node types (combat/elite/encounter/shop/rest/minigame)
// are weighted per floor.
// ============================================================

import { CONFIG } from '../config.js';

const M = CONFIG.map;
const FLOOR_WEIGHTS = CONFIG.nodes.floorWeights;

// Simple deterministic PRNG (mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const NODE_TYPES = {
  COMBAT: 'combat',
  ELITE: 'elite',
  BOSS: 'boss',
  ENCOUNTER: 'encounter',
  SHOP: 'shop',
  REST: 'rest',
  MINIGAME: 'minigame',
  ENTRY: 'entry',
};

export class RogueMap {
  /**
   * @param {number} runSeed - changes every run for variety
   */
  constructor(runSeed = 1) {
    this.runSeed = runSeed;
    this.floors = this._generateFloors();
    this.sanitizeGridNodes();
  }

  /** Regenerate with a new seed (new run). */
  regenerate(runSeed) {
    this.runSeed = runSeed;
    this.floors = this._generateFloors();
    this.sanitizeGridNodes();
  }

  sanitizeGridNodes() {
    if (!this.floors) return;
    for (const floor of this.floors) {
      if (!floor || !floor.nodes) continue;
      for (const node of floor.nodes) {
        if (node.type === 'miniboss' || node.type === 'boss') {
          node.type = 'elite';
        }
      }
    }
  }

  _generateFloors() {
    const floors = [];
    for (let f = 0; f < M.floors; f++) {
      floors.push(this._generateFloor(f));
    }
    return floors;
  }

  /** Endless Abyss: append another floor laid out like floor 5. Returns its index. */
  addAbyssFloor() {
    const idx = this.floors.length;
    this.floors.push(this._generateFloor(idx, M.floors - 1));
    return idx;
  }

  _generateFloor(floorIndex, weightsFloor = floorIndex) {
    const rng = mulberry32(hashString(`${this.runSeed}:floor:${floorIndex}`));
    const weights = FLOOR_WEIGHTS[weightsFloor + 1] || FLOOR_WEIGHTS[1];

    const isLast = floorIndex === M.floors - 1;
    const rows = M.rows || 5;
    const cols = M.cols || 5;
    const centerRow = Math.floor(rows / 2);
    const centerCol = Math.floor(cols / 2);

    const centerX = M.floorWidth / 2;
    const centerY = M.floorHeight / 2;

    const nodeGrid = [];
    const nodes = [];

    for (let r = 0; r < rows; r++) {
      nodeGrid.push(new Array(cols).fill(null));
    }

    // Generate grid nodes centered at (centerRow, centerCol)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const distFromCenter = Math.abs(r - centerRow) + Math.abs(c - centerCol);

        let nodeType;
        const isEntry = r === centerRow && c === centerCol;

        if (isEntry) {
          nodeType = NODE_TYPES.ENTRY;
        } else {
          nodeType = this._pickType(rng, weights, floorIndex, isLast);
        }

        const posX = centerX + (c - centerCol) * M.colGap;
        const posY = centerY + (r - centerRow) * M.rowGap;

        // Entry is visited & cleared; immediate 4-way neighbors start unlocked
        const isInitialNeighbor = distFromCenter <= 1;

        const node = {
          id: `f${floorIndex}-r${r}-c${c}`,
          floor: floorIndex,
          col: c,
          row: r,
          x: posX,
          y: posY,
          type: nodeType,
          visited: isEntry,
          cleared: isEntry,
          locked: !isInitialNeighbor,
        };

        nodes.push(node);
        nodeGrid[r][c] = node;
      }
    }

    // Build 4-directional grid edges (Left, Right, Top, Bottom)
    const edges = [];
    const addEdge = (a, b) => {
      if (!a || !b) return;
      if (!edges.some((e) => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id))) {
        edges.push({ from: a.id, to: b.id, visited: false });
      }
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const curr = nodeGrid[r][c];
        if (!curr) continue;

        // Connect right neighbor
        if (c + 1 < cols && nodeGrid[r][c + 1]) {
          addEdge(curr, nodeGrid[r][c + 1]);
        }
        // Connect bottom neighbor
        if (r + 1 < rows && nodeGrid[r + 1][c]) {
          addEdge(curr, nodeGrid[r + 1][c]);
        }
      }
    }

    return {
      index: floorIndex,
      isLast,
      rows,
      cols,
      centerRow,
      centerCol,
      nodes,
      edges,
      nodeGrid,
    };
  }

  _pickType(rng, weights, floorIndex, isLast) {
    let total = 0;
    for (const k in weights) {
      if (k === 'miniboss' || k === 'boss') continue;
      total += weights[k];
    }
    if (total <= 0) return NODE_TYPES.COMBAT;
    let roll = rng() * total;

    const keys = Object.keys(weights);
    for (const k of keys) {
      if (k === 'miniboss' || k === 'boss') continue;
      roll -= weights[k];
      if (roll <= 0) return k;
    }
    return NODE_TYPES.COMBAT;
  }

  /**
   * Get connected adjacent nodes in all 4 directions (left, right, top, bottom)
   */
  getNextOptions(floor, currentNodeId) {
    const f = this.floors[floor];
    if (!f) return [];

    const options = new Set();

    for (const e of f.edges) {
      let targetId = null;
      if (e.from === currentNodeId) targetId = e.to;
      else if (e.to === currentNodeId) targetId = e.from;

      if (targetId) {
        const targetNode = f.nodes.find((n) => n.id === targetId);
        if (targetNode && !targetNode.visited && !targetNode.locked) {
          options.add(targetNode);
        }
      }
    }

    // Fallback: if all adjacent unvisited nodes are cleared, allow traveling to any unlocked neighbor
    if (options.size === 0) {
      for (const e of f.edges) {
        let targetId = null;
        if (e.from === currentNodeId) targetId = e.to;
        else if (e.to === currentNodeId) targetId = e.from;

        if (targetId) {
          const targetNode = f.nodes.find((n) => n.id === targetId);
          if (targetNode && targetNode.id !== currentNodeId && !targetNode.locked) {
            options.add(targetNode);
          }
        }
      }
    }

    return Array.from(options);
  }

  /**
   * Mark a node visited + cleared; unlock 4-directional adjacent neighbors.
   */
  visitNode(floor, nodeId) {
    const f = this.floors[floor];
    const node = f?.nodes.find((n) => n.id === nodeId);
    if (!node) return false;

    node.visited = true;
    node.cleared = true;

    // Unlock all 4-directional connected neighbors
    for (const e of f.edges) {
      let targetId = null;
      if (e.from === nodeId) targetId = e.to;
      else if (e.to === nodeId) targetId = e.from;

      if (targetId) {
        const target = f.nodes.find((n) => n.id === targetId);
        if (target) target.locked = false;
      }
    }

    return true;
  }
}