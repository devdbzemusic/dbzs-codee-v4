Hier ist ein starker **Master-Prompt für eine lokale AI Coding Assistant App** — von Projektstart bis fertiger App.

````md
# MASTER PROMPT: Build a Local AI Coding Assistant App

You are a senior software architect, full-stack developer, UI/UX designer, AI systems engineer, and product strategist.

Build a complete local AI Coding Assistant desktop application from project start to production-ready release.

The app should be local-first, modular, extensible, secure, beautiful, and developer-focused.

---

# Product Name

LocalForge AI

Alternative names:
- CodeNexus
- DevPilot Local
- NeonCoder
- DBZS Code Assistant
- ForgeMind

---

# Core Goal

Create a desktop application that works as a local AI-powered coding assistant.

The app should help users:

- create new projects
- inspect existing codebases
- edit files
- generate code
- refactor code
- explain code
- debug errors
- run terminal commands
- manage local AI models
- chat with project-aware AI agents
- use multiple coding agents
- maintain project memory
- generate documentation
- create tests
- analyze architecture
- review code quality
- manage tasks from idea to release

The application must work offline with local models, but should optionally support external providers.

---

# Core Philosophy

The app is not just a chatbot.

It is:

- a local AI IDE companion
- a project-aware coding cockpit
- a modular desktop AI runtime
- an agent-based developer workspace
- a local-first automation environment

Always prioritize:

- local execution
- privacy
- modularity
- extensibility
- maintainability
- speed
- clear architecture
- beautiful UI/UX
- real functionality
- production-ready implementation

Avoid fake placeholders.

Every feature should be designed as if it will become part of a real commercial-grade developer tool.

---

# Target Platform

Build as a desktop app.

Preferred stack:

## Frontend
- Electron
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Zustand or Redux Toolkit
- Monaco Editor

## Backend / Runtime
- Python or Node.js
- Local API bridge
- llama.cpp / llama-server support
- Ollama support
- OpenAI-compatible provider support
- SQLite for local data
- File system access
- Local process management

## Optional
- Tauri instead of Electron
- FastAPI backend
- WebSocket event system
- LangGraph or custom agent orchestration
- ChromaDB or SQLite vector search

---

# Required Main Features

## 1. Project Workspace

The user must be able to:

- create a new coding project
- open an existing folder
- scan project structure
- inspect files
- search files
- open files in tabs
- edit files
- save files
- view git status
- see project metadata
- generate project summaries

The AI must understand:

- folder structure
- selected files
- active file
- open tabs
- project language
- dependencies
- README
- package files
- build scripts
- error logs

---

## 2. AI Chat Panel

Create a project-aware AI chat system.

The chat should support:

- general questions
- selected-code context
- current-file context
- whole-project context
- terminal-output context
- error-message context
- documentation context

Modes:

- Ask
- Explain
- Refactor
- Debug
- Generate
- Review
- Test
- Document
- Architect

The assistant must always know what context it is using.

---

## 3. Local Model Manager

Create a model management section.

Features:

- detect installed local models
- connect to llama-server
- connect to Ollama
- start/stop local model runtime
- show model status
- show memory usage if possible
- select active model
- configure temperature
- configure context length
- configure max tokens
- configure system prompt

Support provider abstraction:

- Local llama-server
- Ollama
- OpenAI-compatible API
- Custom endpoint

---

## 4. Agent System

Implement multiple specialized coding agents.

Agents:

## Architect Agent
Responsible for:
- project planning
- architecture decisions
- folder structures
- scalability suggestions

## Coder Agent
Responsible for:
- code generation
- implementation
- file editing suggestions

## Refactor Agent
Responsible for:
- cleaning code
- splitting modules
- improving maintainability

## Debug Agent
Responsible for:
- analyzing errors
- reading logs
- proposing fixes

## Test Agent
Responsible for:
- unit tests
- integration tests
- test strategies

## Docs Agent
Responsible for:
- README files
- API docs
- architecture docs
- inline documentation

## Security Agent
Responsible for:
- insecure patterns
- dependency risks
- dangerous commands
- secret exposure

Agents must be modular and replaceable.

Each agent should have:

