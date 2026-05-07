/**
 * pi-branch-enforcer — Pi extension
 *
 * Prevents git commit and git push directly to main/master branches.
 * Forces agents to use feature branches and PRs for all changes.
 *
 * Uses a two-tier detection strategy:
 * 1. Fast regex for direct git commands (commit/push on protected branches)
 * 2. LLM judge (Haiku) for complex commands that may bypass protection
 *    via subprocess wrappers (python, node, perl, ruby, etc.)
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

/** Model to use for LLM-based bypass detection. */
const JUDGE_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command ?? "";

    // Tier 1: Fast regex for direct git commands
    if (isGitCommit(cmd)) {
      if (createsBranchBeforeCommit(cmd)) return;

      const effectiveCwd = resolveEffectiveCwd(cmd, ctx.cwd);
      const branch = await getBranchViaExec(pi, effectiveCwd);

      if (branch && PROTECTED_BRANCHES.has(branch)) {
        return {
          block: true,
          reason:
            `Commit blocked: committing directly to ${branch} is not allowed. ` +
            BRANCH_FIX_INSTRUCTIONS,
        };
      }
    }

    if (isGitPush(cmd) && isPushToProtectedBranch(cmd)) {
      return {
        block: true,
        reason:
          `Push blocked: direct push to main/master is not allowed. ` +
          BRANCH_FIX_INSTRUCTIONS,
      };
    }

    // Tier 2: LLM judge for complex/obfuscated commands
    if (looksLikeBypassAttempt(cmd)) {
      const verdict = await judgeWithLLM(pi, cmd);
      if (verdict) {
        return {
          block: true,
          reason:
            `Push blocked: command appears to bypass branch protection via subprocess. ` +
            BRANCH_FIX_INSTRUCTIONS,
        };
      }
    }
  });
}

// ─── Tier 1: Direct git command detection (regex, fast) ──────────────────────

function resolveEffectiveCwd(cmd: string, sessionCwd: string): string {
  const cdMatches = [...cmd.matchAll(/\bcd\s+([^\s;&|]+)/g)];
  if (cdMatches.length > 0) {
    const lastCd = cdMatches[cdMatches.length - 1][1];
    const dir = lastCd.replace(/^~(?=\/|$)/, process.env.HOME || "/home/ec2-user");
    if (dir.startsWith("/")) return dir;
    return `${sessionCwd}/${dir}`;
  }
  return sessionCwd;
}

async function getBranchViaExec(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  try {
    const result = await pi.exec("git", ["-C", cwd, "branch", "--show-current"], { timeout: 3000 });
    if (result.code === 0) return result.stdout.trim() || null;
  } catch {}
  return null;
}

function isGitCommit(cmd: string): boolean {
  return /\bgit\s+(?:(?:-\S+|--\S+)\s+)*commit\b/.test(stripQuotedContent(cmd));
}

function createsBranchBeforeCommit(cmd: string): boolean {
  const stripped = stripQuotedContent(cmd);
  const commitIdx = stripped.search(/\bgit\s+(?:(?:-\S+|--\S+)\s+)*commit\b/);
  if (commitIdx < 0) return false;

  const before = stripped.slice(0, commitIdx);
  const match = before.match(/\bgit\s+(?:checkout|switch)\s+(?:-[bc]|--create)\s+(\S+)/);
  if (match && !PROTECTED_BRANCHES.has(match[1])) return true;
  return false;
}

function isGitPush(cmd: string): boolean {
  const stripped = stripQuotedContent(cmd);
  return /\bgit\s+(?:\S+\s+)*?push\b/.test(stripped) && !/\bgit\s+stash\s+push\b/.test(stripped);
}

function isPushToProtectedBranch(cmd: string): boolean {
  const normalized = cmd.replace(/#.*$/gm, "").trim();

  for (const branch of PROTECTED_BRANCHES) {
    const branchEnd = `(?![\\w-])`;
    if (new RegExp(`\\bgit\\s+[^;|&]*\\bpush\\b[^;|&]*(?:^|\\s)${branch}${branchEnd}`).test(normalized))
      return true;
    if (new RegExp(`:(?:refs/heads/)?${branch}${branchEnd}`).test(normalized)) return true;
  }

  if (/\bgit\s+(?:(?:--\S+|-\S)\s+)*push\s*$/.test(normalized)) return true;

  const bareRemoteMatch = normalized.match(/\bgit\s+[^;|&]*\bpush\s+(?:(?:--\S+|-\S)\s+)*(\S+)\s*$/);
  if (bareRemoteMatch && !bareRemoteMatch[1].startsWith("-") && !bareRemoteMatch[1].includes(":")) {
    return true;
  }

  return false;
}

function stripQuotedContent(cmd: string): string {
  return cmd.replace(/(["'])(?:(?!\1).)*\1/g, "$1$1");
}

// ─── Tier 2: LLM-based bypass detection ─────────────────────────────────────

/**
 * Quick regex pre-filter: does this command look like it MIGHT be a bypass?
 * Must contain: a scripting language + git + push/commit.
 * This is intentionally broad — the LLM judge makes the final call.
 */
function looksLikeBypassAttempt(cmd: string): boolean {
  // Must involve a scripting language
  if (!/\b(?:python3?|python|node|perl|ruby|php|bash\s+-c|sh\s+-c)\b/.test(cmd)) return false;
  // Must mention git
  if (!/\bgit\b/.test(cmd)) return false;
  // Must mention push or commit
  if (!/\b(?:push|commit)\b/.test(cmd)) return false;
  return true;
}

/**
 * Call Haiku to judge whether a command is attempting to bypass branch protection.
 * Returns true if the LLM determines it's a bypass attempt targeting main/master.
 * Returns false on any error (fail-open to avoid blocking legitimate work).
 */
async function judgeWithLLM(pi: ExtensionAPI, cmd: string): Promise<boolean> {
  const prompt = `You are a security gate for git branch protection. Protected branches: main, master.

Does this bash command use a scripting language (python/node/perl/ruby/sh -c) as a subprocess wrapper to execute "git push" or "git commit" TARGETING a protected branch?

Rules:
- BLOCK: subprocess executes "git push" to main/master (e.g. push origin main)
- BLOCK: subprocess executes a bare "git push" with no branch (defaults to current/protected)
- ALLOW: subprocess pushes to a feature branch (anything other than main/master)
- ALLOW: "main" or "master" appears only inside a commit message (-m "..."), file path, or variable — NOT as a git push target
- ALLOW: the git command is only a commit (not a push) and doesn't specify it's on main/master
- ALLOW: the scripting language does something unrelated to git

Command:
\`\`\`
${cmd}
\`\`\`

Respond with ONLY one word: BLOCK or ALLOW`;

  try {
    const result = await pi.exec("aws", [
      "bedrock-runtime", "converse",
      "--region", "us-east-1",
      "--model-id", JUDGE_MODEL,
      "--messages", JSON.stringify([{ role: "user", content: [{ text: prompt }] }]),
      "--inference-config", JSON.stringify({ maxTokens: 4, temperature: 0 }),
      "--query", "output.message.content[0].text",
      "--output", "text",
    ], { timeout: 10_000 });

    if (result.code === 0) {
      const answer = result.stdout.trim().toUpperCase();
      return answer === "BLOCK";
    }
  } catch {
    // Fail open — if LLM is unavailable, allow the command
  }

  return false;
}
