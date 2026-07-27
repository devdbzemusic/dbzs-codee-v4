# Context Pack

Phase 1C builds a compact LLM context package from a workspace.

## API

`POST /context-pack/build`

```json
{
  "workspace_root": "D:/dev/repo/example",
  "user_request": "Find build issues",
  "active_file_path": "src/App.tsx",
  "max_files": 80,
  "max_bytes_per_file": 20000
}
```

## Output

- detected stack (Node, Python, Rust, Electron, ...)
- important/package/test files
- TODO/FIXME markers
- risk notes
- recommended commands
- `markdown_context` for agent artifacts

Ignored: `node_modules`, `.git`, `dist`, `build`, `.venv`, `target`.
