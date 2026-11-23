# codemode-parity

When a program threw on the E2B executor of [mcp-use](https://github.com/mcp-use/mcp-use) code mode, the caller got `exit status 1` and lost the message and the logs. This repo shows why, a comparison across 60 test programs, and a small patch with tests.

```js
console.log("starting");
throw new Error("boom");
```

| | error | logs |
|---|---|---|
| VM executor | `boom` | `starting` |
| E2B before | `exit status 1` | empty |
| E2B with the patch | `boom` | `starting` |

The proposed patch is documented in [mcp-use issue #3161](https://github.com/mcp-use/mcp-use/issues/3161) while awaiting maintainer feedback.

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

## Comparison across 60 test programs
60 model-written programs in 10 patterns ran on real E2B and on the VM. On canary none matched on result, error and logs. 33 differed in result or error, and 22 of those lost the real error. The patterns were chosen by hand, so this shows which patterns differ and not how often a real agent hits them.

## Scope and boundaries
- The error marker carries a per-run id. It prevents accidental collisions and is not an authentication boundary, because a program can read its own script.
- Real E2B runs used one region and the default sandbox size, 8 cases per run. E2B usage cost was not measured.
- Out of scope: running several tool calls from one output chunk in parallel, and serving a call split across chunks. Open PRs #2915 and #2984 cover those.

The 60-program table compares a larger prototype branch, not the patch alone. The patch was tested separately on real E2B in 8 cases.
