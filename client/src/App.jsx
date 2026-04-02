import { useEffect, useMemo, useRef, useState } from "react";
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
  "What happens when user logs in?",
  "Explain flow for /api/auth/profile",
  "Compare login and profile flows",
  "Show dead code candidates"
];
const PLAYBACK_INTERVAL_MS = 1100;
const SOURCE_FILE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const UPLOAD_MAX_FILE_COUNT = 1400;
const UPLOAD_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const DEFAULT_DOC_TITLE = "AI Flow Visualizer Auto Docs";
const DIRECTORY_INPUT_ATTRIBUTES = {
  webkitdirectory: "",
  directory: ""
};
const IGNORED_UPLOAD_SEGMENTS = [
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.next/",
  "/coverage/",
  "/.git/"
];

const EXECUTION_TO_NODE_TYPE = {
  frontend_api: "api_call",
  backend_route: "express_route",
  middleware: "middleware",
  controller: "controller",
  function: "function",
  db_operation: "db_operation"
};

function normalizeLabel(value) {
  return (value || "").toString().trim().toLowerCase();
}

function normalizeUploadPath(relativePath) {
  if (!relativePath) {
    return "";
  }

  return relativePath
    .toString()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .trim();
}

function shouldIgnoreUploadedPath(relativePath) {
  const normalized = `/${normalizeUploadPath(relativePath)}`;

  return IGNORED_UPLOAD_SEGMENTS.some((segment) => normalized.includes(segment));
}

function hasSupportedSourceExtension(relativePath) {
  const normalized = normalizeUploadPath(relativePath);
  const extension = normalized.includes(".")
    ? `.${normalized.split(".").pop().toLowerCase()}`
    : "";

  return SOURCE_FILE_EXTENSIONS.has(extension);
}

async function buildUploadedSourcePayload(fileList) {
  const files = Array.from(fileList || []);
  const sourceFiles = [];
  let skippedFiles = 0;
  let totalBytes = 0;

  for (const file of files) {
    const relativePath = normalizeUploadPath(file.webkitRelativePath || file.name);

    if (!relativePath || shouldIgnoreUploadedPath(relativePath) || !hasSupportedSourceExtension(relativePath)) {
      skippedFiles += 1;
      continue;
    }

    totalBytes += Number(file.size || 0);

    if (sourceFiles.length >= UPLOAD_MAX_FILE_COUNT) {
      throw new Error(`Upload limit reached (${UPLOAD_MAX_FILE_COUNT} files).`);
    }

    if (totalBytes > UPLOAD_MAX_TOTAL_BYTES) {
      throw new Error("Uploaded source files are too large. Keep total source under 16MB.");
    }

    sourceFiles.push({
      relativePath,
      content: await file.text()
    });
  }

  if (sourceFiles.length === 0) {
    throw new Error("No supported source files found in uploaded folder.");
  }

  const firstPath = sourceFiles[0]?.relativePath || "uploaded-folder";
  const sourceLabel = firstPath.includes("/") ? firstPath.split("/")[0] : "uploaded-folder";

  return {
    sourceFiles,
    sourceLabel,
    skippedFiles
  };
}

function confidenceBadgeClass(level) {
  if (level === "high") {
    return "confidence-badge confidence-high";
  }

  if (level === "medium") {
    return "confidence-badge confidence-medium";
  }

  return "confidence-badge confidence-low";
}

function slugifyFileName(value, fallbackName) {
  const candidate = (value || "").toString().trim().toLowerCase();
  const slug = candidate.replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
  return slug || fallbackName;
}

function downloadBlob(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 3000);
}

function decodeBase64ToBlob(base64Value, mimeType) {
  const binary = globalThis.atob(base64Value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) || 0;
  }

  return new Blob([bytes], { type: mimeType });
}

