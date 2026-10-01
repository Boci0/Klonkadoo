// ============================================================
// sim-batch — runs many balance-sim.mjs configurations at once, one per
// CPU core, and prints each result in the order given.
//
//   node tools/sim-batch.mjs batch.txt [--jobs=N] [--grep=REGEX]
//
// batch.txt: one sim call per line, `label | args` (or just args);
// blank lines and lines starting with # are skipped. --grep keeps only
// the matching output lines of each run (default: every line).
//
//   mid R9      | 300 --skill=1 --gear=mid --gearLvl=max --tierUp=3 --risk=9 --draft=new
//   tank R11    | 300 --skill=1 --gear=tankHeal --gearLvl=max --tierUp=3 --mastery=20 --risk=11 --draft=new
// ============================================================

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const file = argv.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node tools/sim-batch.mjs batch.txt [--jobs=N] [--grep=REGEX]');
  process.exit(1);
}
const sim = join(dirname(fileURLToPath(import.meta.url)), 'balance-sim.mjs');
const keep = opt.grep ? new RegExp(opt.grep) : null;
const jobs = Math.max(1, Number(opt.jobs) || Math.max(1, cpus().length - 1));
const tasks = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
  const [label, args] = line.includes('|') ? line.split('|').map((s) => s.trim()) : [line, line];
  return { label, args: args.split(/\s+/).filter(Boolean), out: null };
});

const started = Date.now();
let next = 0;
let printed = 0;
const flush = () => {
  while (printed < tasks.length && tasks[printed].out !== null) {
    const t = tasks[printed++];
    const lines = t.out.split(/\r?\n/).filter((l) => l.trim() && (!keep || keep.test(l)));
    console.log(`${t.label.padEnd(14)} ${lines.join('\n'.padEnd(16))}`);
  }
};
function run() {
  if (next >= tasks.length) return null;
  const t = tasks[next++];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [sim, ...t.args], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => {
      t.out = out;
      flush();
      resolve(run());
    });
  });
}
await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, run));
console.error(`(${tasks.length} runs on ${jobs} cores in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
