import { create } from 'zustand';
import type { DashboardState, ExtensionMessage } from '../types';

/**
 * Zustand Store for Webview
 * Manages the dashboard state and handles messages from extension
 */

interface DashboardStore extends DashboardState {
  // Actions
  handleExtensionMessage: (message: ExtensionMessage) => void;
  selectSession: (sessionId: string | null) => void;
  toggleMute: () => void;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  // Initial state
  sessions: {},
  agents: {},
  delegations: {},
  fileEvents: [],
  selectedSessionId: null,
  connectionStatus: 'disconnected',
  isMuted: false,

  // Handle messages from extension
  handleExtensionMessage: (message: ExtensionMessage) => {
    const state = get();
    console.log('[AgentObservatory Webview] Received message:', message.type, message.payload || 'no payload');

    switch (message.type) {
      case 'INITIAL_STATE':
        set({
          sessions: message.payload.sessions,
          agents: message.payload.agents,
          delegations: message.payload.delegations,
          fileEvents: message.payload.fileEvents,
          connectionStatus: 'connected'
        });
        break;

      case 'SESSION_CREATED':
        set({
          sessions: {
            ...state.sessions,
            [message.payload.id]: message.payload
          }
        });
        break;

      case 'SESSION_UPDATED':
        set({
          sessions: {
            ...state.sessions,
            [message.payload.id]: {
              ...(state.sessions[message.payload.id] as any),
              ...message.payload
            }
          }
        });
        break;

      case 'SESSION_COMPLETED': {
        if (state.sessions[message.payload.id]) {
          set({
            sessions: {
              ...state.sessions,
              [message.payload.id]: {
                ...(state.sessions[message.payload.id] as any),
                status: 'completed',
                completedAt: Date.now()
              }
            }
          });
        }
        // Play session complete sound
        const { isMuted } = get();
        if (!isMuted && document.visibilityState === 'hidden') {
          playSessionCompleteSound();
        }
        break;
      }

      case 'SUBAGENT_CREATED':
        set({
          agents: {
            ...state.agents,
            [message.payload.id]: message.payload
          }
        });
        break;

      case 'SUBAGENT_COMPLETED': {
        if (state.agents[message.payload.id]) {
          set({
            agents: {
              ...state.agents,
              [message.payload.id]: {
                ...(state.agents[message.payload.id] as any),
                status: 'completed',
                completedAt: Date.now()
              }
            }
          });
        }
        // Play subagent complete sound
        const { isMuted } = get();
        if (!isMuted && document.visibilityState === 'hidden') {
          playSubagentCompleteSound();
        }
        break;
      }

      case 'DELEGATION_STARTED':
        set({
          delegations: {
            ...state.delegations,
            [message.payload.id]: message.payload
          }
        });
        break;

      case 'DELEGATION_COMPLETED':
        if (state.delegations[message.payload.id]) {
          set({
            delegations: {
              ...state.delegations,
              [message.payload.id]: message.payload
            }
          });
        }
        break;

      case 'FILE_ACTIVITY':
        set({
          fileEvents: [...state.fileEvents, message.payload]
        });
        break;

      case 'CURRENT_TASK':
        if (state.agents[message.payload.agentId]) {
          set({
            agents: {
              ...state.agents,
              [message.payload.agentId]: {
                ...(state.agents[message.payload.agentId] as any),
                currentTask: message.payload.task
              }
            }
          });
        }
        break;

      case 'NOTIFICATION': {
        // Trigger audio notification if not muted
        const { isMuted: notificationMuted } = get();
        if (!notificationMuted && document.visibilityState === 'hidden') {
          playNotificationSound();
        }
        break;
      }
    }
  },

  selectSession: (sessionId: string | null) => {
    set({ selectedSessionId: sessionId });
  },

  toggleMute: () => {
    set({ isMuted: !get().isMuted });
  }
}));

/**
 * Play a notification sound using Web Audio API
 * Used for Claude needing user attention
 */
function playNotificationSound(): void {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Urgent ping - higher frequency
    oscillator.frequency.value = 1000;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1;

    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.15);
    oscillator.stop(audioContext.currentTime + 0.15);
  } catch (error) {
    console.error('Failed to play notification sound:', error);
  }
}

/**
 * Play a soft chime for subagent completion
 */
function playSubagentCompleteSound(): void {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Soft chime - two tones
    oscillator.frequency.value = 600;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.08;

    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.3);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (error) {
    console.error('Failed to play subagent complete sound:', error);
  }
}

/**
 * Play a completion sound for session completion
 */
function playSessionCompleteSound(): void {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Distinct completion sound - descending tone
    oscillator.frequency.value = 800;
    oscillator.type = 'triangle';
    gainNode.gain.value = 0.1;

    oscillator.start();

    // Sweep from 800Hz down to 400Hz
    oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.4);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (error) {
    console.error('Failed to play session complete sound:', error);
  }
}
