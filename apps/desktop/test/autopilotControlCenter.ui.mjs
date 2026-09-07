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
  usage: { totalUsd: 12.5, unreportedTurns: 1, growth: { first: 0.4, last: 3.6, ratio: 9 },
    turns: [{ordinal:1,turnId:'t1',kind:'INITIAL',status:'VERIFIED',costUsd:0.4,cumulativeUsd:0.4,promptChars:4273},
            {ordinal:2,turnId:'t2',kind:'INITIAL',status:'VERIFIED',costUsd:3.6,cumulativeUsd:4.0,promptChars:4400}],
    phases: [{ordinal:1,status:'VERIFIED',summary:'lexer',turns:1,costUsd:0.4},
             {ordinal:2,status:'VERIFIED',summary:'parser',turns:2,costUsd:8.2}] },
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
const notes=[];
const retried={value:false};
let candidateCalls=0;
const attached={value:null};
const primed={sessionId:'aaaaaaaa-1111-4111-8111-111111111111',transcriptPath:'C:/t/a.jsonl',projectPath:'D:/Worktrees/example',origin:'vscode',title:'Notifications architecture',cliVersion:'2.1.261',gitBranch:'main',firstActivity:'2026-09-04T09:00:00Z',lastActivity:'2026-09-04T18:00:00Z',sizeBytes:4096,live:false};
const stillOpen={...primed,sessionId:'bbbbbbbb-2222-4222-8222-222222222222',title:'Still open in the editor',lastActivity:'2026-09-05T11:58:00Z',live:true};

const proposal={value:{id:'dir1',runId:'review-run',turnId:'turn-4',source:'self',verb:'PLAN_COMPLETE',assignment:null,reason:'everything asked for is there',planItemId:null,consumedByTurnId:null,createdAt:'2026-09-05T12:00:00Z'}};
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
__candidateCalls:async()=>candidateCalls,
__retried:async()=>retried.value,
autopilotAttention:async()=>({summary:'1 to send, 1 held.',deliver:[{groupKey:'g1',subject:'review-run',priority:'ACTION_REQUIRED',count:1,headline:'It says the work is done',latest:'Verification passed; a human decides whether the run is done.',outstanding:[]}],hold:[{groupKey:'g2',subject:'review-run',priority:'INFO',count:6,headline:'6 phases completed',latest:'All verification passed.',outstanding:[]}],reason:[{groupKey:'g2',reason:'cooling_down',coolsDownAt:'2026-09-05T13:00:00Z',quietEndsAt:null}]}),
autopilotQueue:async()=>null,
autopilotQueueCreate:async input=>{if(!input.items.length)throw Error('A run queue needs at least one project.');return {id:'q1'};},
autopilotQueueClose:async()=>null,
autopilotSessionCandidates:async()=>(candidateCalls++,attached.value?[]:[{session:primed,blockers:[],attachable:true},{session:stillOpen,blockers:['live'],attachable:false}]),
autopilotAttachedSession:async()=>attached.value,
autopilotAttachSession:async input=>{if(input.sessionId!==primed.sessionId)throw Error('This session was active in the last few minutes');attached.value={runId:input.runId,provider:'claude',sessionId:primed.sessionId,origin:'vscode',title:primed.title,transcriptPath:primed.transcriptPath,attachedAt:'2026-09-05T12:00:00Z'};return attached.value;},
autopilotNotes:async()=>notes, autopilotAddNote:async input=>{const note={id:'n'+(notes.length+1),runId:input.runId,text:input.text,author:'desktop_ui',createdAt:'2026-09-05T12:00:00Z',consumedTurnId:null};notes.push(note);return note;},
autopilotPlanCompleteProposal:async()=>proposal.value,
autopilotAcceptPlanComplete:async()=>{proposal.value=null;},
autopilotRejectPlanComplete:async input=>{if(!input.reason.trim())throw Error('Say what is still missing');proposal.value=null;const note={id:'n0',runId:input.runId,text:input.reason,author:'desktop_ui',createdAt:'2026-09-05T12:00:00Z',consumedTurnId:null};notes.push(note);return note;},
autopilotMorningSummary:async()=>({headline:'It ran out of capacity.',action:'resume',detail:'It is holding with its session and authorization intact, and will not retry by itself.',iterationsDone:1,iterationsAttempted:2,checkpoints:1,assumptions:['Kept the existing API.'],whereToWatch:'D:/Worktrees/example'}),
autopilotLoopRun:async(runId,input)=>{if(!input||input.retryProviderLimit!==true)throw Error('a manual retry must pass retryProviderLimit');retried.value=true;return {reason:'completed'};},
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

// What needs a person, decided by the attention engine and shown on the desktop
// before any phone exists. What is HELD is shown too, with the reason: a quiet
// system must never be a silent one, and the only way to tell quiet from broken
// is to see what is being held back.
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('What needs you')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('It says the work is done')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('needs an answer')"),true,'priority reads as words, not a code');
assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.autopilot-attention > li.attention-action_required').length"),1);
await win.webContents.executeJavaScript("[...document.querySelectorAll('details.autopilot-mechanism')].forEach(d=>{d.open=true})");
await new Promise(r=>setTimeout(r,80));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('6 phases completed')"),true,'held items are visible');
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('already said recently')"),true,'and say why they wait');

