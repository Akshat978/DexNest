// A local stand-in for a coding worker CLI, used by the autonomous loop tests.
//
// It never contacts a model and never reads user credentials. It speaks the same
// bounded JSON subset as fakeClaude.mjs, and additionally "does work": each
// dispatch applies the next entry of .loop-plan.json to .verify-state.json, so a
// scripted sequence of failing-then-passing verification can be driven
// deterministically.
//
// Two work modes:
//   emitFiles present -> return file contents as TEXT for DexNest to write.
//                        This is the production path; the real CLI runs with
//                        `--tools ""` and cannot touch a file itself.
//   emitFiles absent  -> write directly, which only models a tool-enabled
//                        worker and is kept for the older loop tests.
//
// Kept separate from fakeClaude.mjs so the existing worker tests are untouched.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.207 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

const resume = args.includes('--resume');
const sessionId = args[args.indexOf(resume ? '--resume' : '--session-id') + 1];
const sessionFile = `.fake-session-${sessionId}.json`;
if (resume && !existsSync(sessionFile)) { console.error('No conversation found with session ID'); process.exit(1); }
writeFileSync(sessionFile, JSON.stringify({ sessionId }));

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

const dispatches = readJson('.loop-dispatches.json', []);
const index = dispatches.length;
dispatches.push({ index, sessionId, resume, prompt, cwd: process.cwd() });
writeFileSync('.loop-dispatches.json', JSON.stringify(dispatches, null, 2));

// Apply this turn's scripted effect on the workspace.
const plan = readJson('.loop-plan.json', []);
const step = plan[index] ?? plan[plan.length - 1] ?? {};

if (step.verify) writeFileSync('.verify-state.json', JSON.stringify(step.verify));

const emitted = Array.isArray(step.emitFiles) ? step.emitFiles : null;
if (!emitted) {
  // Direct write: a real edit, so `git status --porcelain` reports changes.
  writeFileSync(`work-${index}.txt`, `turn ${index}\n`);
}

// Paths this turn asks DexNest to include next time.
const requests = Array.isArray(step.requestFiles)
  ? step.requestFiles.map((path) => `<<<DEXNEST_REQUEST path="${path}">>>`).join('\n')
  : '';

const blocks = emitted
  ? emitted
      .map((file) => `<<<DEXNEST_FILE path="${file.path}">>>\n${file.contents}\n<<<END_DEXNEST_FILE>>>`)
      .join('\n')
  : '';

// Terminal provider errors the real CLIs report, so the classifier sees the
// same wording it would see in production.
const TERMINAL_ERRORS = {
  quota: 'Usage limit reached',
  auth: 'Authentication failed: not logged in',
  session: 'No conversation found with session ID',
  process: 'Internal error while executing the request'
};
if (TERMINAL_ERRORS[step.workerFailure]) {
  console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true,
    session_id: sessionId, errors: [TERMINAL_ERRORS[step.workerFailure]] }));
  process.exitCode = 1;
} else if (step.workerFailure === 'truncated') {
  console.log('{"type":"result",');
} else if (step.hang) {
  setInterval(() => {}, 1000);
} else {
  const parts = [];
  if (requests) parts.push(`I need to see more of the project first.\n\n${requests}`);
  if (emitted) {
    parts.push(blocks ? `Here are the updated files.\n\n${blocks}` : 'I looked at the code but made no changes.');
  }
  if (parts.length === 0) parts.push(`Applied turn ${index}`);
  // Trailing free text, e.g. a self-direction decision block, appended exactly
  // as a real worker would end its reply.
  if (typeof step.say === 'string' && step.say) parts.push(step.say);
  const body = parts.join('\n\n');
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: body }));
}
