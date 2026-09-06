// A real, local process speaking the bounded subset of Claude's JSON CLI protocol.
// Never calls a model or reads user auth. All files stay in the test worktree.
import { readFileSync, writeFileSync, existsSync, appendFileSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.207 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') {
  console.log(existsSync('.fake-auth') ? readFileSync('.fake-auth', 'utf8') : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }));
  process.exit(0);
}
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const resume = args.includes('--resume');
const sessionId = args[args.indexOf(resume ? '--resume' : '--session-id') + 1];
const file = `.fake-session-${sessionId}.json`;
if (resume && !existsSync(file)) { console.error('No conversation found with session ID'); process.exit(1); }
appendFileSync('.fake-dispatches', `${JSON.stringify({ sessionId, resume, prompt, cwd: process.cwd(), apiKeyPresent: Object.keys(process.env).some(k => k.toUpperCase() === 'ANTHROPIC_API_KEY') })}\n`);
writeFileSync(file, JSON.stringify({ sessionId }));
if (prompt === '__block__') {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  writeFileSync('.fake-tree', JSON.stringify({ parent: process.pid, child: child.pid }));
  setInterval(() => {}, 1000);
} else if (prompt.includes('__diag__')) {
  // Emits exactly what .fake-diag.json asks for, on the requested streams, and
  // fails. writeSync so large output is flushed before exit.
  const spec = existsSync('.fake-diag.json') ? JSON.parse(readFileSync('.fake-diag.json', 'utf8')) : {};
  if (spec.stdout) writeSync(1, spec.stdout);
  if (spec.stderr) writeSync(2, spec.stderr);
  process.exitCode = spec.exitCode ?? 1;
} else if (prompt === '__quota__' || prompt === '__auth__') {
  console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true,
    session_id: sessionId, errors: [prompt === '__quota__' ? 'Usage limit reached' : 'Authentication failed'] }));
  process.exitCode = 1;
} else if (prompt === '__truncated__') {
  console.log('{"type":"result",');
} else {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: `Received ${prompt}` }));
}
