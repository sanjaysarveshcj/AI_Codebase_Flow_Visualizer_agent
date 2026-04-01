# 🚀 AI Codebase Flow Visualizer Agent

An intelligent **multi-agent AI system** that analyzes and visualizes the execution flow of a full-stack MERN application.
It helps developers understand how frontend actions propagate through APIs, backend logic, and database operations — all in an interactive and queryable format.

---

## 🧠 Problem Statement

Modern MERN applications are complex:

* Frontend → backend connections are hidden inside API calls
* Logic is distributed across multiple files
* Debugging and onboarding take significant time

❗ Developers often struggle to answer:

> “What happens when I click this button?”

---

## 💡 Solution

This project introduces an **AI-powered codebase analyzer** that:

* Parses the entire codebase using AST
* Connects frontend, backend, and database logic
* Generates a **visual execution graph**
* Allows **natural language queries** on code flow

---

## 🏗️ System Architecture

The system follows a **multi-agent architecture**:

### 🔹 Parser Agent

* Extracts:

  * React routes
  * API calls (Axios/Fetch)
  * Express routes
  * Controllers & middleware
  * Mongoose models

---

### 🔹 Flow Reasoning Agent

* Connects extracted components into logical execution paths
* Understands how data flows across layers

---

### 🔹 Graph Builder Agent

* Converts execution flow into a graph structure
* Nodes: Components (UI, API, Controller, DB)
* Edges: Flow of execution

---

### 🔹 Visualization Agent

* Renders an **interactive graph UI**
* Enables:

  * Zoom & navigation
  * Node inspection
  * Flow highlighting

---

### 🔹 Query Agent (Key Feature)

* Accepts natural language queries:

  * “What happens when user logs in?”
  * “Which APIs use authentication?”
  * “Where is this state updated?”

---

## 🔥 Key Features

* ✅ Full-stack flow visualization (Frontend → Backend → DB)
* ✅ Click-to-trace execution paths
* ✅ Middleware detection (auth, error handlers)
* ✅ Natural language querying
* ✅ Explainable flow traces with confidence scoring
* ✅ Multi-flow comparison insights from natural-language queries
* ✅ Step-by-step path playback in graph UI
* ✅ Interactive graph-based UI
* ✅ Scalable for large codebases

---

## ✅ Current Implementation Status (April 2026)

### Module 1: Backend Analyzer (Completed)

Implemented in this repository:

* `server/` Express backend with analyzer endpoints
* AST parsing for:

   * Axios/Fetch API calls
   * Express routes
   * React routes
   * Mongoose models
* Flow linking between frontend API calls and backend routes
* Graph JSON builder (nodes + edges)
* Query endpoint with summary/auth/keyword flow matching

Available endpoints:

* `GET /health`
* `POST /api/analyze`
* `POST /api/analyze/query`

Included demo input:

* `sample-project/` with a login flow (`axios.post('/api/auth/login')` -> Express route)

### Module 2: Interactive Visualization UI (Completed)

Implemented in this repository:

* `client/` Vite + React + React Flow app
* Analyze form wired to `POST /api/analyze`
* Interactive graph rendering for analyzer nodes/edges
* Click-to-trace flow highlighting
* Node inspector with source file + line metadata

### Module 3: Natural Language Querying (Completed)

Implemented in this repository:

* Query panel in `client/` wired to `POST /api/analyze/query`
* Natural-language question input + quick query prompts
* Typed query responses:

   * `summary`
   * `auth_routes`
   * `flow_match`
   * `fallback` with suggestions
* Query result actions that auto-highlight matched flows in the graph
* Improved query matching in `server/agents/queryAgent.js` using token-based scoring

### Module 4: Advanced Execution Tracing (Completed)

Implemented in this repository:

* Middleware chain extraction from Express routes
* Controller function resolution from route handlers
* Mongoose operation extraction with enclosing function context
* Extended flow reasoning:

   * `Frontend API -> Route -> Middleware -> Controller -> DB Operation`
* Extended graph node types:

   * `middleware`
   * `controller`
   * `db_operation`
* Extended sample project with middleware-protected profile route
* Dead code detection heuristics for:

   * potentially unused server functions
   * unlinked backend routes
   * unused mongoose models
   * unmatched frontend API calls

### Module 5: Indirect Function-Call Tracing (Completed)

Implemented in this repository:

* Function invocation extraction with caller context
* Internal function call-graph construction
* Reachability tracing from route controller handlers
* Extended flow reasoning to include helper-function chains:

   * `Frontend API -> Route -> Middleware -> Controller -> Helper Function(s) -> DB Operation`
