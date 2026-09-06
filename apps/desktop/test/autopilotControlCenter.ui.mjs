// Isolated Electron renderer test. Never loads DexNest main or a real data root.
import { build } from "../node_modules/vite/dist/node/index.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "dexnest-center-ui-"));
const now = "2026-09-05T12:00:00Z";
const spec = { goal: "Review the requested change", projectPath: "D:/Example", workers: { primary: "claude", consultant: "codex", sticky: true }, capabilities: { workspaceRoot: "D:/Worktrees/example" }, failurePolicy: { maxConsecutiveFailures: 3 } };
const run = { id: "review-run", goal: spec.goal, state: "NEEDS_REVIEW", spec, createdAt: now, updatedAt: now, reconcileReason: "A send requires human resolution." };
const report = { schemaVersion: 3, generatedAt: now, run, spec, provider: { id: "claude", workspaceRoot: spec.capabilities.workspaceRoot },
  execution: { consecutiveFailures: 0, failureLimit: 3 },
  primaryProgress: { status: "STALLED", reason: "equivalent_verification_without_change", consecutiveStalled: 3, consultantRecommended: true },
  consultations: [{ id: "consult1", runId: run.id, primaryProvider: "claude", consultantProvider: "codex", triggerType: "OPERATOR", triggerReason: "equivalent_verification_without_change", status: "RECOMMENDED", canApprove: true, canCancel: true, executionEligible: false,
    preview: { goal: spec.goal, constraints: ["Keep APIs stable"], acceptanceCriteria: ["Tests pass"], triggeringTurn: 4, failingTier: "test", failureSummary: "FAILED: test; exit 1", changedPaths: ["src/example.ts"], latestCheckpoint: null, contextRequests: [] } }],
  roles: { primary: { role: "PRIMARY", provider: "claude", sessionId: "sticky-primary", providerSessionId: null, established: true, restored: true }, consultant: { provider: "codex", sessionId: null } },
  consultantSessions: [], diagnoses: [],
  workerDiagnostics: [{ id: "diag1", runId: run.id, operationId: "op-9", provider: "claude", role: "PRIMARY",
    category: "input_protocol", exitCode: 1, signal: null,
    stderrTail: "Error: Input must be provided either through stdin or as a prompt argument when using --print",
    stdoutTail: "", stderrBytes: 40000, stdoutBytes: 0, stderrTruncated: true, stdoutTruncated: false, createdAt: now, categoryLabel: "input/protocol error" }],
  loop: { turns: [], grants: [] }, checkpoints: [], workspace: { headSha: "abcdef123456", changedFiles: 1, capturedAt: now },
  humanActions: { interventionCount: 1 }, deniedOperations: [], acceptanceCriteria: [], eventCount: 3,
  outcome: { classification: "needs_review", reason: "Uncertain send" }, activity: [{ id: "a", label: "Context requested", at: now }],
  contextRequests: [{ id: "r", path: "src/example.ts", requestedTurnOrdinal: 1, status: "PENDING", bytesSupplied: 0, bytesUnit: "utf8_bytes", consumedTurnId: null, availabilityReason: "Not included in the prior context." }] };
const snapshot = { run, steps: [], events: [], operations: [], pendingApprovals: [],
  worker: { session: null, busy: false, resolutions: [], sends: [{ id: "send1", status: "UNCERTAIN", prompt: "PRIVATE_PROMPT_SENTINEL", operationId: "op1", result: null }] },
  loop: { grant: null, grants: [], turns: [], verifications: [], busy: false },
  consultationRequest: { eligible: true, reason: null, busy: false },
  recovery: { version: 1, runId: run.id, action: "RECOMMEND_HANDOFF", reason: "stalled_after_consultant_assisted_retry",
    summary: "Claude is still stuck after acting on a Codex diagnosis. Codex is available locally; usage/quota is unknown until a provider call.",
    currentPrimary: "claude", alternateProvider: "codex",
    evidence: { runState: "NEEDS_REVIEW", progressStatus: "STALLED", progressReason: "equivalent_verification_without_change",
      latestTurnId: "turn-4", latestTurnOrdinal: 4, verification: "FAILED", workerFailure: null, uncertainSendId: null,
      consultationId: null, consultationStatus: null, diagnosisId: "d1", diagnosisSuppliedToTurnId: "turn-4",
      handoffId: null, handoffStatus: null, grantStatus: "EXHAUSTED", grantTurnsRemaining: 0 },
    alternatePreflight: { provider: "codex", executableConfigured: true, executableFound: true, availableLocally: true, quota: "unknown_until_provider_call" },
    createdAt: now, fingerprint: "rec-abcd1234" },
  handoff: { currentPrimary: "claude", ownership: [{ id: "own1", runId: run.id, ordinal: 1, provider: "claude", role: "PRIMARY", sessionId: "sticky-primary", providerSessionId: null, cwd: spec.capabilities.workspaceRoot, established: true, status: "ACTIVE", handoffId: null, startedAt: now, retiredAt: null }],
    handoffs: [], open: null, eligibility: { eligible: true, reason: null, target: "codex" },
    recommendation: { recommended: true, reason: "PRIMARY remains stalled after a consultant diagnosis was supplied and retried." },
    preflight: { provider: "codex", executableConfigured: true, executableFound: true, availableLocally: true, quota: "unknown_until_provider_call" } } };
