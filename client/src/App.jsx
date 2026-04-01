import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toReactFlowElements } from "./lib/graphTransform";

const DEFAULT_TARGET_PATH = "../sample-project";
const DEFAULT_QUESTION = "What happens when user logs in?";
const QUICK_QUESTIONS = [
  "Give me a summary of this codebase flow",
  "Which routes are related to auth?",
  "What happens when user logs in?"
];

function Metric({ label, value }) {
  return (
    <div className="metric-pill">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

Metric.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired
};

function QueryResult({ answer, onHighlightFlow, onAskSuggestion }) {
  if (!answer) {
    return (
      <p className="panel-empty">
        Ask a question to query the latest analysis result in natural language.
      </p>
    );
  }

  if (answer.type === "summary") {
    const summary = answer.data || {};

    return (
      <div className="query-result-wrap">
        <h4>Summary</h4>
        <div className="query-stat-grid">
          <div>
            <span>Files</span>
            <strong>{summary.filesScanned ?? 0}</strong>
          </div>
          <div>
            <span>API Calls</span>
            <strong>{summary.apiCalls ?? 0}</strong>
          </div>
          <div>
            <span>Routes</span>
            <strong>{summary.expressRoutes ?? 0}</strong>
          </div>
          <div>
            <span>Flows</span>
            <strong>{summary.flows ?? 0}</strong>
          </div>
        </div>
      </div>
    );
  }

  if (answer.type === "auth_routes") {
    const routes = answer.data?.routes || [];
    const relatedFlows = answer.data?.relatedFlows || [];

    return (
      <div className="query-result-wrap">
        <h4>Auth Routes</h4>
        {routes.length > 0 ? (
          <ul className="query-list">
            {routes.map((route) => (
              <li key={`${route.filePath}:${route.line}:${route.path}`}>
                <strong>
                  {route.method} {route.path}
                </strong>
                <span>
                  {route.filePath}:{route.line || "-"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-empty">No auth-specific routes found.</p>
        )}

        {relatedFlows.length > 0 ? (
          <div className="query-flow-actions">
            <p>Related flows</p>
            {relatedFlows.map((flow) => (
              <button
                key={flow.id}
                type="button"
                className="query-action"
                onClick={() => onHighlightFlow(flow.id)}
              >
                Highlight {flow.frontendAction.method} {flow.frontendAction.endpoint}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (answer.type === "flow_match") {
    const flowMatches = answer.data || [];

    return (
      <div className="query-result-wrap">
        <h4>Matched Flows</h4>
        <ul className="query-list">
          {flowMatches.map((flow) => (
            <li key={flow.id}>
              <strong>
                {flow.frontendAction.method} {flow.frontendAction.endpoint}
              </strong>
              <span>
                {flow.backendRoute.method} {flow.backendRoute.path}
              </span>
              <button
                type="button"
                className="query-action"
                onClick={() => onHighlightFlow(flow.id)}
              >
                Highlight Flow
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const fallbackMessage = answer.data?.message || "No answer available.";
  const suggestions = answer.data?.suggestions || [];

  return (
    <div className="query-result-wrap">
      <h4>No Direct Match</h4>
      <p className="panel-empty">{fallbackMessage}</p>
      {suggestions.length > 0 ? (
        <div className="query-flow-actions">
          <p>Try one of these</p>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="query-action"
              onClick={() => onAskSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

QueryResult.propTypes = {
  answer: PropTypes.shape({
    type: PropTypes.string,
    data: PropTypes.any,
    highlights: PropTypes.object
  }),
  onHighlightFlow: PropTypes.func.isRequired,
  onAskSuggestion: PropTypes.func.isRequired
};

export default function App() {
  const [targetPath, setTargetPath] = useState(DEFAULT_TARGET_PATH);
  const [analysis, setAnalysis] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFlowId, setActiveFlowId] = useState("");
  const [activeNodeId, setActiveNodeId] = useState("");
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [queryAnswer, setQueryAnswer] = useState(null);
  const [queryError, setQueryError] = useState("");
  const [isQueryLoading, setIsQueryLoading] = useState(false);

  const flows = analysis?.flows?.items || [];
  const hasAnalysis = Boolean(analysis);

  const activeFlow = useMemo(
    () => flows.find((flow) => flow.id === activeFlowId) || null,
    [flows, activeFlowId]
  );

  const activeNode = useMemo(
    () => analysis?.graph?.nodes?.find((node) => node.id === activeNodeId) || null,
    [analysis, activeNodeId]
  );

  const graphElements = useMemo(
    () => toReactFlowElements(analysis?.graph, activeFlowId, activeNodeId),
    [analysis, activeFlowId, activeNodeId]
  );

  async function runAnalysis(event) {
    event.preventDefault();

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ targetPath })
      });

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Analyzer request failed");
      }

      setAnalysis(payload);
      setActiveNodeId("");
      setActiveFlowId(payload.flows?.items?.[0]?.id || "");
      setQueryAnswer(null);
      setQueryError("");
    } catch (requestError) {
      setAnalysis(null);
      setActiveFlowId("");
      setActiveNodeId("");
      setQueryAnswer(null);
      setQueryError("");
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }

  function highlightFlow(flowId) {
    setActiveFlowId(flowId);
    setActiveNodeId("");
  }

  async function submitQuery(nextQuestion) {
    const trimmedQuestion = (nextQuestion || "").trim();

    if (!analysis) {
      setQueryError("Run analysis before querying.");
      return;
    }

    if (!trimmedQuestion) {
      setQueryError("Please enter a question.");
      return;
    }

    setQuestion(trimmedQuestion);
    setIsQueryLoading(true);
    setQueryError("");

    try {
      const response = await fetch("/api/analyze/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: trimmedQuestion,
          analysis
        })
      });

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Query request failed");
      }

      setQueryAnswer(payload.answer);

      const firstFlowId = payload.answer?.highlights?.flowIds?.[0];
      if (firstFlowId) {
        highlightFlow(firstFlowId);
      }
    } catch (requestError) {
      setQueryAnswer(null);
      setQueryError(requestError.message);
    } finally {
      setIsQueryLoading(false);
    }
  }

  function handleQuerySubmit(event) {
    event.preventDefault();
    void submitQuery(question);
  }

  let flowPanelContent = <p className="panel-empty">Run an analysis to populate connected flows.</p>;

  if (hasAnalysis && flows.length === 0) {
    flowPanelContent = (
      <p className="panel-empty">No API-to-route matches were found for this target path.</p>
    );
  }

  if (hasAnalysis && flows.length > 0) {
    flowPanelContent = (
      <ul className="flow-list">
        {flows.map((flow, index) => {
          const isActive = flow.id === activeFlowId;

          return (
            <li key={flow.id}>
              <button
                type="button"
                className={isActive ? "flow-item active" : "flow-item"}
                onClick={() => {
                  setActiveFlowId(flow.id);
                  setActiveNodeId("");
                }}
              >
                <span className="flow-index">Flow {index + 1}</span>
                <strong>
                  {flow.frontendAction.method} {flow.frontendAction.endpoint}
                </strong>
                <span>
                  {flow.backendRoute.method} {flow.backendRoute.path}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  const graphPanelContent = hasAnalysis ? (
    <div className="canvas-wrap">
      <ReactFlowProvider>
        <ReactFlow
          nodes={graphElements.nodes}
          edges={graphElements.edges}
          onNodeClick={(_event, node) => {
            setActiveNodeId(node.id);
          }}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap nodeBorderRadius={12} pannable zoomable />
          <Controls position="bottom-right" />
          <Background gap={24} size={1.2} color="#cbd5e1" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  ) : (
    <div className="panel-empty graph-empty">
      Visualization is waiting for analyzer output.
    </div>
  );

  return (
    <div className="app-shell">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />

      <header className="hero">
        <p className="eyebrow">Module 3 · Natural Language Querying</p>
        <h1>Trace Full-Stack Execution Like a Transit Map</h1>
        <p className="hero-copy">
          Analyze any MERN project path, render API-to-route-to-model links, and
          ask natural-language questions to jump directly to the relevant flow.
        </p>
      </header>

      <section className="control-strip">
        <form onSubmit={runAnalysis} className="analyze-form">
          <label htmlFor="target-path">Target Path</label>
          <div className="form-row">
            <input
              id="target-path"
              value={targetPath}
              onChange={(event) => setTargetPath(event.target.value)}
              placeholder="../sample-project"
              autoComplete="off"
            />
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Analyzing..." : "Analyze Codebase"}
            </button>
          </div>
        </form>

        <div className="metrics-grid">
          <Metric label="Files Scanned" value={analysis?.parsed?.filesScanned ?? "-"} />
          <Metric
            label="API Calls"
            value={analysis?.parsed?.frontendApiCalls?.length ?? "-"}
          />
          <Metric
            label="Backend Routes"
            value={analysis?.parsed?.expressRoutes?.length ?? "-"}
          />
          <Metric label="Matched Flows" value={analysis?.flows?.count ?? "-"} />
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      <main className="workspace-grid">
        <aside className="panel flow-panel">
          <div className="panel-header">
            <h2>Execution Flows</h2>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setActiveFlowId("");
                setActiveNodeId("");
              }}
            >
              Clear Highlight
            </button>
          </div>

          {flowPanelContent}
        </aside>

        <section className="panel graph-panel">
          <div className="panel-header">
            <h2>Flow Graph</h2>
            <span>Click nodes to inspect local context</span>
          </div>

          {graphPanelContent}
        </section>

        <aside className="panel detail-panel">
          <div className="panel-header">
            <h2>Inspector</h2>
            <span>Node and flow metadata</span>
          </div>

          {activeFlow ? (
            <div className="detail-block">
              <h3>Active Flow Steps</h3>
              <ol>
                {activeFlow.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="panel-empty">Select a flow from the left panel to highlight a full path.</p>
          )}

          {activeNode ? (
            <div className="detail-block">
              <h3>Selected Node</h3>
              <p>
                <strong>Label:</strong> {activeNode.label}
              </p>
              <p>
                <strong>Type:</strong> {activeNode.type}
              </p>
              <p>
                <strong>File:</strong> {activeNode.meta?.filePath || "-"}
              </p>
              <p>
                <strong>Line:</strong> {activeNode.meta?.line || "-"}
              </p>
            </div>
          ) : (
            <p className="panel-empty">Click a graph node to inspect exact source metadata.</p>
          )}

          <div className="detail-block">
            <h3>Query Agent</h3>
            <form className="query-form" onSubmit={handleQuerySubmit}>
              <label htmlFor="query-input">Ask a flow question</label>
              <textarea
                id="query-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What happens when user logs in?"
                rows={3}
              />
              <button type="submit" disabled={isQueryLoading || !hasAnalysis}>
                {isQueryLoading ? "Thinking..." : "Ask Query Agent"}
              </button>
            </form>

            <div className="quick-query-row">
              {QUICK_QUESTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="quick-query-chip"
                  onClick={() => {
                    void submitQuery(item);
                  }}
                  disabled={isQueryLoading || !hasAnalysis}
                >
                  {item}
                </button>
              ))}
            </div>

            {queryError ? <p className="query-error">{queryError}</p> : null}

            <QueryResult
              answer={queryAnswer}
              onHighlightFlow={highlightFlow}
              onAskSuggestion={(suggestion) => {
                void submitQuery(suggestion);
              }}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
