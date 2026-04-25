# Cuddly Winner | An OpenCode Karpathy Loop

This repository implements the **"Karpathy Loop,"** an autonomous machine learning research and code optimization cycle.  
It is orchestrated using **OpenCode**, an open-source, provider-agnostic AI coding agent.

By leveraging OpenCode's custom agent capabilities and multi-model support, this project automates the execution, evaluation, and iteration of ML experiments while strictly preventing the agent from "reward hacking."

---

## 🏗 Architecture: The Three-File Contract

To maintain operational integrity and ensure every experiment is objectively comparable, this project enforces a rigid **"three-file contract"** between human intent and machine execution.

### 🔒 `prepare.py` (The Immutable Judge)
This file is strictly frozen. It defines the exact data loading protocols and validation metrics (e.g., bits-per-byte).  
**The agent is never allowed to edit this file.**

### 🧬 `train.py` (The Evolutionary Target)
This is the fully mutable file. The OpenCode agent has full access to:
- Rewrite model architectures  
- Swap optimizers (e.g., AdamW or Muon)  
- Tune hyperparameters  

### 🧠 `program.md` (The Research Strategy)
The natural language strategy protocol. It defines:
- Agent instructions  
- Git isolation workflows  
- Log analysis rules  
- Experiment stopping criteria  

---

## 📂 Project Structure

```text
├── .opencode/
│   └── agents/
│       └── researcher.md  # OpenCode custom agent config (YAML frontmatter + instructions)
├── data/                  # Dataset directory (ignored by agent)
├── logs/                  # Output logs for agent to analyze
├── prepare.py             # DO NOT TOUCH - Validation & data loading
├── train.py               # Agent's playground - Neural net architecture
└── program.md             # The core loop instructions
```

---

## 🚀 Setup & Execution

### 1. Install OpenCode

If you haven't already, install the OpenCode CLI.  
OpenCode runs locally in your terminal and keeps your workflow entirely within your codebase.

```bash
curl -sS https://opencode.ai/install | bash
```

---

### 2. Configure the LLM Provider

OpenCode supports over 75 LLM providers, allowing you to choose the "brain" for your loop based on your budget and reasoning requirements.

#### ☁️ Cloud (Deep Reasoning)
For complex architectural leaps, configure OpenCode to use frontier models like:
- Claude Opus 4.6 (best for planning and architecture decisions)  
- Claude Sonnet 4.6 (best for fast, reliable code generation)  

#### 🖥️ Local (Offline / Free)
To run long autonomous loops without high API costs, configure OpenCode to use an **Ollama backend**.

Recommended models:
- Qwen3-Coder (8B or 32B)  
  - Native 256K token context window  
  - Strong tool-calling capabilities  

---

### 3. Run the Autonomous Loop

OpenCode uses a markdown-based prompt system with YAML frontmatter to define custom agents.  
The `.opencode/agents/researcher.md` file in this repo restricts the agent to the rules in `program.md`.

Start OpenCode in your terminal:

```bash
opencode
```

Invoke the researcher agent:

```text
@researcher
```

Then instruct it to begin the loop:

```text
Read program.md. Execute the Karpathy Loop by modifying train.py, running the experiment for a maximum of 5 minutes, and logging the results. Repeat until the metric improves.
```

---

## 🛡️ Safety & Guardrails

### ⏱️ Time Limits
Every experiment run via `train.py` must have a strict wall-clock time budget enforced in the script to ensure rapid, comparable iterations.

### 🔄 Version Control
- Commit your baseline before starting the loop  
- Use OpenCode’s Git-based undo/redo safety nets  
- Revert any non-improving architectural regressions  

---
