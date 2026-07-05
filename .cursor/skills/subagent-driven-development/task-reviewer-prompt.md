# Task Reviewer Prompt Template

Use this template when dispatching a per-task reviewer subagent (spec compliance + code quality in one pass).

```
Task tool (generalPurpose):
  description: "Review Task N: spec compliance + code quality"
  model: [explicit model per SKILL.md Model Selection]
  prompt: |
    You are reviewing Task N: [task name]

    ## Inputs (read all three)

    1. **Task brief** (requirements): [TASK_BRIEF_PATH]
    2. **Implementer report** (claims + test evidence): [REPORT_FILE_PATH]
    3. **Review package** (commits + diff): [REVIEW_PACKAGE_PATH]

    ## Global Constraints

    [Verbatim binding requirements from the plan's Global Constraints section — exact values, formats, relationships]

    ## Your Job

    Produce **two verdicts**:

    ### 1. Spec Compliance
    Compare the diff against the brief. Do not trust the report without reading the code.

    - Missing requirements?
    - Extra/unrequested work?
    - Misunderstandings or wrong interpretation?

    Report: **Spec ✅** or **Spec ❌** with specific gaps (file:line references).

    ### 2. Task Quality
    Assess whether the implementation is well-built for this task scope.

    Check:
    - Clean separation of concerns; one responsibility per file
    - Error handling, edge cases
    - Tests actually verify behavior (not just mocks)
    - YAGNI — no scope creep
    - Follows plan file structure and codebase patterns
    - New or grown files reasonable for this change

    Report: **Task quality: Approved** or list issues by severity.

    ## Issue Severity

    - **Critical:** Must fix before task is done (bugs, security, broken functionality, spec violations)
    - **Important:** Should fix before task is done (architecture problems, test gaps, maintainability)
    - **Minor:** Note for final review; does not block this task

    ## Cannot Verify from Diff

    If a requirement depends on unchanged code or spans tasks, report:
    **⚠️ Cannot verify from diff:** [requirement] — [what you would need to check]

    These do not block your other findings, but the controller must resolve each before marking the task complete.

    ## Output Format

    **Spec:** ✅ | ❌
    [If ❌, list missing/extra/misunderstandings with file:line]

    **Strengths:**
    [What's well done]

    **Issues:**
    - Critical: [list or "None"]
    - Important: [list or "None"]
    - Minor: [list or "None"]

    **⚠️ Cannot verify from diff:**
    [list or "None"]

    **Task quality:** Approved | Not approved

    Do not re-run tests the implementer already ran on the same code — use their report for test evidence unless the diff suggests tests are missing or wrong.
```
