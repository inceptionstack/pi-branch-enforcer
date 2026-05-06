# pi-branch-enforcer

Pi extension that prevents `git push` directly to `main` or `master` branches. Forces agents to use feature branches and pull requests.

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

## What it does

Intercepts `bash` tool calls containing `git push` and blocks them if:

- The push targets `main` or `master` explicitly (`git push origin main`)
- The push uses a refspec pointing to a protected branch (`HEAD:main`)
- The push has no refspec (bare `git push` — could push current branch to main)

When blocked, the agent receives a clear error message with instructions to create a branch and PR instead.

## What it allows

- `git push origin feature-branch` ✅
- `git push origin --tags` ✅
- `git push origin v1.0.0` (tag push) ✅
- Any push to a non-protected branch ✅

## Configuration

None needed. Works out of the box. Protected branches are `main` and `master`.

## License

Apache-2.0
