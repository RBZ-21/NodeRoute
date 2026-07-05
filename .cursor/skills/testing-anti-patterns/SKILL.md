---
name: testing-anti-patterns
description: Identifies and avoids common testing mistakes—asserting on mock behavior, test-only production methods, incomplete mocks, and over-mocking. Use when writing or changing tests, adding mocks, reviewing test code, or tempted to add test-only methods to production classes.
---

# Testing Anti-Patterns

## Overview

Tests must verify real behavior, not mock behavior. Mocks isolate dependencies; they are not the thing being tested.

**Core principle:** Test what the code does, not what the mocks do.

## When to Use

Read this skill when:
- Writing or changing tests
- Adding mocks or test doubles
- Reviewing test code
- Tempted to add test-only methods to production classes
- Mock setup is growing faster than test logic

## The Iron Laws

```
1. NEVER test mock behavior
2. NEVER add test-only methods to production classes
3. NEVER mock without understanding dependencies
```

## Quick Reference

| Anti-Pattern | Fix |
|--------------|-----|
| Assert on mock elements | Test real component or unmock it |
| Test-only methods in production | Move to test utilities |
| Mock without understanding | Understand dependencies first, mock minimally |
| Incomplete mocks | Mirror real API completely |
| Tests as afterthought | TDD — tests first |
| Over-complex mocks | Consider integration tests |

## Red Flags — STOP

- Assertion checks for `*-mock` test IDs
- Methods only called in test files
- Mock setup is >50% of test
- Test fails when you remove the mock
- Can't explain why the mock is needed
- Mocking "just to be safe"

## Gate Questions

Before asserting on a mock: **"Am I testing real component behavior or just mock existence?"**

Before adding a production method: **"Is this only used by tests?"**

Before mocking: **"What side effects does the real method have? Does this test depend on any of them?"**

Before creating mock data: **"What fields does the real API response contain?"**

## Full Reference

For all five anti-patterns with examples, gate functions, and fixes, read [testing-anti-patterns.md](testing-anti-patterns.md).
