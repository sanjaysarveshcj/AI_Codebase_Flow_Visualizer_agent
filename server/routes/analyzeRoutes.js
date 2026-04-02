const express = require("express");
const path = require("node:path");
const parserAgent = require("../agents/parserAgent");
const flowAgent = require("../agents/flowAgent");
const graphBuilderAgent = require("../agents/graphBuilderAgent");
const queryAgent = require("../agents/queryAgent");
const deadCodeAgent = require("../agents/deadCodeAgent");
const documentationAgent = require("../agents/documentationAgent");

const router = express.Router();

function buildAnalysisResponse(parsed, meta) {
  const flows = flowAgent.buildExecutionFlows(parsed);
  const graph = graphBuilderAgent.buildGraph(parsed, flows);
  const deadCode = deadCodeAgent.analyzeDeadCode(parsed, flows);

  return {
    ok: true,
    meta: {
      ...meta,
      generatedAt: new Date().toISOString(),
    },
    parsed,
    flows,
    graph,
    deadCode,
  };
}

function sanitizeUploadedFiles(sourceFiles) {
  if (!Array.isArray(sourceFiles)) {
    return [];
  }

  return sourceFiles
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      relativePath: entry.relativePath,
      content: typeof entry.content === "string" ? entry.content : "",
    }));
}

function resolveAnalysisFromRequest(body) {
  const analysis = body?.analysis;
  if (analysis && typeof analysis === "object") {
    if (analysis.parsed && analysis.flows && analysis.graph) {
      return analysis;
    }

    throw new Error("analysis payload is incomplete");
  }

  const sourceFiles = sanitizeUploadedFiles(body?.sourceFiles);
  if (sourceFiles.length > 0) {
    const sourceLabel =
      typeof body?.sourceLabel === "string" && body.sourceLabel.trim().length > 0
        ? body.sourceLabel.trim()
        : "uploaded-folder";

    const parsed = parserAgent.parseCodebaseFromSourceFiles(sourceFiles, {
      sourceLabel,
    });

    return buildAnalysisResponse(parsed, {
      sourceType: "upload",
      sourceLabel,
      uploadedFileCount: sourceFiles.length,
    });
  }

  const targetPath = body?.targetPath ? path.resolve(body.targetPath) : process.cwd();
  const parsed = parserAgent.parseCodebase(targetPath);

  return buildAnalysisResponse(parsed, {
    sourceType: "filesystem",
    targetPath,
  });
}

router.post("/", (req, res) => {
  try {
    const analysis = resolveAnalysisFromRequest(req.body);
    return res.json(analysis);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Analysis failed",
      error: error.message,
    });
  }
});

router.post("/docs/generate", async (req, res) => {
  try {
    const analysis = resolveAnalysisFromRequest(req.body);

    const documentation = await documentationAgent.generateDocumentation(analysis, {
      title:
        typeof req.body?.title === "string" && req.body.title.trim().length > 0
          ? req.body.title.trim()
          : "Auto Documentation - AI Codebase Flow Visualizer",
      serverUrl:
        typeof req.body?.serverUrl === "string" && req.body.serverUrl.trim().length > 0
          ? req.body.serverUrl.trim()
          : undefined,
      maxFlows:
        Number.isFinite(Number(req.body?.maxFlows)) && Number(req.body?.maxFlows) > 0
          ? Number(req.body.maxFlows)
          : 12,
      includePdf: req.body?.includePdf !== false,
    });

    return res.json({
      ok: true,
      meta: {
        generatedAt: new Date().toISOString(),
      },
      documentation,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Documentation generation failed",
      error: error.message,
    });
  }
});

router.post("/docs/swagger-ui", async (req, res) => {
  try {
    const analysis = resolveAnalysisFromRequest(req.body);

    const documentation = await documentationAgent.generateDocumentation(analysis, {
      title:
        typeof req.body?.title === "string" && req.body.title.trim().length > 0
          ? req.body.title.trim()
          : "Generated Swagger UI",
      serverUrl:
        typeof req.body?.serverUrl === "string" && req.body.serverUrl.trim().length > 0
          ? req.body.serverUrl.trim()
          : undefined,
      includePdf: false,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(documentation.swaggerUiHtml);
  } catch (error) {
    return res.status(500).send(`<pre>Documentation generation failed: ${error.message}</pre>`);
  }
});

router.post("/query", async (req, res) => {
  try {
    const { question, analysis } = req.body || {};

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        ok: false,
        message: "question is required",
      });
    }

    if (!analysis || typeof analysis !== "object") {
      return res.status(400).json({
        ok: false,
        message: "analysis payload is required",
      });
    }

    const answer = await queryAgent.answerQuestion(question, analysis);

    return res.json({
      ok: true,
      question,
      answer,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Query failed",
      error: error.message,
    });
  }
});

module.exports = router;
