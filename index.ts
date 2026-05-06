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
const PROTECTED_BRANCHES = new Set(["main", "master"]);

const BRANCH_FIX_INSTRUCTIONS =
  `Use a feature branch for all changes.\n\n` +
  `To fix:\n` +
  `  1. Create a branch: git checkout -b <branch-name>\n` +
  `  2. Make your commits on the branch\n` +
  `  3. Push the branch: git push origin <branch-name>\n` +
  `  4. Create a PR: gh pr create --base main`;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command ?? "";

    // Check for git commit — block if current branch is protected
    if (isGitCommit(cmd)) {
      // If the command itself creates a new branch before committing, allow it
      if (createsBranchBeforeCommit(cmd)) return;

      const branch = await getCurrentBranch(pi, ctx.cwd);
      if (branch && PROTECTED_BRANCHES.has(branch)) {
        return {
          block: true,
          reason:
            `Commit blocked: committing directly to ${branch} is not allowed. ` +
            BRANCH_FIX_INSTRUCTIONS,
        };
      }
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

/** Get the current branch name by running git. Returns null if not in a repo. */
async function getCurrentBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  try {
    const result = await pi.exec("git", ["branch", "--show-current"], { timeout: 3000, cwd });
    if (result.code === 0) return result.stdout.trim() || null;
  } catch {}
  return null;
}

/** Returns true if cmd contains a git commit command. */
function isGitCommit(cmd: string): boolean {
  // Match `git commit` but not inside quoted strings (e.g., PR titles)
  // Simple approach: check if "git" and "commit" appear as a command, not in quotes
  return /\bgit\s+(?:(?:-\S+|--\S+)\s+)*commit\b/.test(stripQuotedContent(cmd));
}

/** Returns true if the command creates/switches to a non-protected branch before committing. */
function createsBranchBeforeCommit(cmd: string): boolean {
  const stripped = stripQuotedContent(cmd);
  const commitIdx = stripped.search(/\bgit\s+(?:(?:-\S+|--\S+)\s+)*commit\b/);
  if (commitIdx < 0) return false;

  const before = stripped.slice(0, commitIdx);
  // git checkout -b <name> or git switch -c <name>
  const match = before.match(/\bgit\s+(?:checkout|switch)\s+(?:-[bc]|--create)\s+(\S+)/);
  if (match && !PROTECTED_BRANCHES.has(match[1])) return true;

  return false;
}

/** Returns true if cmd contains a git push (not git stash push). */
function isGitPush(cmd: string): boolean {
  const stripped = stripQuotedContent(cmd);
  return /\bgit\s+(?:\S+\s+)*?push\b/.test(stripped) && !/\bgit\s+stash\s+push\b/.test(stripped);
}

/**
 * Determines if a git push command targets a protected branch.
 * Only strips comments (not quotes) to preserve refspec analysis.
 */
function isPushToProtectedBranch(cmd: string): boolean {
  const normalized = cmd.replace(/#.*$/gm, "").trim();

  for (const branch of PROTECTED_BRANCHES) {
    // Explicit branch name as a standalone word after push + remote:
    // `git push origin main` but not `git push origin main-feature`
    if (new RegExp(`\\bgit\\s+.*\\bpush\\s+\\S+\\s+${branch}\\s*$`).test(normalized)) return true;
    if (new RegExp(`\\bgit\\s+.*\\bpush\\s+\\S+\\s+${branch}\\s`).test(normalized)) return true;

    // HEAD:branch or HEAD:refs/heads/branch refspec
    if (new RegExp(`HEAD:(?:refs/heads/)?${branch}\\b`).test(normalized)) return true;
  }

  // Bare `git push` with no refspec — could push current branch (which might be main)
  if (/\bgit\s+(?:(?:--\S+|-\S)\s+)*push\s*$/.test(normalized)) return true;

  // `git push origin` with no refspec
  const bareRemoteMatch = normalized.match(/\bgit\s+(?:(?:--\S+|-\S)\s+)*push\s+(\S+)\s*$/);
  if (bareRemoteMatch && !bareRemoteMatch[1].startsWith("-") && !bareRemoteMatch[1].includes(":")) {
    return true;
  }

  return false;
}

/**
 * Remove content inside single and double quotes to avoid matching
 * git commands that appear in commit messages, PR titles, etc.
 * Preserves the quote delimiters as empty to maintain word boundaries.
 */
function stripQuotedContent(cmd: string): string {
  return cmd.replace(/(["'])(?:(?!\1).)*\1/g, "$1$1");
}