* Extended graph node type:

   * `function` (helper/internal function)
* DB operation linking now supports indirect helper calls

### Module 6: Explainable Flow Intelligence (Completed)

Implemented in this repository:

* Per-flow confidence scoring in execution reasoning (`high` / `medium` / `low`)
* Confidence rationale signals (route match quality, controller resolution, helper-chain traceability, DB linkage)
* Structured execution path metadata for each flow (`executionPath` + `narrative`)
* Query intent for explanation requests:

   * Example: `Explain flow for /api/auth/profile`
   * Returns typed response: `flow_explain`
* UI upgrades in `client/`:

   * Flow list confidence badges
   * Inspector confidence + rationale details
   * Query result rendering for explain responses

### Module 7: Confidence Calibration + Compare + Playback (Completed)

Implemented in this repository:

* Calibrated confidence scoring in execution reasoning with weighted evidence breakdown:

   * route match quality
   * middleware chain evidence
   * controller resolution quality
   * helper-function traceability
   * DB linkage confidence
* Query intent for flow comparison requests:

   * Example: `Compare login and profile flows`
   * Returns typed response: `flow_compare`
   * Includes dimension-wise comparison and summary insights
* UI playback mode in `client/`:

   * step-by-step execution path playback controls
   * play / pause / step-forward / step-back / reset actions
   * graph highlight progression for node and edge path traversal

---

## 🧪 Example Flow Output

```
Login Button
   ↓
handleLogin()
   ↓
axios.post('/api/auth/login')
   ↓
requestLogger middleware
   ↓
authController.login
   ↓
UserModel.findOne()
   ↓
JWT Token Generated
```

---

## 🧩 Tech Stack

### 🖥️ Frontend

* React.js
* Vite
* Custom CSS UI
* React Flow (Graph Visualization)

### ⚙️ Backend

* Node.js
* Express.js

### 🤖 AI Layer

* OpenAI / LLM APIs
* LangChain / LangGraph / CrewAI

### 📂 Code Parsing

* Babel Parser (AST)
* Tree-sitter (optional)

---

## 📁 Project Structure

```
ai-flow-visualizer/
│
├── client/              # React frontend
│
├── server/
│   ├── agents/
│   │   ├── parserAgent.js
│   │   ├── flowAgent.js
│   │   ├── graphBuilderAgent.js
│   │   ├── queryAgent.js
│   │
│   ├── utils/
│   │   ├── astParser.js
│   │
│   ├── routes/
│   └── app.js
│
├── sample-project/      # Sample MERN app for testing
│
└── README.md
```

---

## ⚡ Installation & Setup

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/your-username/ai-flow-visualizer.git
cd ai-flow-visualizer
```

### 2️⃣ Install Dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 3️⃣ Run the Application

```bash
# Terminal 1: start backend
cd server
npm start

# Terminal 2: start frontend
cd client
npm run dev
```

### 4️⃣ Test with Sample Project

Use `sample-project/` as an analysis target:

```bash
curl -X POST http://localhost:4000/api/analyze \
   -H "Content-Type: application/json" \
   -d '{"targetPath":"./sample-project"}'

# Open UI
http://localhost:5173
```

---

## 🎯 MVP Roadmap

### Phase 1

* Parse Express routes
* Extract frontend API calls
* Display basic flow (text format)

### Phase 2

* Build graph visualization
* Connect frontend to backend

### Phase 3

* Integrate AI reasoning
* Enable natural language queries

### Phase 4 (Advanced)

* ✅ Middleware tracking
* ✅ Database interaction mapping
* ✅ Dead code detection

---

## 🧠 Challenges

* Handling dynamic routes (`/api/:id`)
* Tracking indirect function calls
* Scaling for large codebases
* Managing async flows

---

## 🚀 Future Enhancements

* 🔍 Debugging assistant (trace errors automatically)
* 🛡️ Security vulnerability detection
* ⚡ Performance bottleneck analysis
* 📊 Codebase analytics dashboard

---

## 📌 Use Cases

* Developer onboarding
* Debugging complex flows
* Code reviews
* System design understanding

---

## 🤝 Contributing

Contributions are welcome!
Feel free to fork the repo and submit pull requests.

---

## ⭐ Acknowledgements

* OpenAI / LLM APIs
* React Flow
* Babel Parser

---

## 📬 Contact

For questions or collaboration:
📧 [sanjaysarveshcj@gmail.com](mailto:sanjaysarveshcj@gmail.com)

---

**⭐ If you find this project useful, consider giving it a star!**
