import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { E2BCodeExecutor } from "../../../src/code-mode/executor-e2b.js";
import { VMCodeExecutor } from "../../../src/code-mode/executor-vm.js";

// Offline stand-in for E2B: runs the script in a local node process.
vi.mock("@e2b/code-interpreter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@e2b/code-interpreter")>();
  const { spawn } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { mkdir, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, isAbsolute, join } = await import("node:path");

  type RunOptions = {
    timeoutMs?: number;
    onStdout?: (data: string) => void | Promise<void>;
    onStderr?: (data: string) => void | Promise<void>;
  };

  class FakeSandbox {
    private cwd = mkdtempSync(join(tmpdir(), "fake-e2b-"));
    private child: any = null;
    private writtenFiles = new Set<string>();
    private killed = false;

    files = {
      write: (filePath: string, content: string) =>
        this.write(filePath, content),
    };

    commands = {
      run: (cmd: string, opts?: RunOptions) => this.run(cmd, opts),
    };

    static async create(_template: string, _options?: unknown) {
      return new FakeSandbox();
    }

    async write(filePath: string, content: string): Promise<void> {
      if (this.killed) return;

      const target = isAbsolute(filePath) ? filePath : join(this.cwd, filePath);
      this.writtenFiles.add(target);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    async run(cmd: string, opts: RunOptions = {}): Promise<any> {
      const [command, ...args] = cmd.split(/\s+/);
      const child = spawn(command, args, {
        cwd: this.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      let stdout = "";
      let stderr = "";
      let stderrBuffer = "";
      let stdoutQueue: Promise<void> = Promise.resolve();
      let stderrQueue: Promise<void> = Promise.resolve();
      let timedOut = false;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
          reject(new Error("Script execution timed out"));
        }, opts.timeoutMs ?? 30000);

        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          stdout += text;
          stdoutQueue = stdoutQueue
            .then(async () => {
              if (opts.onStdout) await opts.onStdout(text);
            })
            .catch(() => {});
        });

        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          stderr += text;
          stderrBuffer += text;

          let newline = stderrBuffer.indexOf("\n");
          while (newline !== -1) {
            const line = stderrBuffer.slice(0, newline + 1);
            stderrBuffer = stderrBuffer.slice(newline + 1);
            stderrQueue = stderrQueue
              .then(async () => {
                if (opts.onStderr) await opts.onStderr(line);
              })
              .catch(() => {});
            newline = stderrBuffer.indexOf("\n");
          }
        });

        child.on("error", (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });

        child.on("close", (code: number | null) => {
          clearTimeout(timer);
          if (timedOut) return;

          if (stderrBuffer && opts.onStderr) {
            const rest = stderrBuffer;
            stderrQueue = stderrQueue
              .then(async () => {
                if (opts.onStderr) await opts.onStderr(rest);
              })
              .catch(() => {});
          }

          void Promise.all([stdoutQueue, stderrQueue]).then(() => {
            const exitCode = code ?? 1;
            if (exitCode === 0) {
              resolve({ stdout, stderr, exitCode });
              return;
            }
            reject(
              new actual.CommandExitError({
                exitCode,
                stdout,
                stderr,
                error: `exit status ${exitCode}`,
              } as any)
            );
          });
        });
      });
    }

    async kill(): Promise<void> {
      if (this.killed) return;
      this.killed = true;

      if (this.child && this.child.exitCode === null) {
        this.child.kill("SIGKILL");
      }

      for (const file of this.writtenFiles) {
        await rm(file, { force: true }).catch(() => {});
      }

      await rm(this.cwd, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { ...actual, Sandbox: FakeSandbox };
});

const TIMEOUT_MS = 2000;
const CAP_MS = 4000;

const objectSchema = { type: "object", properties: {} };

const sessions = {
  test: {
    connector: {
      tools: [
        { name: "inspect", description: "Describe args", inputSchema: objectSchema },
        { name: "hang", description: "Never answers", inputSchema: objectSchema },
      ],
      callTool: async (name: string, args: any) => {
        if (name === "hang") return new Promise(() => {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                big: typeof args.big,
                at: Object.prototype.toString.call(args.at),
              }),
            },
          ],
        };
      },
    },
  },
};

const client: any = {
  getServerNames: () => ["test"],
  getAllActiveSessions: () => sessions,
  createAllSessions: async () => sessions,
};

const PROGRAMS: Record<string, string> = {
  "thrown-error": 'throw new Error("boom");',
  "printed-markers": [
    'console.log("__MCP_RESULT_START__");',
    'console.log(JSON.stringify("fake result payload"));',
    'console.log("__MCP_RESULT_END__");',
    'return "real";',
  ].join("\n"),
  "bigint-date": "return await test.inspect({ big: 10n, at: new Date(0) });",
  "never-answers": 'await test.hang({}); return "finished";',
};

const EXECUTORS: Record<string, () => any> = {
  vm: () => new VMCodeExecutor(client),
  // The fake sandbox ignores the key, but the executor requires one.
  e2b: () => new E2BCodeExecutor(client, { apiKey: "offline" }),
};

function withCap<T, C>(promise: Promise<T>, ms: number, onCap: C): Promise<T | C> {
  let timer: ReturnType<typeof setTimeout>;
  const cap = new Promise<C>((resolve) => {
    timer = setTimeout(() => resolve(onCap), ms);
  });
  return Promise.race([promise, cap]).finally(() => clearTimeout(timer));
}

async function runProgram(makeExecutor: () => any, code: string) {
  const executor = makeExecutor();
  try {
    const run = executor.execute(code, TIMEOUT_MS).then(
      ({ result, error }: any) => ({ result, error }),
      (error: Error) => ({ error: error.message })
    );
    return await withCap<object, object>(run, CAP_MS, { noReturn: true });
  } finally {
    await withCap(
      Promise.resolve(executor.cleanup()).catch(() => {}),
      TIMEOUT_MS,
      undefined
    );
  }
}

describe("code mode executors", () => {
  it(
    "records how each executor handles the demo programs",
    async () => {
      const names = (process.env.DEMO_EXECUTORS ?? "").split(",").filter(Boolean);
      const out: Record<string, Record<string, object>> = {};

      for (const name of names) {
        out[name] = {};
        for (const [id, code] of Object.entries(PROGRAMS)) {
          out[name][id] = await runProgram(EXECUTORS[name], code);
        }
      }

      writeFileSync(process.env.DEMO_OUT!, JSON.stringify(out, null, 2));

      for (const name of names) {
        for (const id of Object.keys(PROGRAMS)) {
          expect(out[name][id]).toBeDefined();
        }
      }
    },
    60_000
  );
});
