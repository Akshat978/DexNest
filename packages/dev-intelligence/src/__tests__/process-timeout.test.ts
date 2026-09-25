import { describe, it, expect } from 'vitest';
import { LocalProcessRunner } from '../domain/local-process-runner.js';

describe('subprocess timeout (Phase 2 carry-over)', () => {
  it('kills hung/slow command at timeoutMs; result TIMEOUT; output bounded', async () => {
    const runner = new LocalProcessRunner();
    const maxOut = 64;
    const result = await runner.run({
      cwd: process.cwd(),
      domain: 'wsl',
      argv: [
        'node',
        '-e',
        // Print a burst then hang past timeout
        `process.stdout.write('x'.repeat(10_000)); setTimeout(() => {}, 30_000);`,
      ],
      timeoutMs: 400,
      maxStdoutBytes: maxOut,
      maxStderrBytes: maxOut,
    });

    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(maxOut);
    expect(result.durationMs).toBeGreaterThanOrEqual(300);
    expect(result.durationMs).toBeLessThan(10_000);
  });
});
