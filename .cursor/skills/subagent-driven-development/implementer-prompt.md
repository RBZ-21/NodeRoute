# Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent.

```
Task tool (generalPurpose):
  description: "Implement Task N: [task name]"
  model: [explicit model per SKILL.md Model Selection]
  prompt: |
    You are implementing Task N: [task name]

    ## Read This First

    Read the task brief — it is your requirements, with exact values to use verbatim:
    [TASK_BRIEF_PATH]

    Do not read the full plan file. The brief is the single source of requirements.

    ## Context

    [Scene-setting: where this task fits in the project, dependencies, interfaces from earlier tasks]

    ## Ambiguity Resolutions

    [Controller's resolution of any ambiguity noticed in the brief — omit section if none]

    ## Before You Begin

    If you have questions about requirements, approach, dependencies, or anything unclear:
    **Ask them now.** Raise concerns before starting work.

    ## Your Job

    Once you're clear on requirements:
    1. Implement exactly what the brief specifies
    2. Write tests (follow TDD if the brief says to)
    3. Verify implementation works
    4. Commit your work
    5. Self-review (see below)
    6. Write your full report to the report file (see Report Contract)

    Work from: [directory]

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    Don't guess or make assumptions.

    ## Code Organization

    - Follow the file structure defined in the brief
    - Each file should have one clear responsibility with a well-defined interface
    - If a file you're creating grows beyond the brief's intent, stop and report DONE_WITH_CONCERNS
    - In existing codebases, follow established patterns; don't restructure outside your task

    ## When You're in Over Your Head

    **STOP and escalate when:**
    - The task requires architectural decisions with multiple valid approaches
    - You need codebase context beyond what was provided
    - You feel uncertain about correctness
    - The task involves restructuring the plan didn't anticipate

    Report BLOCKED or NEEDS_CONTEXT with what you're stuck on, what you tried, and what help you need.

    ## Before Reporting Back: Self-Review

    **Completeness:** Did I implement everything? Edge cases handled?
    **Quality:** Clear names, clean code, maintainable?
    **Discipline:** YAGNI — only what was requested?
    **Testing:** Tests verify behavior; TDD followed if required?

    Fix issues before reporting.

    ## Report Contract

    Write your **full** report to: [REPORT_FILE_PATH]

    Include in the report file:
    - What you implemented (or attempted if blocked)
    - Files changed
    - Tests run (command + output)
    - Self-review findings
    - Detailed concerns

    Return to the controller **only**:
    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - **Commits:** [base..head SHAs or commit list]
    - **Tests:** one-line summary (e.g., "8/8 passing in tests/foo.test.ts")
    - **Concerns:** brief list (or "none")

    Use DONE_WITH_CONCERNS if completed but doubtful. Use BLOCKED if you cannot complete.
    Use NEEDS_CONTEXT if information was missing. Never silently produce work you're unsure about.
```
