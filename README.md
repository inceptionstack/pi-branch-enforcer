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

## What it allows

- `git checkout -b feature && git commit` ✔️ (branch created first)
- `git push origin feature-branch` ✔️
- `git push origin --tags` ✔️
- Any commit/push on a non-protected branch ✔️

## How it works

Intercepts `bash` tool calls and checks:
1. **Commits**: Blocked unless the same command chain creates/switches to a non-protected branch before the commit
2. **Pushes**: Blocked if the refspec targets main/master or no refspec is given

When blocked, the agent receives clear instructions to create a branch and PR.

## Configuration

None needed. Works out of the box. Protected branches are `main` and `master`.

## License

Apache-2.0
