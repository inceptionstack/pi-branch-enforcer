/**
 * pi-branch-enforcer — Pi extension
 *
 * Prevents git commit and git push directly to main/master branches.
 * Forces agents to use feature branches and PRs for all changes.
 *
 * When a `git commit` or `git push` would happen while on main/master,
 * the command is blocked with a clear message instructing the agent to
 * create a branch first.
 *
 * Install:
 *   pi install npm:@inceptionstack/pi-branch-enforcer
 */

import { type ExtensionAPI, isToolCallEventType } from "@mariozechner/pi-coding-agent";

/** Branch names that are protected from direct commits and pushes. */
const PROTECTED_BRANCHES = ["main", "master"];

const BRANCH_FIX_INSTRUCTIONS =
  `Use a feature branch for all changes.\n\n` +
  `To fix:\n` +
  `  1. Create a branch: git checkout -b <branch-name>\n` +
  `  2. Make your commits on the branch\n` +
  `  3. Push the branch: git push origin <branch-name>\n` +
  `  4. Create a PR: gh pr create --base main`;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command ?? "";

    // Check for git commit on a protected branch
    if (isGitCommit(cmd) && isOnProtectedBranch(cmd)) {
      return {
        block: true,
        reason:
          `Commit blocked: committing directly to main/master is not allowed. ` +
          BRANCH_FIX_INSTRUCTIONS,
      };
    }

    // Check for git push to a protected branch
    if (isGitPush(cmd) && isPushToProtectedBranch(cmd)) {
      return {
        block: true,
        reason:
          `Push blocked: direct push to main/master is not allowed. ` +
          BRANCH_FIX_INSTRUCTIONS,
      };
    }
  });
}

/** Returns true if cmd contains a git commit (not --amend on a non-main branch). */
function isGitCommit(cmd: string): boolean {
  return /\bgit\s+(?:(?:-\S+|--\S+)\s+)*commit\b/.test(cmd);
}

/** Returns true if cmd contains a git push (not git stash push). */
function isGitPush(cmd: string): boolean {
  return /\bgit\s+(?:\S+\s+)*?push\b/.test(cmd) && !/\bgit\s+stash\s+push\b/.test(cmd);
}

/**
 * Determines if a git commit is happening on a protected branch.
 *
 * Since we can't know the current branch from the command alone (git commit
 * doesn't specify it), we check if the command includes an explicit checkout
 * to a non-protected branch in the same command chain. If not, we assume
 * the agent is on a protected branch and block.
 *
 * Exception: if the command chain includes `git checkout -b <branch>` or
 * `git switch -c <branch>` BEFORE the commit, we allow it (the agent is
 * creating a branch first).
 */
function isOnProtectedBranch(cmd: string): boolean {
  // If the command creates/switches to a non-protected branch before committing, allow it.
  // Match: git checkout -b <name> or git switch -c <name> appearing before git commit
  const commitIdx = cmd.search(/\bgit\s+(?:(?:-\S+|--\S+)\s+)*commit\b/);
  const branchBefore = cmd.slice(0, commitIdx);

  // Check for branch creation before commit
  const checkoutMatch = branchBefore.match(
    /\bgit\s+(?:checkout|switch)\s+(?:-[bc]|--create)\s+(\S+)/,
  );
  if (checkoutMatch) {
    const branchName = checkoutMatch[1];
    if (!PROTECTED_BRANCHES.includes(branchName)) return false;
  }

  // Check for explicit checkout to a non-protected branch
  const switchMatch = branchBefore.match(/\bgit\s+(?:checkout|switch)\s+(\S+)/);
  if (switchMatch && !switchMatch[0].includes("-b") && !switchMatch[0].includes("-c")) {
    const branchName = switchMatch[1];
    if (!branchName.startsWith("-") && !PROTECTED_BRANCHES.includes(branchName)) return false;
  }

  // No evidence of being on a non-protected branch — block
  return true;
}

/**
 * Determines if a git push command targets a protected branch.
 */
function isPushToProtectedBranch(cmd: string): boolean {
  const normalized = cmd.replace(/#.*$/gm, "").trim();

  for (const branch of PROTECTED_BRANCHES) {
    // Explicit branch name as refspec: `git push origin main`
    if (new RegExp(`\\bgit\\s+.*push\\s+.*\\b${branch}\\b`).test(normalized)) return true;

    // HEAD:branch or HEAD:refs/heads/branch refspec
    if (new RegExp(`HEAD:(?:refs/heads/)?${branch}\\b`).test(normalized)) return true;
  }

  // Bare `git push` or `git push origin` without a refspec
  if (/\bgit\s+(?:(?:--\S+|-\S)\s+)*push\s*$/.test(normalized)) return true;
  if (/\bgit\s+(?:(?:--\S+|-\S)\s+)*push\s+\w+\s*$/.test(normalized)) {
    const match = normalized.match(/\bgit\s+.*push\s+(\S+)\s*$/);
    if (match && !match[1].startsWith("-") && !match[1].includes(":")) return true;
  }

  return false;
}
