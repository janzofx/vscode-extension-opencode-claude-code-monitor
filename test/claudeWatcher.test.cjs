const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const originalLoad = Module._load;
const originalTsExtension = Module._extensions['.ts'];
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      Uri: {
        file(fsPath) {
          return { fsPath };
        }
      }
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

Module._extensions['.ts'] = function compileTs(module, filename) {
  const sourceText = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  module._compile(transpiled.outputText, filename);
};

function loadTsModule(relativePath) {
  const sourcePath = path.join(__dirname, '..', relativePath);
  delete require.cache[sourcePath];
  return require(sourcePath);
}

const { ClaudeCodeParser } = loadTsModule(path.join('src', 'parsers', 'claudeCode.ts'));
const { ClaudeCodeWatcher } = loadTsModule(path.join('src', 'watchers', 'claudeCode.ts'));

class FakeStore {
  constructor() {
    this.state = {
      sessions: {},
      delegations: {}
    };
  }

  getState() {
    return this.state;
  }

  updateSessions(sessions) {
    this.state.sessions = { ...this.state.sessions, ...sessions };
  }

  updateDelegations(delegations) {
    this.state.delegations = { ...this.state.delegations, ...delegations };
  }
}

class FakeStateManager {
  constructor() {
    this.refreshCount = 0;
  }

  refreshPanel() {
    this.refreshCount += 1;
  }
}

test('Claude parser uses the latest transcript event as last activity and marks stale sessions idle', () => {
  const startedAt = Date.now() - (3 * 60 * 60 * 1000);
  const lastActivityAt = startedAt + (15 * 60 * 1000);

  const session = ClaudeCodeParser.extractSessionFromJsonl(
    [
      { type: 'assistant', timestamp: startedAt },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: {}, timestamp: startedAt + 1000 },
      { type: 'assistant', timestamp: lastActivityAt }
    ],
    'C:/tmp/session-1.jsonl',
    'C:/Projects/Test'
  );

  assert.equal(session.startedAt, startedAt);
  assert.equal(session.lastActivityAt, lastActivityAt);
  assert.equal(session.status, 'idle');
});

test('Claude watcher keeps stale sessions idle when an old transcript file changes', async () => {
  process.env.USERPROFILE ||= os.tmpdir();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-watcher-test-'));
  const sessionPath = path.join(tempDir, 'session-1.jsonl');
  const startedAt = Date.now() - (4 * 60 * 60 * 1000);
  const lastActivityAt = startedAt + (5 * 60 * 1000);

  fs.writeFileSync(
    sessionPath,
    [
      { type: 'assistant', timestamp: startedAt },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: {}, timestamp: startedAt + 1000 },
      { type: 'assistant', timestamp: lastActivityAt }
    ].map(entry => JSON.stringify(entry)).join('\n')
  );

  const store = new FakeStore();
  store.updateSessions({
    'session-1': {
      id: 'session-1',
      tool: 'claude-code',
      cwd: 'C:/Projects/Real',
      projectName: 'Real',
      status: 'active',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      source: 'startup',
      model: 'claude-sonnet'
    }
  });

  const stateManager = new FakeStateManager();
  const watcher = new ClaudeCodeWatcher(store, stateManager);

  await watcher.handleSessionUpdate({ fsPath: sessionPath });

  assert.equal(store.getState().sessions['session-1'].status, 'idle');
  assert.equal(store.getState().sessions['session-1'].lastActivityAt, lastActivityAt);
  assert.equal(store.getState().sessions['session-1'].cwd, 'C:/Projects/Real');
  assert.equal(store.getState().sessions['session-1'].projectName, 'Real');
  assert.equal(store.getState().sessions['session-1'].source, 'startup');
  assert.equal(store.getState().sessions['session-1'].model, 'claude-sonnet');
  assert.equal(stateManager.refreshCount, 1);
});

test.after(() => {
  if (originalTsExtension) {
    Module._extensions['.ts'] = originalTsExtension;
  } else {
    delete Module._extensions['.ts'];
  }
  Module._load = originalLoad;
});