const dashboard = [{ id: run.id, goal: run.goal, project: spec.projectPath, primary: "claude", consultant: "codex", state: run.state, category: "NEEDS ATTENTION", attention: true, turn: 1, maxTurns: 3, consumed: 1, createdAt: now, updatedAt: now, latestVerification: null },
  { id: "completed-run", goal: "Completed example", project: spec.projectPath, primary: "codex", consultant: null, state: "COMPLETED", category: "COMPLETED", attention: false, turn: 2, maxTurns: 3, consumed: 2, createdAt: now, updatedAt: now, latestVerification: "PASSED" }];
writeFileSync(join(scratch, "index.html"), '<html><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
const view = resolve(desktop, "src/renderer/views/AutopilotView.tsx").replaceAll("\\", "/");
const css = resolve(desktop, "src/renderer/styles.css").replaceAll("\\", "/");
const tokens = resolve(desktop, "../../packages/shared-ui/src/tokens.css").replaceAll("\\", "/");
writeFileSync(join(scratch, "entry.tsx"), `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AutopilotView} from ${JSON.stringify(view)}; import ${JSON.stringify(tokens)}; import ${JSON.stringify(css)}; createRoot(document.getElementById('root')).render(<main style={{padding:24,maxWidth:1200,margin:'auto'}}><AutopilotView/></main>);`);
writeFileSync(join(scratch, "preload.cjs"), `const {contextBridge}=require('electron'); const report=${JSON.stringify(report)}, snapshot=${JSON.stringify(snapshot)}, dashboard=${JSON.stringify(dashboard)};
contextBridge.exposeInMainWorld('dexNest', {
autopilotDashboard: async()=>dashboard, autopilotGetRun: async()=>snapshot, autopilotReport:async()=>JSON.parse(JSON.stringify(report)),
autopilotApproveConsultation:async scope=>{if(scope.runId!=='review-run'||scope.requestId!=='consult1'||scope.consultantProvider!=='codex')throw Error('Wrong scope');Object.assign(report.consultations[0],{status:'APPROVED',canApprove:false,executionEligible:true});},
autopilotHandoffPropose:async input=>{if(input.toProvider!=='codex')throw Error('Wrong target');
 snapshot.handoff.open={id:'handoff1',runId:'review-run',source:'OPERATOR',fromProvider:'claude',toProvider:'codex',reason:'operator_requested_handoff',status:'PROPOSED',packageFingerprint:'hp-abcd1234',specFingerprint:'fp',workspaceRoot:'D:/Worktrees/example',fromSessionId:'sticky-primary',toSessionId:null,approvalSource:null,proposedAt:'2026-09-05T12:00:00Z',approvedAt:null,activatingAt:null,activatedAt:null,resolvedAt:null,resolutionSource:null,failure:null,fresh:true,canApprove:true,canCancel:true,canActivate:false,
  package:{version:1,goal:'Review the requested change',constraints:[],nonGoals:[],acceptanceCriteria:[],fromProvider:'claude',toProvider:'codex',fromSessionId:'sticky-primary',runState:'NEEDS_REVIEW',progress:{status:'STALLED',reason:'equivalent_verification_without_change'},latestVerification:{outcome:'FAILED',summary:'FAILED: test',failingTier:'test',exitCode:1},attempts:[],changedPaths:['src/example.ts'],workspace:{root:'D:/Worktrees/example',headSha:'abcdef',status:'',changedFiles:1},latestCheckpoint:null,consultantDiagnosis:null,openContextRequests:[],doNotChange:['The acceptance criteria.'],specFingerprint:'fp'}};
 snapshot.handoff.eligibility={eligible:false,reason:'handoff_already_open',target:null};},
autopilotHandoffApprove:async()=>{Object.assign(snapshot.handoff.open,{status:'APPROVED',canApprove:false,canActivate:true,approvalSource:'desktop_ui'});},
autopilotHandoffCancel:async()=>{},
autopilotHandoffActivate:async()=>{},
autopilotConsultationRequest:async input=>{if(input.runId!=='review-run'||input.consultantProvider!=='codex')throw Error('Wrong scope');snapshot.consultationRequest={eligible:false,reason:'consultation_already_active',busy:false};},
autopilotConsultationRun:async scope=>{if(scope.requestId!=='consult1'||scope.consultantProvider!=='codex')throw Error('Wrong scope');
 report.consultantSessions=[{id:'cs1',runId:'review-run',role:'CONSULTANT',provider:'codex',sessionId:'consultant-session',providerSessionId:null,cwd:'D:/Worktrees/example',established:true,disabledMcpServers:[],createdAt:'2026-09-05T12:00:00Z'}];
 report.diagnoses=[{id:'d1',runId:'review-run',consultationId:'consult1',consultantProvider:'codex',consultantSessionId:'consultant-session',providerSessionId:null,status:'COMPLETED',operationId:'op2',promptLength:900,diagnosis:'ROOT CAUSE. The guard is inverted.',outputLength:38,outputFingerprint:'diag-0001',failure:null,refusedFileBlocks:1,suppliedToTurnId:null,startedAt:'2026-09-05T12:00:00Z',completedAt:'2026-09-05T12:00:00Z'}];
 return report.diagnoses[0];},
autopilotCancelConsultation:async()=>{Object.assign(report.consultations[0],{status:'CANCELLED',canApprove:false,canCancel:false,executionEligible:false});},
autopilotActivity:async()=>[{id:'e1',kind:'tool',text:'Read src/example.ts',at:'2026-09-05T12:00:00Z'}],
autopilotMorningSummary:async()=>({headline:'It stopped getting anywhere.',action:'review',detail:'Nothing passed verification for several turns in a row.',iterationsDone:1,iterationsAttempted:2,checkpoints:1,assumptions:['Kept the existing API.'],whereToWatch:'D:/Worktrees/example'}),
listProjects:async()=>[{id:'project',name:'Example project',path:'D:/Example'}], onAutopilotChanged:()=>()=>{},
autopilotReadiness:async()=>[{provider:'claude',installed:true,authenticated:true,available:true,failure:null},{provider:'codex',installed:true,authenticated:false,available:false,failure:'auth'}],
chooseToolsOutputFolder:async()=>({ok:true,path:'D:/Example'})
});`);
await build({ configFile: false, root: scratch, base: "./", css: { postcss: { plugins: [] } }, resolve: { alias: { react: resolve(desktop, "node_modules/react"), "react-dom": resolve(desktop, "node_modules/react-dom") } }, build: { outDir: join(scratch, "dist"), emptyOutDir: true } });
writeFileSync(join(scratch, "main.cjs"), `const {app,BrowserWindow}=require('electron'); const fs=require('node:fs'); const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(scratch, "electron-data"))}); app.disableHardwareAcceleration();
app.whenReady().then(async()=>{ const win=new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{preload:${JSON.stringify(join(scratch,"preload.cjs"))},contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
await win.loadFile(${JSON.stringify(join(scratch,"dist/index.html"))});
for(let n=0;n<100;n++){if(await win.webContents.executeJavaScript("document.body.innerText.includes('Completed example')"))break;await new Promise(r=>setTimeout(r,30));}
await win.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Selected Run').click()");
await new Promise(r=>setTimeout(r,100));
await win.webContents.executeJavaScript("[...document.querySelectorAll('details.autopilot-mechanism')].forEach(d=>{d.open=true})");
await new Promise(r=>setTimeout(r,100));
assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('section[aria-label=\\"New Run\\"]').length"),1);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('PRIVATE_PROMPT_SENTINEL')"),false);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('src/example.ts')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Consultant recommended: Codex')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Trigger: Operator requested')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('section[aria-label]')].filter(s=>s.getAttribute('aria-label')==='Ownership').length"),1);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Current PRIMARY: Claude')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('section[aria-label]')].filter(s=>s.getAttribute('aria-label')==='Recovery').length"),1);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Current recommendation: Handoff from Claude to Codex')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Reason: stalled_after_consultant_assisted_retry')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('usage/quota unknown until a provider call')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Handoff recommended:')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('usage/quota unknown until a provider call')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='REQUEST HANDOFF').click()");
await new Promise(r=>setTimeout(r,150));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Handoff proposed')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Proposed new PRIMARY: Codex')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='ACTIVATE HANDOFF')"),false);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='APPROVE HANDOFF').click()");
await new Promise(r=>setTimeout(r,150));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Handoff approved')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('previous PRIMARY will no longer be allowed to modify this run')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='ACTIVATE HANDOFF')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='REQUEST SECOND OPINION')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='REQUEST SECOND OPINION').click()");
await new Promise(r=>setTimeout(r,150));
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='REQUEST SECOND OPINION')"),false);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Unavailable: Consultation already active')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Read-only consultation preview')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='APPROVE CONSULTATION').click()");
await new Promise(r=>setTimeout(r,100));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Consultation approved')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Waiting for consultant execution')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='APPROVE CONSULTATION')"),false);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='RUN DIAGNOSIS')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='RUN DIAGNOSIS').click()");
await new Promise(r=>setTimeout(r,500));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Diagnosis complete')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Diagnosis will be supplied to the same Claude PRIMARY session on retry.')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('read-only advisor')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('1 file change block(s) returned by the consultant were refused')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='RUN DIAGNOSIS')"),false);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='CANCEL').click()");
await new Promise(r=>setTimeout(r,100));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Consultation cancelled')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='CANCEL')"),false);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('section')].filter(s=>s.querySelector('h3')&&s.querySelector('h3').textContent==='Provider failure').length"),1);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Provider: Claude (worker)')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Category: input/protocol error')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Exit code: 1')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('showing the tail')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('section')].filter(s=>s.querySelector('h3')&&s.querySelector('h3').textContent==='Provider failure').flatMap(s=>[...s.querySelectorAll('details')]).every(d=>!d.open)"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Input must be provided')"),false);
await win.webContents.executeJavaScript("[...document.querySelectorAll('section')].filter(s=>s.querySelector('h3')&&s.querySelector('h3').textContent==='Provider failure')[0].querySelector('details').open=true");
await new Promise(r=>setTimeout(r,80));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Input must be provided')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Runs').click()");
await win.webContents.executeJavaScript("(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.parentElement.textContent.startsWith('Filter runs'));s.value='COMPLETED';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
await new Promise(r=>setTimeout(r,100));
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button.event-row')].length"),1);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button.event-row')][0].textContent.includes('Completed example')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='New Run').click()");
await win.webContents.executeJavaScript("(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.parentElement.textContent.startsWith('Dev project'));s.value='project';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
await new Promise(r=>setTimeout(r,100));
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh provider readiness').click()");
await new Promise(r=>setTimeout(r,100));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('unavailable: auth')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Selected Run').click()");
await new Promise(r=>setTimeout(r,100));
assert.equal(errors.length,0,errors.join('\\n'));
fs.writeFileSync(${JSON.stringify(join(scratch,"control-center.png"))},(await win.webContents.capturePage()).toPNG());
console.log('CONTROL_CENTER_UI_PASS '+${JSON.stringify(join(scratch,"control-center.png"))});app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});`);
const childEnv = { ...process.env, DEXNEST_DATA_ROOT: join(scratch, "data") };
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawnSync(process.execPath, [resolve(desktop, "node_modules/electron/cli.js"), join(scratch, "main.cjs")], {
  encoding: "utf8", timeout: 45000, windowsHide: true, env: childEnv
});
process.stdout.write(child.stdout ?? ""); process.stderr.write(child.stderr ?? "");
process.exitCode = child.status ?? 1;
