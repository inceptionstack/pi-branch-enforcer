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

Two-tier detection strategy:

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

**Why LLM over regex?** Subprocess bypass detection via regex is a game of whack-a-mole — every new pattern (backticks, os.system, child_process variants, encoding tricks) requires a new rule. An LLM understands *intent*, catching patterns we haven't anticipated while correctly allowing "main" in commit messages, file paths, or variable names.

## Requirements

- **Tier 1**: No external dependencies (works everywhere)
- **Tier 2**: Requires AWS Bedrock access in `us-east-1`:
  - Model: `us.anthropic.claude-haiku-4-5-20251001-v1:0`
  - IAM permission: `bedrock:InvokeModel`
  - The `aws` CLI must be available and authenticated
  - If unavailable, Tier 2 silently fails open (Tier 1 still protects)

## Configuration

None needed. Works out of the box. Protected branches are `main` and `master`.

## License

Apache-2.0
