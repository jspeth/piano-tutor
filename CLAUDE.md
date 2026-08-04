# Orchestration

Plan complex tasks yourself, then delegate to subagents:

- non-trivial feature/refactor design → `planner` subagent
- implementation → `implementer` subagent
- "where is X" / "what calls Y" lookups → `code-searcher` subagent
- reviewing a diff before calling it done → `reviewer` subagent

Review all subagent output before accepting it. For simple, well-understood
changes, it's fine to implement directly instead of delegating.
