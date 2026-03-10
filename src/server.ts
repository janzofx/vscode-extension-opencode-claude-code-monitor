import * as vscode from 'vscode';
import express from 'express';
import * as http from 'http';
import type { Request, Response } from 'express';
import type { StateManager } from './state';
import type { HookPayload } from './types';

/**
 * Express HTTP Server
 * Listens on localhost:3001 for Claude Code hook POST payloads
 */

export class HookServer {
  private server: http.Server | null = null;
  private stateManager: StateManager;
  private port: number;

  constructor(stateManager: StateManager, port: number) {
    this.stateManager = stateManager;
    this.port = port;
  }

  start(): boolean {
    const app = express();

    // JSON body parser
    app.use((req: any, res: any, next: any) => {
      let data = '';
      req.on('data', (chunk: any) => { data += chunk; });
      req.on('end', () => {
        try {
          req.body = JSON.parse(data);
          next();
        } catch {
          next();
        }
      });
    });

    // Single endpoint for all Claude Code hooks
    app.post('/events', (req: Request, res: Response) => {
      try {
        const payload: HookPayload = req.body;
        console.log('[AgentObservatory] Hook received:', payload.hook_event_name);

        // Apply the event to state
        this.stateManager.applyEvent(payload);

        res.status(200).json({ status: 'ok' });
      } catch (error) {
        console.error('[AgentObservatory] Error processing hook:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Health check endpoint
    app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'healthy' });
    });

    try {
      this.server = app.listen(this.port, '127.0.0.1', () => {
        console.log(`[AgentObservatory] Hook server listening on http://127.0.0.1:${this.port}`);
      });

      // Handle port already in use
      this.server!.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[AgentObservatory] Port ${this.port} is already in use`);
          vscode.window.showWarningMessage(
            `Agent Observatory: Port ${this.port} is in use. ` +
            `Claude Code hooks will not be received. ` +
            `Change the "Agent Observatory: Hooks Port" setting or stop the process using the port.`
          );
        } else {
          console.error('[AgentObservatory] Server error:', error);
        }
      });

      return true;
    } catch (error) {
      console.error('[AgentObservatory] Failed to start hook server:', error);
      vscode.window.showWarningMessage(
        'Agent Observatory: Failed to start hook server. Claude Code hooks will not be received.'
      );
      return false;
    }
  }

  stop(): void {
    if (this.server) {
      this.server.close(() => {
        console.log('[AgentObservatory] Hook server stopped');
      });
      this.server = null;
    }
  }

  updatePort(port: number): boolean {
    if (this.port === port && this.server) {
      return true;
    }

    this.port = port;
    this.stop();
    return this.start();
  }
}