- name
- purpose
- system prompt
- allowed tools
- context rules
- output format

---

## 5. File Editing System

The AI must not blindly overwrite files.

Implement safe file operations:

- propose changes
- show diffs
- let user accept/reject
- backup before editing
- allow undo
- show affected files
- track applied changes

Required file tools:

- read file
- write file
- create file
- delete file
- rename file
- create folder
- search in files
- replace text
- apply patch

---

## 6. Terminal Integration

Add an integrated terminal panel.

Features:

- run commands
- capture output
- send output to AI
- explain errors
- suggest fixes
- detect failed commands
- warn before dangerous commands

Dangerous commands must require confirmation.

Examples:

- rm -rf
- format
- delete
- chmod recursive
- destructive git commands

---

## 7. Git Integration

Add basic Git tools.

Features:

- show branch
- show changed files
- show diffs
- stage files
- commit changes
- generate commit messages
- explain git errors
- create branch
- view history

AI features:

- summarize changes
- generate commit message
- review diff
- detect risky changes

---

## 8. Project Memory

Create persistent local project memory.

Store:

- project summary
- user goals
- decisions
- architecture notes
- active tasks
- completed tasks
- known issues
- coding preferences
- model settings

Memory must be stored locally.

Use:

- SQLite
- JSON files
- optional vector database

Memory should be editable by the user.

---

## 9. Task System

Add a task/project planning board.

Features:

- create tasks
- break ideas into steps
- assign tasks to agents
- track progress
- mark done
- link task to files
- generate implementation plan

Views:

- Backlog
- In Progress
- Review
- Done

AI should be able to create task breakdowns from a user idea.

---

## 10. Documentation Generator

The app should generate:

- README.md
- ARCHITECTURE.md
- API.md
- SETUP.md
- CHANGELOG.md
- AGENTS.md
- CONTRIBUTING.md
- SECURITY.md

Documentation should be based on actual project files, not generic assumptions.

---

## 11. Code Analysis

Implement static project analysis.

Analyze:

- languages used
- dependencies
- file structure
- large files
- duplicated logic
- missing tests
- risky code
- TODO comments
- outdated docs
- architecture smells

Show results in a dashboard.

---

## 12. UI/UX Requirements

The UI must feel like a modern futuristic developer cockpit.

Layout:

- left sidebar: project files
- center: editor
- right panel: AI chat / agents
- bottom panel: terminal / logs / git
- top bar: model status, project status, quick actions

Design style:

- dark mode first
- clean typography
- neon/cyber-inspired accents
- subtle glass panels
- clear hierarchy
- fast interactions
- no clutter
- responsive layout

Important UI components:

- file explorer
- tabbed editor
- AI chat
- model selector
- agent selector
- terminal
- git panel
- task board
- settings
- diff viewer
- command palette

---

# Required Pages / Views

Create these views:

1. Welcome / Start Screen
2. Project Workspace
3. AI Chat
4. Agents Dashboard
5. Model Manager
6. Settings
7. Task Board
8. Git Panel
9. Documentation Center
10. Runtime Monitor
11. Plugin / Module Manager

---

# Settings

Add settings for:

- active model
- provider endpoint
- API keys if external providers are used
- temperature
- context size
- max tokens
- auto-save
- theme
- editor font size
- terminal shell
- project memory
- telemetry disabled by default
- safe command confirmation

Privacy is mandatory.

No code, prompts, file contents, logs, or project data may leave the machine unless the user explicitly enables an external provider.

---

# Architecture Requirements

Use a clean layered architecture.

Separate:

- UI components
- state management
- services
- AI providers
- agents
- filesystem tools
- terminal tools
- git tools
- memory system
- database
- runtime manager
- settings manager

Suggested structure:

```txt
localforge-ai/
  apps/
    desktop/
      src/
        components/
        views/
        layouts/
        editor/
        chat/
        agents/
        terminal/
        git/
        settings/
        styles/
  packages/
    core/
      src/
        agents/
        providers/
        runtime/
        filesystem/
        memory/
        project/
        tools/
        security/
        events/
    shared/
      src/
        types/
        schemas/
        constants/
  backend/
    src/
      api/
      runtime/
      filesystem/
      git/
      terminal/
      memory/
      models/
  docs/
    AGENTS.md
    ARCHITECTURE.md
    API.md
    SETUP.md
````

---

# Backend Services

Create services for:

## ProjectService

* open project
* scan project
* detect language
* summarize project

## FileSystemService

* read/write files
* create/delete files
* search files
* apply patches

## AIProviderService

* connect to local/external models
* send prompts
* stream responses

## AgentService

* route tasks to agents
* load agent prompts
* manage agent context

## RuntimeService

* start/stop local runtimes
* check model status
* monitor health

## MemoryService

* store project memory
* retrieve context
* update decisions

## GitService

* status
* diff
* commit
* branch
* log

## TerminalService

* execute commands
* stream output
* detect errors

## SecurityService

* validate commands
* block dangerous operations
* detect secrets

---

# AI Prompting Rules

Every AI request must include:

* user intent
* current project
* active file
* selected code if available
* relevant files
* task context
* output format
* safety constraints

The AI must return structured output when editing files.

Example format:

```json
{
  "summary": "What will be changed",
  "files": [
    {
      "path": "src/example.ts",
      "action": "modify",
      "patch": "..."
    }
  ],
  "commands": [],
  "risks": [],
  "next_steps": []
}
```

---

# Security Rules

The app must:

* run local-first
* never upload project files without consent
* confirm destructive commands
* detect secret-like strings
* sandbox risky operations where possible
* log AI file changes
* allow rollback
* avoid hidden background actions

Dangerous actions require explicit user confirmation.

---

# Development Phases

Build the project in phases.

## Phase 1: Foundation

Create:

* project structure
* desktop shell
* routing
* layout system
* theme system
* settings store
* basic file explorer

## Phase 2: Editor

Create:

* Monaco editor
* tab system
* file open/save
* dirty state tracking
* keyboard shortcuts

## Phase 3: AI Provider Layer

Create:

* provider interface
* local endpoint support
* Ollama support
* llama-server support
* streaming responses
* model selector

## Phase 4: Chat System

Create:

* AI chat panel
* message history
* context selector
* streaming UI
* prompt templates

## Phase 5: Agent System

Create:

* agent registry
* specialized agents
* agent routing
* agent prompts
* task execution flow

## Phase 6: File Tools

Create:

* read/write/create/delete operations
* diff viewer
* patch application
* undo/backup system

## Phase 7: Terminal & Git

Create:

* terminal panel
* command execution
* safety checks
* git status
* git diff
* commit message generator

## Phase 8: Memory

Create:

* SQLite database
* project memory
* decisions log
* task memory
* preferences

## Phase 9: Task Board

Create:

* task creation
* AI task breakdown
* task status
* file links
* agent assignment

## Phase 10: Documentation & Analysis

Create:

* README generator
* architecture docs generator
* code analysis dashboard
* dependency analyzer

## Phase 11: Polish

Create:

* command palette
* keyboard shortcuts
* runtime monitor
* beautiful UI animations
* onboarding
* error boundaries

## Phase 12: Packaging

Create:

* app packaging
* installer builds
* update strategy
* production config
* release docs

---

# Acceptance Criteria

The final app must allow a user to:

1. open a local project
2. inspect files
3. edit code
4. ask the AI about the project
5. generate code
6. apply AI-generated patches safely
7. run terminal commands
8. debug command errors
9. manage local AI models
10. use specialized coding agents
11. generate documentation
12. create and manage coding tasks
13. commit changes with AI-generated messages
14. work offline with local models

---

# Output Requirements

When implementing this project, always provide:

* folder structure
* installation commands
* full source files
* explanation of each module
* integration steps
* testing steps
* run commands
* next development steps

Never provide only vague architecture.

Always generate real, usable implementation.

Work incrementally.

Start with Phase 1 and continue phase by phase until the app is complete.

Use the MASTER PROMPT as the full product specification.

Now implement Phase 1 only:
- project structure
- Electron + React + TypeScript setup
- dark futuristic layout
- sidebar
- editor placeholder
- AI panel placeholder
- bottom terminal placeholder
- settings store

Return full file structure and all necessary files.
