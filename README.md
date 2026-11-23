# codemode-parity

When a program threw on the E2B executor of [mcp-use](https://github.com/mcp-use/mcp-use) code mode, the caller got `exit status 1` and lost the message and the logs. This repo shows why, how often it happened, and a small patch with tests.

```js
console.log("starting");
throw new Error("boom");
```

| | error | logs |
|---|---|---|
| VM executor | `boom` | `starting` |
| E2B before | `exit status 1` | empty |
| E2B with the patch | `boom` | `starting` |

Reported upstream as [mcp-use#3161](https://github.com/mcp-use/mcp-use/issues/3161).

Read `docs/index.html` for the walkthrough and a small interactive comparison.

## Contents
- `docs/index.html`: the write-up, with an Overview tab and a Technical details tab.
- `patch/pr1-thrown-errors.diff`: the change against mcp-use canary `d3f543b`, with its tests and changeset. Read it with `git apply --stat` or `git diff -w`.
- `data/results.json`: the recorded output the page shows.
- `reproduce/`: a one-command offline comparison of four programs.
- `LICENSE` and `NOTICE.md`: MIT for this repo's own work, and the upstream mcp-use license for the code the patch changes.

## Reproduce the four-program comparison
Needs Docker and a clone of mcp-use with dependencies installed. It uses no key and no network.

```bash
sh reproduce/run.sh path/to/mcp-use
```

It exports the base commit twice, applies the patch to one copy, and runs both in a container with a fake sandbox that runs each script in a real `node` process and throws the real SDK error.

## What was measured
60 model-written programs in 10 patterns ran on real E2B and on the VM. On canary none matched on result, error and logs. 33 differed in result or error, and 22 of those lost the real error. The patterns were chosen by hand, so this shows which patterns differ and not how often a real agent hits them.

## Limits
- A program that reads its own script can forge the error marker. This reports the program's own error and is not a security boundary.
- Real E2B was run in one region at the default sandbox size, 8 cases per run. Cost was not read from the E2B dashboard.
- Two tool calls in one output chunk still run one after the other, and a call split across chunks is not served.

The 60-program table compares a larger prototype branch, not the patch alone. The patch was tested separately on real E2B in 8 cases.