function findStepNodeId(step, nodes, usedNodeIds) {
  const expectedType = EXECUTION_TO_NODE_TYPE[step.type] || step.type;
  const expectedLabel = normalizeLabel(step.label);
  const expectedPath = normalizeLabel(step.filePath);
  const expectedLine = Number(step.line || 0);

  const candidates = nodes.filter((node) => {
    if (node.type !== expectedType) {
      return false;
    }

    return normalizeLabel(node.label) === expectedLabel;
  });

  const scopedCandidates = candidates.filter((node) => {
    const nodePath = normalizeLabel(node.meta?.filePath);
    const nodeLine = Number(node.meta?.line || 0);

    if (expectedPath && nodePath && expectedPath !== nodePath) {
      return false;
    }

    if (expectedLine > 0 && nodeLine > 0 && expectedLine !== nodeLine) {
      return false;
    }

    return true;
  });

  const pool = scopedCandidates.length > 0 ? scopedCandidates : candidates;
  const available = pool.find((node) => !usedNodeIds.has(node.id));
  const picked = available || pool[0];

  if (!picked) {
    return null;
  }

  usedNodeIds.add(picked.id);
  return picked.id;
}

function buildPlaybackSequence(flow, graph) {
  if (!flow || !graph?.nodes) {
    return [];
  }

  const usedNodeIds = new Set();

  return (flow.executionPath || [])
    .map((step) => {
      const nodeId = findStepNodeId(step, graph.nodes, usedNodeIds);
      if (!nodeId) {
        return null;
      }

      return {
        ...step,
        nodeId
      };
    })
    .filter(Boolean);
}

function buildPlaybackHighlight(sequence, playbackIndex, graph, flowId) {
  if (!sequence.length) {
    return {
      nodeIds: [],
      edgeIds: [],
      currentStep: null
    };
  }

  const cappedIndex = Math.min(playbackIndex, sequence.length - 1);
  const activeSequence = sequence.slice(0, cappedIndex + 1);
  const nodeIds = activeSequence.map((step) => step.nodeId);
  const edgeIds = [];
  const edges = graph?.edges || [];

  for (let index = 1; index < activeSequence.length; index += 1) {
    const previousNodeId = activeSequence[index - 1].nodeId;
    const currentNodeId = activeSequence[index].nodeId;

    const matchedEdge = edges.find((edge) => {
      if (edge.source !== previousNodeId || edge.target !== currentNodeId) {
        return false;
      }

      if (!flowId) {
        return true;
      }

      const edgeFlowId = edge.meta?.flowId;
      return !edgeFlowId || edgeFlowId === flowId;
    });

    if (matchedEdge) {
      edgeIds.push(matchedEdge.id);
    }
  }

  return {
    nodeIds,
    edgeIds,
    currentStep: activeSequence[activeSequence.length - 1]
  };
}

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

