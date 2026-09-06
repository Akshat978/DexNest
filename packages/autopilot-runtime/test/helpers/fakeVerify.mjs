// A deterministic stand-in for a project's typecheck/test/build command.
//
// Reads .verify-state.json from the working directory and exits with the code
// configured for the tier named in argv[2]. Missing tiers pass, so a test only
// has to describe the failures it cares about.
//
// The output deliberately looks like a real test runner: it reports how many
// checks executed. Verification sanity uses that as evidence the command
// actually ran, so a fixture that printed nothing runner-shaped would be
// misclassified as a broken command — which is exactly what a real runner's
// output prevents.
//
// Pass `--silent-failure` to model a command that fails without executing
// anything, which is the configuration-error shape.

import { readFileSync, existsSync } from 'node:fs';

const tier = process.argv[2] ?? 'unknown';
const silent = process.argv.includes('--silent-failure');
const state = existsSync('.verify-state.json') ? JSON.parse(readFileSync('.verify-state.json', 'utf8')) : {};
const code = Number(state[tier] ?? 0);

if (code === 0) {
  console.log(`# tests 3`);
  console.log(`# pass 3`);
  console.log(`# fail 0`);
  console.log(`${tier}: ok`);
} else if (silent) {
  // No execution evidence at all: the shape of a misconfigured command.
  console.error(`${tier}: could not start`);
} else {
  console.log(`# tests 3`);
  console.log(`# pass 2`);
  console.log(`# fail 1`);
  console.error(`not ok 3 - ${tier} check`);
  console.error(`  AssertionError: expected 1 but received 2`);
  console.error(`  at src/example.ts:12:5`);
}
process.exit(code);
