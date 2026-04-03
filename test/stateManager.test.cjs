const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const originalLoad = Module._load;
const originalTsExtension = Module._extensions['.ts'];
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return {};
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

function loadStateManager() {
  const sourcePath = path.join(__dirname, '..', 'src', 'state.ts');
  delete require.cache[sourcePath];
  return require(sourcePath).StateManager;
}

const StateManager = loadStateManager();

class FakeStore {
  constructor() {
    this.state = {
      sessions: {},
      agents: {},
      delegations: {},
      fileEvents: []
    };
  }

  getState() {
    return this.state;
  }

  updateSessions(sessions) {
    this.state.sessions = { ...this.state.sessions, ...sessions };
  }

  updateSession(id, session) {
    if (!this.state.sessions[id]) {
      return;
    }
    this.state.sessions[id] = { ...this.state.sessions[id], ...session };
  }

  updateAgents(agents) {
    this.state.agents = { ...this.state.agents, ...agents };
  }

  updateAgent(id, agent) {
    if (!this.state.agents[id]) {
      return;
    }
    this.state.agents[id] = { ...this.state.agents[id], ...agent };
  }

  updateDelegations(delegations) {
    this.state.delegations = { ...this.state.delegations, ...delegations };
  }

  updateDelegation(id, delegation) {
    if (!this.state.delegations[id]) {
      return;
    }
    this.state.delegations[id] = { ...this.state.delegations[id], ...delegation };
  }

  addFileEvent(event) {
    this.state.fileEvents.push(event);
  }
}

function createStateManager() {
  const store = new FakeStore();
  const manager = new StateManager(store);
  return { manager, store };
}

test('backfills a missing main Claude agent when loading existing session state', () => {
  const { manager, store } = createStateManager();
  store.updateSessions({
    'session-existing': {
      id: 'session-existing',
      tool: 'claude-code',
      cwd: 'C:/Projects/Existing',
      projectName: 'Existing',
      status: 'active',
      startedAt: 123,
      lastActivityAt: 456
    }
  });

  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.agents['session-existing'].id, 'session-existing');
  assert.equal(snapshot.agents['session-existing'].parentAgentId, null);
  assert.equal(snapshot.agents['session-existing'].agentType, 'Claude Code');
});

test('creates an idle Claude session shell on SessionStart and waits for real activity before marking it active', () => {
  const { manager, store } = createStateManager();

  manager.applyEvent({
    hook_event_name: 'SessionStart',
    session_id: 'session-1',
    cwd: 'C:/Projects/Test',
    model: 'claude-sonnet',
    source: 'startup'
  });

  assert.equal(store.getState().sessions['session-1'].projectName, 'Test');
  assert.equal(store.getState().sessions['session-1'].status, 'idle');
  assert.equal(store.getState().agents['session-1'].id, 'session-1');
  assert.equal(store.getState().agents['session-1'].sessionId, 'session-1');
  assert.equal(store.getState().agents['session-1'].parentAgentId, null);
  assert.equal(store.getState().agents['session-1'].agentType, 'Claude Code');
  assert.equal(store.getState().agents['session-1'].status, 'completed');
  assert.equal(
    store.getState().agents['session-1'].startedAt,
    store.getState().sessions['session-1'].startedAt
  );
});

test('links Claude delegations to spawned subagents and uses the final subagent message as result context', () => {
  const { manager, store } = createStateManager();

  manager.applyEvent({
    hook_event_name: 'SessionStart',
    session_id: 'session-2',
    cwd: 'C:/Projects/Test',
    model: 'claude-sonnet',
    source: 'startup'
  });

  manager.applyEvent({
    hook_event_name: 'PreToolUse',
    session_id: 'session-2',
    tool_name: 'Task',
    tool_input: {
      description: 'Review auth flow'
    }
  });

  const [delegationId] = Object.keys(store.getState().delegations);
  assert.ok(delegationId, 'expected a pending delegation to be created');

  manager.applyEvent({
    hook_event_name: 'SubagentStart',
    session_id: 'session-2',
    agent_id: 'agent-1',
    agent_type: 'Explore'
  });

  manager.applyEvent({
    hook_event_name: 'PostToolUse',
    session_id: 'session-2',
    tool_name: 'Task',
    tool_response: 'Task created successfully'
  });

  manager.applyEvent({
    hook_event_name: 'SubagentStop',
    session_id: 'session-2',
    agent_id: 'agent-1',
    last_assistant_message: 'Found two auth issues and suggested fixes.'
  });

  assert.equal(store.getState().agents['agent-1'].parentAgentId, 'session-2');
  assert.equal(store.getState().delegations[delegationId].toAgentId, 'agent-1');
  assert.equal(
    store.getState().delegations[delegationId].result,
    'Found two auth issues and suggested fixes.'
  );
  assert.equal(store.getState().delegations[delegationId].status, 'completed');
});

