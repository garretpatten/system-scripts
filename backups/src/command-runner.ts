import { spawn } from 'node:child_process';
import { CommandResult, CommandRunner } from './types.js';

export class ProcessCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf8');
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });

      child.on('error', (error: Error) => {
        reject(error);
      });

      child.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
        // A null exit code means the process was killed by a signal (e.g. an
        // OOM-killed zip or git). Treat that as a failure, not success.
        resolve({
          stdout: stdout.trim(),
          stderr: signal ? `${stderr.trim()} (terminated by ${signal})`.trim() : stderr.trim(),
          exitCode: exitCode ?? 1,
        });
      });
    });
  }
}
