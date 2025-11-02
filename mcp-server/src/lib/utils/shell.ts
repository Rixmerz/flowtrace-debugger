import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface SpawnResult {
  pid: number;
  output: string;
  error: string;
  exitCode: number | null;
}

/**
 * Execute shell command and return result
 */
export async function executeCommand(
  command: string,
  cwd: string,
  timeout = 300000 // 5 minutes default
): Promise<ShellResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
      success: true,
    };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || '',
      exitCode: error.code || 1,
      success: false,
    };
  }
}

/**
 * Spawn detached process for long-running applications
 */
export function spawnDetached(
  command: string,
  args: string[],
  cwd: string,
  onOutput?: (data: string) => void,
  onError?: (data: string) => void
): SpawnResult {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let error = '';

  if (child.stdout) {
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (onOutput) onOutput(text);
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (data) => {
      const text = data.toString();
      error += text;
      if (onError) onError(text);
    });
  }

  // Unref to allow parent to exit
  child.unref();

  return {
    pid: child.pid!,
    output,
    error,
    exitCode: null,
  };
}

/**
 * Execute command and monitor output until pattern found or timeout
 */
export async function executeUntilPattern(
  command: string,
  args: string[],
  cwd: string,
  patterns: RegExp[],
  errorPatterns: RegExp[],
  timeoutMs: number
): Promise<{
  success: boolean;
  matchedPattern?: string;
  error?: string;
  output: string;
  pid?: number;
}> {
  return new Promise((resolve) => {
    let output = '';
    let resolved = false;

    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        resolve({
          success: false,
          error: 'Timeout waiting for success pattern',
          output,
        });
      }
    }, timeoutMs);

    const checkPatterns = (data: string) => {
      output += data;

      // Check error patterns first
      for (const pattern of errorPatterns) {
        if (pattern.test(data)) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            child.kill();
            resolve({
              success: false,
              error: `Error pattern matched: ${pattern}`,
              output,
            });
          }
          return;
        }
      }

      // Check success patterns
      for (const pattern of patterns) {
        if (pattern.test(data)) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve({
              success: true,
              matchedPattern: pattern.toString(),
              output,
              pid: child.pid,
            });
          }
          return;
        }
      }
    };

    if (child.stdout) {
      child.stdout.on('data', (data) => checkPatterns(data.toString()));
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => checkPatterns(data.toString()));
    }

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          error: err.message,
          output,
        });
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: code === 0,
          error: code !== 0 ? `Process exited with code ${code}` : undefined,
          output,
        });
      }
    });
  });
}
