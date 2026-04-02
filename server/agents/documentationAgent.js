const PDFDocument = require("pdfkit");

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAnalysisPayload(analysis) {
  if (!analysis || typeof analysis !== "object") {
    throw new Error("analysis payload is required");
  }

  if (analysis.parsed && analysis.flows && analysis.graph) {
    return analysis;
  }

  if (analysis.parsed || analysis.flows || analysis.graph) {
    throw new Error("analysis payload is incomplete");
  }

  throw new Error("analysis payload must come from /api/analyze response");
}

function getTagFromPath(routePath) {
  if (!routePath || typeof routePath !== "string") {
    return "general";
  }

  const segments = routePath.split("/").filter(Boolean);
  const firstSegment = segments[0] === "api" ? segments[1] || segments[0] : segments[0];
  if (!firstSegment) {
    return "general";
  }

  return firstSegment.replaceAll(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "general";
}

function buildOpenApiSpec(analysis, options) {
  const parsed = analysis.parsed;
  const flows = safeArray(analysis.flows?.items);
  const title = options.title || "AI Codebase Flow Visualizer API";

  const flowCountByRoute = new Map();
  for (const flow of flows) {
    const key = `${flow.backendRoute?.method || ""}:${flow.backendRoute?.path || ""}`;
    flowCountByRoute.set(key, (flowCountByRoute.get(key) || 0) + 1);
  }

  const paths = {};
  const tags = new Set();

  for (const route of safeArray(parsed.expressRoutes)) {
    const routePath = route.path || "/";
    const method = (route.method || "get").toLowerCase();
    const methodName = method === "use" || method === "all" ? "get" : method;
    const tag = getTagFromPath(routePath);
    tags.add(tag);

    if (!paths[routePath]) {
      paths[routePath] = {};
    }

    const flowKey = `${route.method || ""}:${route.path || ""}`;
    const flowCount = flowCountByRoute.get(flowKey) || 0;

    paths[routePath][methodName] = {
      tags: [tag],
      summary: route.handler
        ? `${String(route.method || "GET").toUpperCase()} ${routePath} handled by ${route.handler}`
        : `${String(route.method || "GET").toUpperCase()} ${routePath}`,
      operationId: `${methodName}_${routePath.replaceAll(/[^a-zA-Z0-9]/g, "_")}`,
      responses: {
        "200": {
          description: "Successful response",
        },
      },
      "x-handler": route.handler || null,
      "x-middlewares": safeArray(route.middlewares),
      "x-flowCount": flowCount,
      "x-source": {
        filePath: route.filePath || null,
        line: route.line || null,
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title,
      version: "1.0.0",
      description: "Auto-generated from static analysis of Express routes and execution flows.",
    },
    servers: [
      {
        url: options.serverUrl || "http://localhost:4000",
      },
    ],
    tags: [...tags].sort((left, right) => left.localeCompare(right)).map((name) => ({ name })),
    paths,
  };
}

function shortFilePath(value) {
  if (!value || typeof value !== "string") {
    return "unknown";
  }

  return value.replaceAll("\\", "/").split("/").slice(-3).join("/");
}

function buildArchitectureExplanation(analysis) {
  const parsed = analysis.parsed;
  const flows = analysis.flows;
  const deadCode = analysis.deadCode || { summary: {} };

  return [
    "This architecture uses a frontend-triggered API model that propagates requests into Express routes,",
    "then through middleware, controller handlers, helper functions, and database operations.",
    `Detected ${safeArray(parsed.frontendApiCalls).length} frontend API calls and ${safeArray(parsed.expressRoutes).length} backend routes,`,
    `with ${Number(flows?.count || 0)} linked execution flow(s).`,
    `The graph currently contains ${Number(analysis.graph?.nodeCount || 0)} nodes and ${Number(analysis.graph?.edgeCount || 0)} edges,`,
    "providing a traceable map across UI, API, business logic, and persistence layers.",
    `Potential dead-code signals include ${Number(deadCode.summary?.potentiallyUnusedFunctions || 0)} potentially unused functions and ${Number(deadCode.summary?.unlinkedRoutes || 0)} unlinked routes.`,
  ].join(" ");
}

function buildMermaidDiagram(analysis, options) {
  const flows = safeArray(analysis.flows?.items);
  const maxFlows = Number(options.maxFlows || 12);
  const selected = flows.slice(0, Math.max(1, maxFlows));

  const lines = ["flowchart LR"];

  selected.forEach((flow, index) => {
    const flowId = `F${index + 1}`;
    const apiLabel = `${flow.frontendAction?.method || "GET"} ${flow.frontendAction?.endpoint || "unknown"}`;
    const routeLabel = `${flow.backendRoute?.method || "GET"} ${flow.backendRoute?.path || "unknown"}`;
    const controllerLabel = flow.controllerHandler || "controller";

    lines.push(
      `  subgraph ${flowId}[Flow ${index + 1}]`,
      `    ${flowId}API["${apiLabel.replaceAll('"', "'")}"] --> ${flowId}ROUTE["${routeLabel.replaceAll('"', "'")}"]`
    );

    let previous = `${flowId}ROUTE`;
    safeArray(flow.middlewareChain).forEach((middleware, middlewareIndex) => {
      const middlewareNode = `${flowId}MW${middlewareIndex + 1}`;
      lines.push(
        `    ${previous} --> ${middlewareNode}["${String(middleware).replaceAll('"', "'")}"]`
      );
      previous = middlewareNode;
    });

    const controllerNode = `${flowId}CTRL`;
    lines.push(
      `    ${previous} --> ${controllerNode}["${String(controllerLabel).replaceAll('"', "'")}"]`
    );

    const dbOperations = safeArray(flow.databaseOperations);
    if (dbOperations.length === 0) {
      lines.push(`    ${controllerNode} --> ${flowId}END["No DB operation linked"]`);
    } else {
      dbOperations.slice(0, 3).forEach((operation, operationIndex) => {
        const dbNode = `${flowId}DB${operationIndex + 1}`;
        lines.push(
          `    ${controllerNode} --> ${dbNode}["${operation.model}.${operation.operation}()"]`
        );
      });
    }

    lines.push("  end");
  });

  return lines.join("\n");
}

function buildApiDocsTable(routes) {
  const header = "| Method | Path | Handler | Middlewares | Source |";
  const separator = "| --- | --- | --- | --- | --- |";

  const rows = safeArray(routes).map((route) => {
    const middlewares = safeArray(route.middlewares).join(", ") || "-";
    const source = `${shortFilePath(route.filePath)}:${route.line || 0}`;
    return `| ${route.method || "GET"} | ${route.path || "/"} | ${route.handler || "-"} | ${middlewares} | ${source} |`;
  });

  return [header, separator, ...rows].join("\n");
}

function buildFlowDocs(flows) {
  const flowItems = safeArray(flows).slice(0, 15);

  if (flowItems.length === 0) {
    return "No execution flows were linked.";
  }

  return flowItems
    .map((flow, index) => {
      const confidenceScore = flow.confidence?.score ?? "n/a";
      const confidenceLevel = flow.confidence?.level ?? "unknown";
      const reasonText = safeArray(flow.confidence?.reasons).slice(0, 3).join(" ");
      const path = safeArray(flow.executionPath)
        .map((step) => step.label)
        .join(" -> ");

      return [
        `### Flow ${index + 1}`,
        `- Frontend: ${flow.frontendAction?.method || "GET"} ${flow.frontendAction?.endpoint || "unknown"}`,
        `- Backend: ${flow.backendRoute?.method || "GET"} ${flow.backendRoute?.path || "unknown"}`,
        `- Confidence: ${confidenceScore} (${confidenceLevel})`,
        reasonText ? `- Rationale: ${reasonText}` : null,
        path ? `- Path: ${path}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function buildMarkdown(analysis, generated) {
  const parsed = analysis.parsed;
  const flowCount = Number(analysis.flows?.count || 0);

  return [
    `# ${generated.title}`,
    "",
    `Generated At: ${generated.generatedAt}`,
    "",
    "## Overview",
    `- Files Scanned: ${Number(parsed.filesScanned || 0)}`,
    `- Frontend API Calls: ${safeArray(parsed.frontendApiCalls).length}`,
    `- Backend Routes: ${safeArray(parsed.expressRoutes).length}`,
    `- Models: ${safeArray(parsed.mongooseModels).length}`,
    `- Linked Flows: ${flowCount}`,
    `- Graph Nodes: ${Number(analysis.graph?.nodeCount || 0)}`,
    `- Graph Edges: ${Number(analysis.graph?.edgeCount || 0)}`,
    "",
    "## Architecture Explanation",
    generated.architectureExplanation,
    "",
    "## API Documentation",
    buildApiDocsTable(parsed.expressRoutes),
    "",
    "## Execution Flows",
    buildFlowDocs(analysis.flows?.items),
    "",
    "## Flow Diagram (Mermaid)",
    "```mermaid",
    generated.flowDiagramMermaid,
    "```",
    "",
    "## Dead Code Signals",
    `- Potentially Unused Functions: ${Number(analysis.deadCode?.summary?.potentiallyUnusedFunctions || 0)}`,
    `- Unlinked Routes: ${Number(analysis.deadCode?.summary?.unlinkedRoutes || 0)}`,
    `- Unused Models: ${Number(analysis.deadCode?.summary?.unusedModels || 0)}`,
    `- Unmatched API Calls: ${Number(analysis.deadCode?.summary?.unmatchedApiCalls || 0)}`,
  ].join("\n");
}

function buildSwaggerUiHtml(openapiSpec, options) {
  const title = options.title || "Generated Swagger UI";
  const specJson = JSON.stringify(openapiSpec);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #faf9f6; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = function () {
        const spec = ${specJson};
        window.ui = SwaggerUIBundle({
          spec,
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout'
        });
      };
    </script>
  </body>
</html>`;
}

function toPdfLines(markdown) {
  return String(markdown || "")
    .replaceAll(/```[\s\S]*?```/g, "[diagram omitted in PDF text export]")
    .split("\n")
    .map((line) => line.replace(/^[-*]\s/, "- "));
}

function generatePdfBuffer(markdown, title) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text(title || "Generated Documentation", { underline: true });
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor("#333").text(`Generated at ${new Date().toISOString()}`);
    doc.moveDown(0.8);

    const lines = toPdfLines(markdown);
    doc.fontSize(11).fillColor("#111");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ")) {
        doc.moveDown(0.8);
        doc.fontSize(16).text(trimmed.replace(/^#\s+/, ""));
        doc.moveDown(0.3);
        doc.fontSize(11);
        continue;
      }

      if (trimmed.startsWith("## ")) {
        doc.moveDown(0.6);
        doc.fontSize(13).text(trimmed.replace(/^##\s+/, ""));
        doc.moveDown(0.2);
        doc.fontSize(11);
        continue;
      }

      if (trimmed.startsWith("### ")) {
        doc.moveDown(0.4);
        doc.fontSize(12).text(trimmed.replace(/^###\s+/, ""));
        doc.fontSize(11);
        continue;
      }

      if (trimmed.length === 0) {
        doc.moveDown(0.3);
        continue;
      }

      doc.text(line, {
        width: 510,
      });
    }

    doc.end();
  });
}

async function generateDocumentation(analysisPayload, options = {}) {
  const analysis = normalizeAnalysisPayload(analysisPayload);
  const title = options.title || "Auto Documentation - AI Codebase Flow Visualizer";
  const generatedAt = new Date().toISOString();

  const openapi = buildOpenApiSpec(analysis, {
    title,
    serverUrl: options.serverUrl,
  });

  const flowDiagramMermaid = buildMermaidDiagram(analysis, {
    maxFlows: options.maxFlows,
  });

  const architectureExplanation = buildArchitectureExplanation(analysis);
  const swaggerUiHtml = buildSwaggerUiHtml(openapi, { title });

  const generated = {
    title,
    generatedAt,
    architectureExplanation,
    flowDiagramMermaid,
  };

  const markdown = buildMarkdown(analysis, generated);

  const documentation = {
    title,
    generatedAt,
    markdown,
    architectureExplanation,
    flowDiagramMermaid,
    openapi,
    swaggerUiHtml,
  };

  if (options.includePdf !== false) {
    const pdfBuffer = await generatePdfBuffer(markdown, title);
    documentation.pdfBase64 = pdfBuffer.toString("base64");
    documentation.pdfFileName = `${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.pdf`;
  }

  return documentation;
}

module.exports = {
  generateDocumentation,
};
