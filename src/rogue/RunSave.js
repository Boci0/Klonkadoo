// ============================================================
// RunSave — suspend / resume for the run in progress.
//
// Android kills background apps freely, so the run is written to
// localStorage at every safe point (back on the map, a fight
// starting, a fight's rewards paid out). The snapshot is plain JSON:
// run stats, the map's floors, the quests, and what to do on resume
// (`resume`: 'map' | 'battle' | 'combat' | 'minigame' | 'descend').
// ============================================================

import { RunState } from './RunState.js';
import { RogueMap } from './RogueMap.js';
import { getBall } from '../meta/Balls.js';

const KEY = 'slingshot-run-v1';
const VERSION = 1;

// Live references that must not be written (rebuilt on load)
const SKIP = new Set(['ball', 'questSystem', 'currentNode']);

function findNode(floors, id) {
  for (const f of floors) {
    const n = f?.nodes?.find((x) => x.id === id);
    if (n) return n;
  }
  return null;
}

/**
 * @param {object} s - { run, map, quests, runSeed, currentFloorView, lostAnyCombat, resume, node?, prevId?, pendingBoonId?, descend? }
 */
export function writeRun(s) {
  try {
    const run = {};
    for (const [k, v] of Object.entries(s.run)) if (!SKIP.has(k)) run[k] = v;
    // A node that isn't on the map (forced mini-boss / boss) is stored whole
    const cur = s.run.currentNode;
    if (cur && !findNode(s.map.floors, cur.id)) run.syntheticNode = cur;
    const snap = {
      v: VERSION,
      savedAt: Date.now(),
      runSeed: s.runSeed,
      currentFloorView: s.currentFloorView,
      lostAnyCombat: !!s.lostAnyCombat,
      run,
      floors: s.map.floors.map(({ nodeGrid, ...f }) => f),
      quests: s.quests,
      resume: s.resume || 'map',
      node: s.node || null,
      prevId: s.prevId ?? null,
      pendingBoonId: s.pendingBoonId || null,
      descend: s.descend || null,
    };
    localStorage.setItem(KEY, JSON.stringify(snap));
    return true;
  } catch (e) {
    console.warn('Run save failed:', e);
    return false;
  }
}

/** Update only the quest list of the stored run (quest TP is paid the moment it completes). */
export function patchRunQuests(quests) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const snap = JSON.parse(raw);
    snap.quests = quests;
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch (_) {}
}

export function hasSavedRun() {
  try {
    return !!localStorage.getItem(KEY);
  } catch (_) {
    return false;
  }
}

/** Short summary for the menu button, or null. */
export function savedRunInfo() {
  try {
    const snap = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!snap?.run) return null;
    return { ballType: snap.run.ballType, floor: snap.run.floor, risk: snap.run.risk || 0 };
  } catch (_) {
    return null;
  }
}

export function clearRun() {
  try {
    localStorage.removeItem(KEY);
  } catch (_) {}
}

/**
 * Rebuild live objects from the stored run.
 * @returns {null | { run, map, quests, runSeed, currentFloorView, lostAnyCombat, resume, node, prevNode, pendingBoonId, descend }}
 */
export function readRun() {
  let snap;
  try {
    snap = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (_) {
    return null;
  }
  if (!snap || snap.v !== VERSION || !snap.run || !Array.isArray(snap.floors)) return null;

  const map = new RogueMap(snap.runSeed);
  map.floors = snap.floors.map((f) => {
    const nodeGrid = Array.from({ length: f.rows }, () => new Array(f.cols).fill(null));
    for (const n of f.nodes) {
      if (n.type === 'shrine') n.type = 'treasure'; // Curse Shrines were retired with relics
      if (nodeGrid[n.row]) nodeGrid[n.row][n.col] = n;
    }
    return { ...f, nodeGrid };
  });

  const { syntheticNode, ...data } = snap.run;
  const run = new RunState(data.permanent || {}, data.ballType);
  Object.assign(run, data);
  // Relics and curses were retired: runs saved with them just drop them
  delete run.relics;
  delete run.curses;
  run.ballType = 'operator'; // runs saved on a retired class continue as the operator
  run.ball = getBall(run.ballType);
  run.currentNode = findNode(map.floors, run.currentNodeId) || syntheticNode || null;

  // The fight to restart: the same object the map holds, so clearing it marks the tile
  let node = null;
  if (snap.node) node = snap.node.id === run.currentNode?.id ? run.currentNode : findNode(map.floors, snap.node.id) || snap.node;
  return {
    run,
    map,
    quests: snap.quests || [],
    runSeed: snap.runSeed,
    currentFloorView: snap.currentFloorView ?? run.floor,
    lostAnyCombat: !!snap.lostAnyCombat,
    resume: snap.resume,
    node,
    prevNode: snap.prevId ? findNode(map.floors, snap.prevId) : null,
    prevId: snap.prevId,
    pendingBoonId: snap.pendingBoonId,
    descend: snap.descend,
  };
}
