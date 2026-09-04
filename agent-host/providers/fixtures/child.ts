/**
 * ORCH-3B deterministic child fixture. Spawned via `process.execPath` from
 * tests. The mode is selected by `--mode <name>` (and optional `--arg <value>`
 * or env vars). No external dependencies; Node built-ins only.
 *
 * Modes:
 *   echo        Read all stdin, write it back to stdout verbatim, exit 0.
 *   args        Write JSON.stringify(process.argv.slice(4)) to stdout, exit 0.
 *               (argv after --mode args --arg <value>)
 *   stderr      Write benign noise to stderr, exit 0.
 *   nonzero     Exit with code 7.
 *   hang        Keep alive forever (never exit). For timeout tests.
 *   grandchild  Spawn a hanging descendant that inherits stdio, then hang.
 *   idle        Write one line, then keep alive forever. For idle timeout.
 *   longout     Write --arg bytes of 'x' in 16 KiB chunks, exit 0.
 *   ignore      Ignore stdin close; keep alive with an interval. For
 *               force-kill tests (survives past the cancel grace period).
 *   slow        Exit 0 after --arg ms.
 *   jsonl       Emit a small JSONL sequence to stdout, exit 0.
 */

import { spawn } from 'node:child_process';

function argValue(name: string): string | undefined {
  const argv = process.argv;
  const idx = argv.indexOf(name);
  if (idx === -1 || idx + 1 >= argv.length) {
    return undefined;
  }
  return argv[idx + 1];
}

const mode = argValue('--mode') ?? 'echo';

async function readAllStdin(): Promise<string> {
  return await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    // If stdin is never ended, never resolve; caller controls that.
  });
}

function main(): void {
  switch (mode) {
    case 'echo': {
      void readAllStdin().then((data) => {
        process.stdout.write(data);
        process.exit(0);
      });
      break;
    }
    case 'args': {
      // process.argv = [node, fixture, --mode, args, ...capturedArgs]
      const rest = process.argv.slice(4);
      process.stdout.write(JSON.stringify(rest));
      process.exit(0);
      break;
    }
    case 'stderr': {
      const bytes = Number.parseInt(argValue('--arg') ?? '0', 10);
      if (bytes > 0) {
        const chunk = 'e'.repeat(16 * 1024);
        let written = 0;
        const writeNext = (): void => {
          while (written < bytes) {
            const remaining = bytes - written;
            const slice = remaining < chunk.length ? chunk.slice(0, remaining) : chunk;
            if (process.stderr.write(slice)) {
              written += slice.length;
            } else {
              process.stderr.once('drain', () => {
                written += slice.length;
                writeNext();
              });
              return;
            }
          }
          process.stderr.end(() => process.exit(0));
        };
        writeNext();
      } else {
        process.stderr.write('benign stderr noise\n');
        process.exit(0);
      }
      break;
    }
    case 'nonzero': {
      process.exit(7);
      break;
    }
    case 'hang': {
      // Keep the event loop alive indefinitely (ref'd so the child does NOT
      // exit on its own; only a force-kill ends it).
      setInterval(() => undefined, 60_000);
      break;
    }
    case 'grandchild': {
      // The descendant inherits these pipes, reproducing the Windows case
      // where the direct child's close event can be delayed after tree kill.
      const descendant = spawn(process.execPath, [process.argv[1], '--mode', 'hang'], {
        stdio: 'inherit',
        windowsHide: true,
      });
      process.stdout.write(`grandchild-pid:${descendant.pid ?? ''}\n`);
      setInterval(() => undefined, 60_000);
      break;
    }
    case 'idle': {
      process.stdout.write('{"type":"start"}\n');
      setInterval(() => undefined, 60_000);
      break;
    }
    case 'longout': {
      const total = Number.parseInt(argValue('--arg') ?? '65536', 10);
      const chunk = 'x'.repeat(16 * 1024);
      let written = 0;
      const writeNext = (): void => {
        while (written < total) {
          const remaining = total - written;
          const slice = remaining < chunk.length ? chunk.slice(0, remaining) : chunk;
          if (process.stdout.write(slice)) {
            written += slice.length;
          } else {
            process.stdout.once('drain', () => {
              written += slice.length;
              writeNext();
            });
            return;
          }
        }
        process.stdout.end(() => process.exit(0));
      };
      writeNext();
      break;
    }
    case 'flood': {
      // Write N bytes then keep alive (do NOT exit). For output-limit tests where
      // the child must survive past the cancel-grace period so force-kill runs.
      const total = Number.parseInt(argValue('--arg') ?? '131072', 10);
      const chunk = 'x'.repeat(16 * 1024);
      let written = 0;
      const writeNext = (): void => {
        while (written < total) {
          const remaining = total - written;
          const slice = remaining < chunk.length ? chunk.slice(0, remaining) : chunk;
          if (process.stdout.write(slice)) {
            written += slice.length;
          } else {
            process.stdout.once('drain', () => {
              written += slice.length;
              writeNext();
            });
            return;
          }
        }
        // Written everything; now hang instead of exiting (ref'd interval).
        setInterval(() => undefined, 60_000);
      };
      writeNext();
      break;
    }
    case 'ignore': {
      // Drain stdin but never exit on its close; keep alive (ref'd interval so
      // only a force-kill ends the child — used to prove grace-period killing).
      process.stdin.resume();
      process.stdin.on('data', () => undefined);
      process.stdin.on('end', () => undefined);
      setInterval(() => undefined, 60_000);
      break;
    }
    case 'slow': {
      const ms = Number.parseInt(argValue('--arg') ?? '100', 10);
      setTimeout(() => process.exit(0), ms);
      break;
    }
    case 'jsonl': {
      process.stdout.write('{"type":"a"}\n');
      process.stdout.write('{"type":"b"}\n');
      process.stdout.write('SUCCESS\n');
      process.stdout.write('{"type":"c"}\n');
      process.exit(0);
      break;
    }
    default: {
      process.exit(64);
      break;
    }
  }
}

main();
