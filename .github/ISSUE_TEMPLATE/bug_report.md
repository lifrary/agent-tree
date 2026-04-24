---
name: Bug report
about: Something is broken or behaves wrong
title: 'bug: '
labels: ['bug']
assignees: ''
---

## What happened

<!-- One or two sentences describing the actual behavior. -->

## What you expected

<!-- What should have happened instead. -->

## Reproduction

```bash
# Exact command(s) that triggered the issue.
agent-tree --list --filter "auth"
```

If reproducible against a specific session, please include the session UUID prefix (no need to share the full JSONL — the prefix is enough for us to attempt repro on our own sessions).

## Environment

- **agent-tree version**: <!-- output of `agent-tree --version` -->
- **Install method**: <!-- `npm install -g …` or git-clone plugin install -->
- **Node version**: <!-- output of `node --version` -->
- **OS**: <!-- macOS 14.x / Ubuntu 22.04 / etc. -->
- **Claude Code version** (if using as plugin): <!-- only relevant for MCP tool issues -->

## Output / logs

<!-- Paste the full stderr/stdout. Use a fenced code block to preserve formatting.
     If the output contains anything sensitive (API keys, file paths, etc.), 
     redact it before posting — the tool ships with a redactor for a reason. -->

```
<paste here>
```

## Additional context

<!-- Anything else that might help: did this work in a previous version? Is it
     intermittent? Does --no-llm change the behavior? -->