// Which phase was expensive, and whether turns are getting dearer. The figure
// is the provider's own and must never be dressed up as a percentage of a plan.
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('$12.50')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('usage proxy on a subscription, not a bill')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('9.0x the first')"),true,'growth is stated, not left to be inferred');
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Dearest phase: 2')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('1 turn(s) reported nothing')"),true,'silence is not counted as free');

// Running out of capacity no longer retries by itself, so the operator needs a
// way to say "it is back". Until this control existed, retryProviderLimit was
// reachable only by the resume timer.
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('will not retry by itself')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='TRY AGAIN NOW').click()");
await new Promise(r=>setTimeout(r,250));
assert.equal(await win.webContents.executeJavaScript("window.dexNest.__retried()"),true,'the button sends the deliberate retry signal');

// Continuing a conversation primed in the editor. A blocked session stays
// visible with its reason: someone hunting for the conversation they just had
// is better served by "close it in your editor" than by its absence.
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Notifications architecture')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Still open somewhere')"),true);
assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.autopilot-sessions > li.session-blocked').length"),1);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('.autopilot-sessions > li')].filter(li=>li.querySelector('button')).length"),1,'only the attachable one is actionable');
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='CONTINUE THIS ONE').click()");
await new Promise(r=>setTimeout(r,250));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Continuing a conversation you started')"),true);
// Refresh must re-read the panels that fetch their own data. Without it an
// operator waiting out a session's ten-minute liveness window presses
// Refresh and nothing ever changes, because runId and working never moved.
const readCalls = async () => win.webContents.executeJavaScript("window.dexNest.__candidateCalls()");
const before = await readCalls();
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh').click()");
await new Promise(r=>setTimeout(r,400));
assert.ok((await readCalls()) > before, 'Refresh re-read the session panel');
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('started in your editor')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent==='CONTINUE THIS ONE')"),false,'adopted, so there is nothing left to choose');

// The morning. A run that says it is finished is asking a question, and both
// answers have to be reachable without leaving DexNest.
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('It says the work is done')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('everything asked for is there')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].some(b=>b.textContent.startsWith('ACCEPT'))"),true);
// Rejecting without saying why would hand back the same evidence that produced
// "I am finished", so the button cannot be pressed until there is a reason.
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('REJECT')).disabled"),true);
const typeInto = (selector,value)=>win.webContents.executeJavaScript("(()=>{const el="+selector+";const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));})()");
await typeInto("document.querySelector('.autopilot-decision textarea')","The error paths have no tests.");
await new Promise(r=>setTimeout(r,80));
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('REJECT')).disabled"),false);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('REJECT')).click()");
await new Promise(r=>setTimeout(r,200));
assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.autopilot-decision').length"),0,'answered, so the question card goes away');
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Waiting to be sent: The error paths have no tests.')"),true);

// And a note written for its own sake, which reaches exactly one prompt.
await typeInto("[...document.querySelectorAll('.card')].find(c=>c.textContent.startsWith('Before it carries on')).querySelector('textarea')","Use the existing logger.");
await new Promise(r=>setTimeout(r,80));
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='SAVE NOTE').click()");
await new Promise(r=>setTimeout(r,200));
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Waiting to be sent: Use the existing logger.')"),true);
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('does not change the goal or the acceptance criteria')"),true);
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
await win.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Queue').click()");
await new Promise(r=>setTimeout(r,150));
assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('section[aria-label=\\"Run Queue\\"]').length"),1,'the Queue area renders');
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Work through several projects tonight')"),true);
// The budget spans the queue, and the page has to say so where it is set.
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('one shared budget')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('START')).disabled"),true,'no projects yet, so nothing to start');
// A queue can come back on its own, which is most of what "run this nightly"
// was supposed to mean. Four forms that obviously work, offered as suggestions.
assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Repeat (optional)')"),true);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('#dexnest-schedules option')].map(o=>o.value).join('|')"),'nightly at 01:00|weekdays at 23:30|weekends at 09:00|mon,thu at 22:00');
await win.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Runs').click()");
await win.webContents.executeJavaScript("(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.parentElement.textContent.startsWith('Filter runs'));s.value='COMPLETED';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
await new Promise(r=>setTimeout(r,100));
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button.event-row')].length"),1);
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button.event-row')][0].textContent.includes('Completed example')"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='New Run').click()");
await win.webContents.executeJavaScript("(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.parentElement.textContent.startsWith('Project'));s.value='project';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
await new Promise(r=>setTimeout(r,100));
// The three questions a person can answer at midnight, and nothing else on
// the primary surface. Everything the form used to ask is still reachable.
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('section[aria-label=\\"New Run\\"] > form > .card > h3')].map(h=>h.textContent).join('|')"),'What should it build?|Where?|When should it stop?');
assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('section[aria-label=\\"New Run\\"] > form > details').length"),1,'one Advanced, not a wall of fields');
// Picking a stop time must not require getting the date right past midnight.
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='At 7am').click()");
await new Promise(r=>setTimeout(r,100));
assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('button.preset-chosen')].map(b=>b.textContent).join()"),'At 7am');
assert.equal(await win.webContents.executeJavaScript("(()=>{const i=[...document.querySelectorAll('input[type=datetime-local]')][0];return i.value.endsWith('07:00');})()"),true);
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='CHECK').click()");
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