test('Claude marks the main session active on first tool activity after SessionStart', () => {
  const { manager, store } = createStateManager();

  manager.applyEvent({
    hook_event_name: 'SessionStart',
    session_id: 'session-activity',
    cwd: 'C:/Projects/Test',
    model: 'claude-sonnet',
    source: 'startup'
  });

  manager.applyEvent({
    hook_event_name: 'PreToolUse',
    session_id: 'session-activity',
    tool_name: 'Read',
    tool_input: {
      file_path: 'C:/Projects/Test/README.md'
    }
  });

  assert.equal(store.getState().sessions['session-activity'].status, 'active');
  assert.equal(store.getState().agents['session-activity'].status, 'active');
});

test('Claude does not overwrite the main currentTask on every tool event', () => {
  const { manager, store } = createStateManager();

  manager.applyEvent({
    hook_event_name: 'SessionStart',
    session_id: 'session-3',
    cwd: 'C:/Projects/Test',
    model: 'claude-sonnet',
    source: 'startup'
  });

  store.updateAgent('session-3', {
    currentTask: 'Updating all docs in the codebase'
  });

  manager.applyEvent({
    hook_event_name: 'PreToolUse',
    session_id: 'session-3',
    tool_name: 'Read',
    tool_input: {
      file_path: 'C:/Projects/Test/README.md'
    }
  });

  assert.equal(store.getState().agents['session-3'].currentTask, 'Updating all docs in the codebase');
});

test('Claude subagents inherit a stable currentTask from the delegation prompt', () => {
  const { manager, store } = createStateManager();

  manager.applyEvent({
    hook_event_name: 'SessionStart',
    session_id: 'session-4',
    cwd: 'C:/Projects/Test',
    model: 'claude-sonnet',
    source: 'startup'
  });

  manager.applyEvent({
    hook_event_name: 'PreToolUse',
    session_id: 'session-4',
    tool_name: 'Task',
    tool_input: {
      description: 'write migration tests'
    }
  });

  manager.applyEvent({
    hook_event_name: 'SubagentStart',
    session_id: 'session-4',
    agent_id: 'agent-task',
    agent_type: 'Explore'
  });

  assert.equal(store.getState().agents['agent-task'].currentTask, 'Writing migration tests');
});

test('startup reset downgrades restored Claude and Codex sessions from active to idle', () => {
  const { manager, store } = createStateManager();
  store.updateSessions({
    'claude-session': {
      id: 'claude-session',
      tool: 'claude-code',
      cwd: 'C:/Projects/Claude',
      projectName: 'Claude',
      status: 'active',
      startedAt: 100,
      lastActivityAt: 200
    },
    'codex-session': {
      id: 'codex-session',
      tool: 'codex',
      cwd: 'C:/Projects/Codex',
      projectName: 'Codex',
      status: 'active',
      startedAt: 300,
      lastActivityAt: 400
    },
    'opencode-session': {
      id: 'opencode-session',
      tool: 'opencode',
      cwd: 'C:/Projects/OpenCode',
      projectName: 'OpenCode',
      status: 'active',
      startedAt: 500,
      lastActivityAt: 600
    }
  });

  manager.resetTransientSessionsOnStartup();

  assert.equal(store.getState().sessions['claude-session'].status, 'idle');
  assert.equal(store.getState().sessions['codex-session'].status, 'idle');
  assert.equal(store.getState().sessions['opencode-session'].status, 'active');
});

test.after(() => {
  if (originalTsExtension) {
    Module._extensions['.ts'] = originalTsExtension;
  } else {
    delete Module._extensions['.ts'];
  }
  Module._load = originalLoad;
});
