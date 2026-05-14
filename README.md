# pi-branch-enforcer

Pi extension that prevents `git commit` and `git push` directly to `main` or `master` branches. Forces agents to use feature branches and pull requests.

## Install

```bash
pi install npm:@inceptionstack/pi-branch-enforcer
```

Or add to your `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:@inceptionstack/pi-branch-enforcer"]
}
```

## What it blocks

- `git commit` while on `main` or `master` (any commit without a prior branch switch)
- `git push origin main` or any push targeting a protected branch
- Bare `git push` (could push current main branch)
- Force push to protected branches
- **Subprocess bypass attempts** — using python/node/perl/ruby to execute git push/commit to protected branches

## What it allows

- `git checkout -b feature && git commit` ✔️ (branch created first)
- `git push origin feature-branch` ✔️
- `git push origin --tags` ✔️
- Any commit/push on a non-protected branch ✔️
- Subprocess pushes to feature branches ✔️

## How it works

Three-tier detection strategy:

### Tier 1: Fast regex (< 1ms)
Intercepts `bash` tool calls and checks:
1. **Commits**: Blocked unless the command creates/switches to a non-protected branch first
2. **Pushes**: Blocked if the refspec targets main/master or no refspec is given

### Tier 2: LLM judge (~1-2s, only when needed)
For complex commands involving scripting languages (python, node, perl, ruby, sh -c):
1. Quick regex pre-filter checks if command contains a scripting language + git + push/commit
2. If triggered, calls Claude Haiku via AWS Bedrock for a BLOCK/ALLOW verdict
3. Catches novel bypass patterns without brittle regex maintenance
4. Fails open if LLM is unavailable (no blocking legitimate work)

### Tier 3: Script file inspection (~1-3s)
Detects when a scripting language executes a file (e.g. `node /tmp/script.js`):
1. Extracts the file path from the command
2. Reads the file contents (first 4KB)
3. If contents mention `git` + `push`/`commit`, sends to the LLM judge
4. Catches the "write bypass to file, then run it" evasion pattern

**Why LLM over regex?** Subprocess bypass detection via regex is a game of whack-a-mole — every new pattern (backticks, os.system, child_process variants, encoding tricks) requires a new rule. An LLM understands *intent*, catching patterns we haven't anticipated while correctly allowing "main" in commit messages, file paths, or variable names.

## Requirements

- **Tier 1**: No external dependencies (works everywhere)
- **Tier 2 & 3**: Requires AWS Bedrock access in `us-east-1`:
  - Model: `us.anthropic.claude-haiku-4-5-20251001-v1:0`
  - IAM permission: `bedrock:InvokeModel`
  - The `aws` CLI must be available and authenticated
  - If unavailable, Tier 2 silently fails open (Tier 1 still protects)

## Configuration

None needed. Works out of the box. Protected branches are `main` and `master`.

## Disabling at runtime

The extension honors a runtime kill-switch — useful when an automation needs
to temporarily bypass enforcement (e.g. release scripts, recovery scenarios)
without restarting the agent.

**File-based (persistent):**
```bash
# Disable
mkdir -p ~/.pi-branch-enforcer && touch ~/.pi-branch-enforcer/disabled

# Re-enable
rm ~/.pi-branch-enforcer/disabled
```

**Env var (process-scope only):**
```bash
PI_BRANCH_ENFORCER_DISABLED=1 pi ...
```

The file is checked on every `bash` tool call, so toggling takes effect on
the **next** command — no agent restart required. Roundhouse exposes this
as the `/toggle-enforce-branches` Telegram command.

## License

Apache-2.0
