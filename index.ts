/**
 * pi-branch-enforcer — Pi extension
 *
 * Prevents git push directly to main/master branches.
 * Forces agents to use feature branches and PRs for all changes.
 *
 * When a `git push` targets main or master (explicitly or implicitly),
 * the command is blocked with a clear message instructing the agent to
 * create a branch instead.
 *
 * Install:
 *   pi install npm:@inceptionstack/pi-branch-enforcer
 */

import { type ExtensionAPI, isToolCallEventType } from "@mariozechner/pi-coding-agent";

/** Branch names that are protected from direct push. */
const PROTECTED_BRANCHES = ["main", "master"];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command ?? "";

    // Must be a git push (not git stash push)
    if (!/\bgit\s+(?:\S+\s+)*?push\b/.test(cmd) || /\bgit\s+stash\s+push\b/.test(cmd)) return;

    // Check if pushing to a protected branch
    if (isPushToProtectedBranch(cmd)) {
      return {
        block: true,
        reason:
          `Push blocked: direct push to main/master is not allowed. ` +
          `Use a feature branch and create a pull request instead.\n\n` +
          `To fix:\n` +
          `  1. Create a branch: git checkout -b <branch-name>\n` +
          `  2. Push the branch: git push origin <branch-name>\n` +
          `  3. Create a PR: gh pr create --base main`,
      };
    }
  });
}

/**
 * Determines if a git push command targets a protected branch.
 *
 * Matches:
 *   - `git push origin main`
 *   - `git push origin master`
 *   - `git push` (no refspec — pushes current branch; blocked if on main/master)
 *   - `git push --force origin main`
 *   - `git push origin HEAD:main`
 *   - `git push origin HEAD:refs/heads/main`
 *
 * Does NOT block:
 *   - `git push origin feature-branch`
 *   - `git push origin --tags`
 *   - `git push origin v1.0.0` (tag push)
 */
function isPushToProtectedBranch(cmd: string): boolean {
  // Normalize: strip inline comments and collapse whitespace
  const normalized = cmd.replace(/#.*$/gm, "").trim();

  for (const branch of PROTECTED_BRANCHES) {
    // Explicit branch name as refspec: `git push origin main`
    if (new RegExp(`\\bgit\\s+.*push\\s+.*\\b${branch}\\b`).test(normalized)) return true;

    // HEAD:branch or HEAD:refs/heads/branch refspec
    if (new RegExp(`HEAD:(?:refs/heads/)?${branch}\\b`).test(normalized)) return true;

    // Force push variants: `git push --force origin main`, `git push -f origin main`
    if (new RegExp(`\\bgit\\s+.*push\\s+.*(?:--force|-f)\\s+.*\\b${branch}\\b`).test(normalized))
      return true;
  }

  // Bare `git push` or `git push origin` without a refspec — this pushes the
  // current branch. We block it because if the agent is on main, it pushes to main.
  // The agent should always be explicit about which branch to push.
  if (/\bgit\s+(?:(?:--\S+|-\S)\s+)*push\s*$/.test(normalized)) return true;
  if (/\bgit\s+(?:(?:--\S+|-\S)\s+)*push\s+\w+\s*$/.test(normalized)) {
    // `git push origin` — no refspec, could be pushing current branch (main)
    // Only block if the remote arg isn't a flag
    const match = normalized.match(/\bgit\s+.*push\s+(\S+)\s*$/);
    if (match && !match[1].startsWith("-") && !match[1].includes(":")) return true;
  }

  return false;
}