function renderSummaryAnswer(answer) {
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

function renderAuthRoutesAnswer(answer, onHighlightFlow) {
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

function renderFlowMatchAnswer(answer, onHighlightFlow) {
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

function renderDeadCodeAnswer(answer) {
  const summary = answer.data?.summary || {};
  const functions = answer.data?.potentiallyUnusedFunctions || [];
  const routes = answer.data?.unlinkedRoutes || [];
  const models = answer.data?.unusedModels || [];

  return (
    <div className="query-result-wrap">
      <h4>Dead Code Candidates</h4>
      <div className="query-stat-grid">
        <div>
          <span>Functions</span>
          <strong>{summary.potentiallyUnusedFunctions ?? 0}</strong>
        </div>
        <div>
          <span>Routes</span>
          <strong>{summary.unlinkedRoutes ?? 0}</strong>
        </div>
        <div>
          <span>Models</span>
          <strong>{summary.unusedModels ?? 0}</strong>
        </div>
        <div>
          <span>API Calls</span>
          <strong>{summary.unmatchedApiCalls ?? 0}</strong>
        </div>
      </div>

      {functions.length > 0 ? (
        <ul className="query-list">
          {functions.slice(0, 5).map((item) => (
            <li key={`${item.filePath}:${item.line}:${item.name}`}>
              <strong>{item.name}</strong>
              <span>
                {item.filePath}:{item.line || "-"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {routes.length > 0 ? (
        <ul className="query-list">
          {routes.slice(0, 3).map((item) => (
            <li key={`${item.filePath}:${item.line}:${item.path}`}>
              <strong>
                {item.method} {item.path}
              </strong>
              <span>
                {item.filePath}:{item.line || "-"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {models.length > 0 ? (
        <ul className="query-list">
          {models.slice(0, 3).map((item) => (
            <li key={`${item.filePath}:${item.line}:${item.model}`}>
              <strong>{item.model}</strong>
              <span>
                {item.filePath}:{item.line || "-"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="panel-empty">{answer.data?.caveat}</p>
    </div>
  );
}

function renderFlowExplainAnswer(answer, onHighlightFlow) {
  const explanations = answer.data || [];

  return (
    <div className="query-result-wrap">
      <h4>Flow Explanation</h4>
      <ul className="query-list">
        {explanations.map((item) => (
          <li key={item.id}>
            <strong>{item.entry}</strong>
            <span>{item.route}</span>
            <span>
              Confidence: {item.confidence?.level || "low"} ({item.confidence?.score || 0})
            </span>
            <span>{item.narrative || "No path narrative available."}</span>
            <button
              type="button"
              className="query-action"
              onClick={() => onHighlightFlow(item.id)}
            >
              Highlight Flow
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderFlowCompareAnswer(answer, onHighlightFlow) {
  const comparedFlows = answer.data?.flows || [];
  const comparison = answer.data?.comparison || {};

  return (
    <div className="query-result-wrap">
      <h4>Flow Comparison</h4>
      <ul className="query-list">
        {comparedFlows.map((flow) => (
          <li key={flow.id}>
            <strong>{flow.entry}</strong>
            <span>{flow.route}</span>
            <span>
              Confidence: {flow.confidence?.level || "low"} ({flow.confidence?.score || 0})
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

      {(comparison.dimensions || []).length > 0 ? (
        <div className="compare-grid">
          {(comparison.dimensions || []).map((dimension) => (
            <div key={dimension.name} className="compare-card">
              <h5>{dimension.name}</h5>
              <ul>
                {(dimension.values || []).map((value) => (
                  <li key={`${dimension.name}:${value.flowId}`}>
                    <span>{value.flowId.slice(0, 16)}...</span>
                    <strong>{value.value}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {(comparison.insights || []).length > 0 ? (
        <ul className="confidence-reasons">
          {(comparison.insights || []).map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function renderFallbackAnswer(answer, onAskSuggestion) {
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

function QueryResult({ answer, onHighlightFlow, onAskSuggestion }) {
  if (!answer) {
    return (
      <p className="panel-empty">
        Ask a question to query the latest analysis result in natural language.
      </p>
    );
  }

  let typedContent;

  switch (answer.type) {
    case "summary":
      typedContent = renderSummaryAnswer(answer);
      break;
    case "auth_routes":
      typedContent = renderAuthRoutesAnswer(answer, onHighlightFlow);
      break;
    case "flow_explain":
      typedContent = renderFlowExplainAnswer(answer, onHighlightFlow);
      break;
    case "flow_compare":
      typedContent = renderFlowCompareAnswer(answer, onHighlightFlow);
      break;
    case "flow_match":
      typedContent = renderFlowMatchAnswer(answer, onHighlightFlow);
      break;
    case "dead_code":
      typedContent = renderDeadCodeAnswer(answer);
      break;
    default:
      typedContent = renderFallbackAnswer(answer, onAskSuggestion);
  }

  const answerText = (answer.answerText || "").trim();

  return (
    <div className="query-answer-stack">
      {answerText ? (
        <div className="llm-answer-block">
          <p className="llm-answer-title">Answer</p>
          <p className="llm-answer-text">{answerText}</p>
        </div>
      ) : null}
      {typedContent}
    </div>
  );
}

QueryResult.propTypes = {
  answer: PropTypes.shape({
    type: PropTypes.string,
    data: PropTypes.any,
    highlights: PropTypes.object,
    answerText: PropTypes.string,
    strategy: PropTypes.string,
    llmProvider: PropTypes.string,
    llmModel: PropTypes.string
  }),
  onHighlightFlow: PropTypes.func.isRequired,
  onAskSuggestion: PropTypes.func.isRequired
};

function DocumentationWorkbench({ analysis, hasAnalysis, sourceLabel }) {
  const [docsTitle, setDocsTitle] = useState(DEFAULT_DOC_TITLE);
  const [docsPackage, setDocsPackage] = useState(null);
  const [docsError, setDocsError] = useState("");
  const [isDocsLoading, setIsDocsLoading] = useState(false);

  const baseFileName = useMemo(
    () => slugifyFileName(docsTitle, "ai-flow-visualizer-docs"),
    [docsTitle]
  );

  async function generateDocs(includePdf) {
    if (!hasAnalysis || !analysis) {
      setDocsError("Run analysis before generating documentation.");
      return null;
    }

    setIsDocsLoading(true);
    setDocsError("");

    try {
      const response = await fetch("/api/analyze/docs/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: docsTitle.trim() || DEFAULT_DOC_TITLE,
          analysis,
          includePdf,
          maxFlows: 18
        })
      });

      const payload = await response.json();
      assertApiSuccess(response, payload, "Documentation generation failed");

      setDocsPackage(payload.documentation);
      return payload.documentation;
    } catch (requestError) {
      setDocsPackage(null);
      setDocsError(requestError.message);
      return null;
    } finally {
      setIsDocsLoading(false);
    }
  }

  async function handleGenerateClick() {
    await generateDocs(true);
  }

  async function handleDownloadMarkdown() {
    const docs = docsPackage || (await generateDocs(false));
    if (!docs?.markdown) {
      return;
    }

    downloadBlob(
      new Blob([docs.markdown], { type: "text/markdown;charset=utf-8" }),
      `${baseFileName}.md`
    );
  }

  async function handleDownloadPdf() {
    const docs = docsPackage || (await generateDocs(true));
    if (!docs?.pdfBase64) {
      setDocsError("PDF output is not available. Generate docs with PDF enabled.");
      return;
    }

    const pdfBlob = decodeBase64ToBlob(docs.pdfBase64, "application/pdf");
    const pdfName = docs.pdfFileName || `${baseFileName}.pdf`;
    downloadBlob(pdfBlob, pdfName);
  }

  async function handleOpenSwaggerPreview() {
    const docs = docsPackage || (await generateDocs(false));
    if (!docs?.swaggerUiHtml) {
      return;
    }

    const swaggerBlob = new Blob([docs.swaggerUiHtml], { type: "text/html;charset=utf-8" });
    const swaggerUrl = URL.createObjectURL(swaggerBlob);
    const popup = globalThis.open(swaggerUrl, "_blank", "noopener,noreferrer");

    if (!popup) {
      setDocsError("Popup was blocked. Allow popups and try opening Swagger preview again.");
      return;
    }

    setTimeout(() => {
      URL.revokeObjectURL(swaggerUrl);
    }, 60000);
  }

  const routeCount = docsPackage?.openapi?.paths
    ? Object.keys(docsPackage.openapi.paths).length
    : 0;

  return (
    <section className="panel docs-workbench">
      <div className="panel-header">
        <div>
          <h2>Auto Documentation Generator</h2>
          <span>Build Markdown, PDF, and Swagger-like docs from the latest analysis</span>
        </div>
      </div>

      <div className="docs-controls-grid">
        <label htmlFor="docs-title-input">Document Title</label>
        <input
          id="docs-title-input"
          value={docsTitle}
          onChange={(event) => {
            setDocsTitle(event.target.value);
          }}
          placeholder={DEFAULT_DOC_TITLE}
          disabled={isDocsLoading}
        />
      </div>

      <div className="docs-actions-row">
        <button
          type="button"
          className="query-action"
          onClick={() => {
            void handleGenerateClick();
          }}
          disabled={!hasAnalysis || isDocsLoading}
        >
          {isDocsLoading ? "Generating..." : "Generate Docs"}
        </button>
        <button
          type="button"
          className="query-action"
          onClick={() => {
            void handleDownloadMarkdown();
          }}
          disabled={!hasAnalysis || isDocsLoading}
        >
          Download Markdown
        </button>
        <button
          type="button"
          className="query-action"
          onClick={() => {
            void handleDownloadPdf();
          }}
          disabled={!hasAnalysis || isDocsLoading}
        >
          Download PDF
        </button>
        <button
          type="button"
          className="query-action"
          onClick={() => {
            void handleOpenSwaggerPreview();
          }}
          disabled={!hasAnalysis || isDocsLoading}
        >
          Open Swagger Preview
        </button>
      </div>

      {docsError ? <p className="query-error">{docsError}</p> : null}

      <div className="docs-summary-grid">
        <div>
          <span>Source</span>
          <strong>{sourceLabel || "filesystem-path"}</strong>
        </div>
        <div>
          <span>Routes in OpenAPI</span>
          <strong>{routeCount || "-"}</strong>
        </div>
        <div>
          <span>Markdown Size</span>
          <strong>{docsPackage?.markdown ? `${docsPackage.markdown.length} chars` : "-"}</strong>
        </div>
        <div>
          <span>Generated</span>
          <strong>{docsPackage?.generatedAt ? new Date(docsPackage.generatedAt).toLocaleString() : "-"}</strong>
        </div>
      </div>
    </section>
  );
}

DocumentationWorkbench.propTypes = {
  analysis: PropTypes.object,
  hasAnalysis: PropTypes.bool.isRequired,
  sourceLabel: PropTypes.string
};

DocumentationWorkbench.defaultProps = {
  analysis: null,
  sourceLabel: ""
};

function renderFlowPanelContent(hasAnalysis, flows, activeFlowId, onSelectFlow) {
  if (!hasAnalysis) {
    return <p className="panel-empty">Run an analysis to populate connected flows.</p>;
  }

  if (flows.length === 0) {
    return <p className="panel-empty">No API-to-route matches were found for this target path.</p>;
  }

  return (
    <ul className="flow-list">
      {flows.map((flow, index) => {
        const isActive = flow.id === activeFlowId;

        return (
          <li key={flow.id}>
            <button
              type="button"
              className={isActive ? "flow-item active" : "flow-item"}
              onClick={() => {
                onSelectFlow(flow.id);
              }}
            >
              <span className="flow-index">Flow {index + 1}</span>
              <strong>
                {flow.frontendAction.method} {flow.frontendAction.endpoint}
              </strong>
              <span>
                {flow.backendRoute.method} {flow.backendRoute.path}
              </span>
              <span className={confidenceBadgeClass(flow.confidence?.level)}>
                Confidence: {flow.confidence?.level || "low"} ({flow.confidence?.score || 0})
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function renderGraphPanelContent(hasAnalysis, graphElements, onNodeClick) {
  if (!hasAnalysis) {
    return (
      <div className="panel-empty graph-empty">
        Visualization is waiting for analyzer output.
      </div>
    );
  }

  return (
    <div className="canvas-wrap">
      <ReactFlowProvider>
        <ReactFlow
          nodes={graphElements.nodes}
          edges={graphElements.edges}
          onNodeClick={onNodeClick}
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
  );
}

function assertApiSuccess(response, payload, fallbackMessage) {
  if (response.ok && payload.ok) {
    return;
  }

  throw new Error(payload.message || fallbackMessage);
}

function validateQueryRequest(analysis, question) {
  if (analysis == null) {
    return "Run analysis before querying.";
  }

  if (question.length === 0) {
    return "Please enter a question.";
  }

  return "";
}

function highlightFirstMatchedFlow(answer, onHighlightFlow) {
  const firstFlowId = answer?.highlights?.flowIds?.[0];

  if (firstFlowId) {
    onHighlightFlow(firstFlowId);
  }
}

export default function App() {
  const folderInputRef = useRef(null);
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
  const [isPlaybackRunning, setIsPlaybackRunning] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isGraphExpanded, setIsGraphExpanded] = useState(false);
  const [uploadedSourceFiles, setUploadedSourceFiles] = useState([]);
  const [uploadedSourceLabel, setUploadedSourceLabel] = useState("");
  const [uploadSummary, setUploadSummary] = useState("");
  const [isUploadPreparing, setIsUploadPreparing] = useState(false);

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

  const playbackSequence = useMemo(
    () => buildPlaybackSequence(activeFlow, analysis?.graph),
    [activeFlow, analysis]
  );

  const playbackHighlight = useMemo(
    () => buildPlaybackHighlight(playbackSequence, playbackIndex, analysis?.graph, activeFlowId),
    [playbackSequence, playbackIndex, analysis, activeFlowId]
  );

  useEffect(() => {
    setIsPlaybackRunning(false);
    setPlaybackIndex(0);
  }, [activeFlowId]);

  useEffect(() => {
    if (!isPlaybackRunning || playbackSequence.length === 0) {
      return undefined;
    }

    if (playbackIndex >= playbackSequence.length - 1) {
      setIsPlaybackRunning(false);
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setPlaybackIndex((current) => Math.min(current + 1, playbackSequence.length - 1));
    }, PLAYBACK_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isPlaybackRunning, playbackIndex, playbackSequence]);

  useEffect(() => {
    if (!isGraphExpanded) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setIsGraphExpanded(false);
      }
    }

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [isGraphExpanded]);

  const graphElements = useMemo(
    () => toReactFlowElements(analysis?.graph, activeFlowId, activeNodeId, playbackHighlight),
    [analysis, activeFlowId, activeNodeId, playbackHighlight]
  );

  function resetUploadedSource() {
    setUploadedSourceFiles([]);
    setUploadedSourceLabel("");
    setUploadSummary("");

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  }

  async function handleFolderUpload(event) {
    const selectedFiles = event.target?.files;

    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }

    setIsUploadPreparing(true);

    try {
      const payload = await buildUploadedSourcePayload(selectedFiles);
      setUploadedSourceFiles(payload.sourceFiles);
      setUploadedSourceLabel(payload.sourceLabel);
      setUploadSummary(
        payload.skippedFiles > 0
          ? `${payload.skippedFiles} non-source files skipped`
          : ""
      );
      setError("");
    } catch (uploadError) {
      resetUploadedSource();
      setError(uploadError.message);
    } finally {
      setIsUploadPreparing(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  }

  async function runAnalysis(event) {
    event.preventDefault();

    if (isUploadPreparing) {
      setError("Upload is still being prepared. Please wait a moment and try Analyze again.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const analyzePayload =
        uploadedSourceFiles.length > 0
          ? {
              sourceFiles: uploadedSourceFiles,
              sourceLabel: uploadedSourceLabel || "uploaded-folder"
            }
          : {
              targetPath
            };

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(analyzePayload)
      });

      const payload = await response.json();
      assertApiSuccess(response, payload, "Analyzer request failed");

      setAnalysis(payload);
      setActiveNodeId("");
      setActiveFlowId(payload.flows?.items?.[0]?.id || "");
      setPlaybackIndex(0);
      setIsPlaybackRunning(false);
      setQueryAnswer(null);
      setQueryError("");
    } catch (requestError) {
      setAnalysis(null);
      setActiveFlowId("");
      setActiveNodeId("");
      setPlaybackIndex(0);
      setIsPlaybackRunning(false);
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
    setPlaybackIndex(0);
    setIsPlaybackRunning(false);
  }

  async function submitQuery(nextQuestion) {
    const trimmedQuestion = (nextQuestion || "").trim();

    const validationError = validateQueryRequest(analysis, trimmedQuestion);

    if (validationError) {
      setQueryError(validationError);
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
      assertApiSuccess(response, payload, "Query request failed");

      setQueryAnswer(payload.answer);
      highlightFirstMatchedFlow(payload.answer, highlightFlow);
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

  const flowPanelContent = renderFlowPanelContent(hasAnalysis, flows, activeFlowId, highlightFlow);

  const graphPanelContent = renderGraphPanelContent(
    hasAnalysis,
    graphElements,
    (_event, node) => {
      setActiveNodeId(node.id);
    }
  );

  let uploadStatusContent = (
    <p className="upload-status">Or upload a project folder to analyze directly in browser.</p>
  );

  if (isUploadPreparing) {
    uploadStatusContent = (
      <p className="upload-status">Reading selected folder and preparing source payload...</p>
    );
  } else if (uploadedSourceFiles.length > 0) {
    uploadStatusContent = (
      <p className="upload-status">
        Using uploaded folder <strong>{uploadedSourceLabel}</strong> with {uploadedSourceFiles.length} source files.
        {uploadSummary ? ` ${uploadSummary}.` : ""}
      </p>
    );
  }

  return (
    <div className="app-shell">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />

      <header className="hero">
        <p className="eyebrow">Confidence Calibration + Compare + Playback</p>
        <h1>AI-Powered Codebase Flow Visualizer</h1>
        <h2>Trace Full-Stack Execution Like a Transit Map</h2>
        <p className="hero-copy">
          Analyze any MERN project path, render API-to-route-to-model links, and
          ask natural-language questions to jump directly to the relevant flow,
          including calibrated confidence scoring, multi-flow comparisons, and
          path-level playback.
        </p>
      </header>

      <section className="control-strip">
        <form onSubmit={runAnalysis} className="analyze-form">
          <label htmlFor="target-path">Target Path</label>
          <div className="form-row">
            <input
              id="target-path"
              value={targetPath}
              onChange={(event) => {
                setTargetPath(event.target.value);
              }}
              placeholder="../sample-project"
              autoComplete="off"
            />
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Analyzing..." : "Analyze Codebase"}
            </button>
          </div>

          <div className="upload-row">
            <input
              ref={folderInputRef}
              type="file"
              className="folder-upload-input"
              multiple
              onChange={(event) => {
                void handleFolderUpload(event);
              }}
              {...DIRECTORY_INPUT_ATTRIBUTES}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                folderInputRef.current?.click();
              }}
              disabled={isLoading || isUploadPreparing}
            >
              {isUploadPreparing ? "Preparing Upload..." : "Upload Project Folder"}
            </button>
            {uploadedSourceFiles.length > 0 ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  resetUploadedSource();
                }}
                disabled={isLoading || isUploadPreparing}
              >
                Use Path Instead
              </button>
            ) : null}
          </div>

          {uploadStatusContent}
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
          <Metric
            label="Dead Code Candidates"
            value={
              analysis?.deadCode
                ? (analysis.deadCode.summary?.potentiallyUnusedFunctions || 0) +
                  (analysis.deadCode.summary?.unlinkedRoutes || 0) +
                  (analysis.deadCode.summary?.unusedModels || 0)
                : "-"
            }
          />
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      {isGraphExpanded ? (
        <button
          type="button"
          className="graph-backdrop"
          aria-label="Close expanded graph view"
          onClick={() => {
            setIsGraphExpanded(false);
          }}
        />
      ) : null}

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
                setPlaybackIndex(0);
                setIsPlaybackRunning(false);
              }}
            >
              Clear Highlight
            </button>
          </div>

          {flowPanelContent}
        </aside>

        <section className={isGraphExpanded ? "panel graph-panel expanded" : "panel graph-panel"}>
          <div className="panel-header">
            <div>
              <h2>Flow Graph</h2>
              <span>Click nodes to inspect local context</span>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setIsGraphExpanded((current) => !current);
              }}
            >
              {isGraphExpanded ? "Exit Full Screen" : "Expand Graph"}
            </button>
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
              <p>
                <strong>Confidence:</strong> {activeFlow.confidence?.level || "low"} (
                {activeFlow.confidence?.score || 0})
              </p>
              <p>
                <strong>Narrative:</strong> {activeFlow.narrative || "-"}
              </p>
              {activeFlow.confidence?.reasons?.length > 0 ? (
                <ul className="confidence-reasons">
                  {activeFlow.confidence.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              {activeFlow.confidence?.calibration?.scoreBreakdown?.length > 0 ? (
                <ul className="score-breakdown-list">
                  {activeFlow.confidence.calibration.scoreBreakdown.map((item) => (
                    <li key={item.signal}>
                      <span>{item.signal}</span>
                      <strong>
                        weight {item.weight} x evidence {item.evidence} = {item.contribution}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ol>
                {activeFlow.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="panel-empty">Select a flow from the left panel to highlight a full path.</p>
          )}

          <div className="detail-block">
            <h3>Path Playback</h3>
            {activeFlow && playbackSequence.length > 0 ? (
              <>
                <p>
                  <strong>Step:</strong> {Math.min(playbackIndex + 1, playbackSequence.length)} /{" "}
                  {playbackSequence.length}
                </p>
                <p>
                  <strong>Current:</strong> {playbackHighlight.currentStep?.label || "-"}
                </p>
                <div className="playback-controls">
                  <button
                    type="button"
                    className="query-action"
                    onClick={() => {
                      setIsPlaybackRunning((current) => !current);
                    }}
                  >
                    {isPlaybackRunning ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    className="query-action"
                    onClick={() => {
                      setIsPlaybackRunning(false);
                      setPlaybackIndex((current) => Math.max(0, current - 1));
                    }}
                    disabled={playbackIndex <= 0}
                  >
                    Step Back
                  </button>
                  <button
                    type="button"
                    className="query-action"
                    onClick={() => {
                      setIsPlaybackRunning(false);
                      setPlaybackIndex((current) =>
                        Math.min(current + 1, Math.max(playbackSequence.length - 1, 0))
                      );
                    }}
                    disabled={playbackIndex >= playbackSequence.length - 1}
                  >
                    Step Forward
                  </button>
                  <button
                    type="button"
                    className="query-action"
                    onClick={() => {
                      setIsPlaybackRunning(false);
                      setPlaybackIndex(0);
                    }}
                  >
                    Reset
                  </button>
                </div>
              </>
            ) : (
              <p className="panel-empty">Select a flow to run step-by-step playback.</p>
            )}
          </div>

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
            <h3>Dead Code Report</h3>
            {analysis?.deadCode ? (
              <>
                <p>
                  <strong>Unused Functions:</strong>{" "}
                  {analysis.deadCode.summary?.potentiallyUnusedFunctions || 0}
                </p>
                <p>
                  <strong>Unlinked Routes:</strong> {analysis.deadCode.summary?.unlinkedRoutes || 0}
                </p>
                <p>
                  <strong>Unused Models:</strong> {analysis.deadCode.summary?.unusedModels || 0}
                </p>
                <p>
                  <strong>Unmatched API Calls:</strong>{" "}
                  {analysis.deadCode.summary?.unmatchedApiCalls || 0}
                </p>
              </>
            ) : (
              <p className="panel-empty">Run analysis to generate dead code candidates.</p>
            )}
          </div>
        </aside>
      </main>

      <section className="panel query-workbench">
        <div className="panel-header">
          <h2>Query Agent Workbench</h2>
          <span>LLM + heuristic reasoning over the latest analysis snapshot</span>
        </div>

        <div className="query-workbench-grid">
          <div className="query-workbench-controls">
            <form className="query-form" onSubmit={handleQuerySubmit}>
              <label htmlFor="query-input">Ask a flow question</label>
              <textarea
                id="query-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What happens when user logs in?"
                rows={4}
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
          </div>

          <div className="query-workbench-result">
            <QueryResult
              answer={queryAnswer}
              onHighlightFlow={highlightFlow}
              onAskSuggestion={(suggestion) => {
                void submitQuery(suggestion);
              }}
            />
          </div>
        </div>
      </section>

      <DocumentationWorkbench
        analysis={analysis}
        hasAnalysis={hasAnalysis}
        sourceLabel={uploadedSourceLabel || targetPath}
      />
    </div>
  );
}
