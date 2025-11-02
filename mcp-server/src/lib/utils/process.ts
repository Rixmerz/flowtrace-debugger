import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProcessInfo {
  pid: number;
  command: string;
  port?: number;
}

/**
 * Find process by port
 */
export async function findProcessByPort(port: number): Promise<ProcessInfo | null> {
  try {
    // macOS/Linux: lsof -i :PORT
    const { stdout } = await execAsync(`lsof -i :${port} -t`);
    const pid = parseInt(stdout.trim(), 10);

    if (isNaN(pid)) {
      return null;
    }

    // Get process command
    const { stdout: psOut } = await execAsync(`ps -p ${pid} -o command=`);

    return {
      pid,
      command: psOut.trim(),
      port,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Kill process by PID
 */
export async function killProcess(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<boolean> {
  try {
    await execAsync(`kill -${signal} ${pid}`);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if process is running
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    await execAsync(`ps -p ${pid}`);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Find processes by name pattern
 */
export async function findProcessesByPattern(pattern: string): Promise<ProcessInfo[]> {
  try {
    const { stdout } = await execAsync(`ps aux | grep "${pattern}" | grep -v grep`);
    const lines = stdout.trim().split('\n').filter(line => line.length > 0);

    const processes: ProcessInfo[] = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 11) {
        const pid = parseInt(parts[1], 10);
        const command = parts.slice(10).join(' ');

        if (!isNaN(pid)) {
          processes.push({ pid, command });
        }
      }
    }

    return processes;
  } catch (error) {
    return [];
  }
}

/**
 * Check if port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  const process = await findProcessByPort(port);
  return process === null;
}
