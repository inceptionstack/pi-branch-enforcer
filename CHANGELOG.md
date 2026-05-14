# Changelog

All notable changes to `@inceptionstack/pi-branch-enforcer` are documented here.

## [3.3.0] — 2026-05-14

### Added
- **Runtime kill-switch** — enforcement can now be disabled without restarting the agent
  - File-based: create `~/.pi-branch-enforcer/disabled` to disable; remove to re-enable
  - Env var: `PI_BRANCH_ENFORCER_DISABLED=1` (process-scope only)
  - Checked on every `tool_call`, so toggling takes effect on the next bash command
  - Designed for use with roundhouse `/toggle-enforce-branches` (immediate, persisted across restarts)

## [3.2.1] — 2026-05-10

### Fixed
- Tag pushes (e.g. `git push origin v1.2.3`) no longer trigger Tier 2 LLM judge
- Added `isTagPushOnly()` early-exit before Tier 2/3: if command contains only tag-like refs (v\d+) and no protected branch names, skip LLM entirely
- Added explicit ALLOW rule for tags in LLM judge prompt (defense-in-depth)

## [3.1.2] — 2026-05-09

### Fixed
- **Path traversal guard** — `readScriptFile` restricts reads to cwd, /tmp, or $HOME
- **Trailing slash normalization** — cwd with trailing `/` no longer breaks path allowlist

## [3.1.1] — 2026-05-09

### Fixed
- **JSDoc updated** to document three-tier strategy
- **~ expansion** in script file paths (e.g. `node ~/script.js`)
- **path.resolve** collapses `..` segments in file paths
- **Skip Tier 3** if Tier 2 already fired (avoids double LLM calls / cost)

## [3.1.0] — 2026-05-09

### Added
- **Tier 3: Script file inspection** — detects when a scripting language executes a file
  (e.g. `node /tmp/push.js`), reads file contents, checks for git push/commit, sends to LLM judge
- Catches the "write bypass to file, then run it" evasion pattern that bypassed Tier 2

### Changed
- README updated to document three-tier strategy
- Regex handles flags with hyphens (e.g. `node --max-old-space-size=4096 file.js`)

## [3.0.1] — 2026-05-08

### Fixed
- **LLM judge over blanket block** — no longer blocks all subprocess commands containing "git";
  sends to Claude Haiku for BLOCK/ALLOW verdict instead
- Truncate command to 2000 chars before sanitization
- Escape `<` to `&lt;` in prompt (prevent XML tag injection)

## [3.0.0] — 2026-05-08

### Added
- **Tier 2: LLM judge** — Claude Haiku via AWS Bedrock for subprocess bypass detection
- Two-tier architecture: fast regex (Tier 1) + LLM intent analysis (Tier 2)

### Changed
- Complete rewrite from regex-only to LLM-augmented detection
- Fails open if Bedrock unavailable (Tier 1 still protects)

## [2.1.1] — 2026-05-07

### Fixed
- Initial release with regex-based branch protection
