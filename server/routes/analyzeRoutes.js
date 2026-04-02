const express = require("express");
const path = require("node:path");
const parserAgent = require("../agents/parserAgent");
const flowAgent = require("../agents/flowAgent");
const graphBuilderAgent = require("../agents/graphBuilderAgent");
const queryAgent = require("../agents/queryAgent");
const deadCodeAgent = require("../agents/deadCodeAgent");

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

router.post("/", (req, res) => {
  try {
    const sourceFiles = sanitizeUploadedFiles(req.body?.sourceFiles);

    if (sourceFiles.length > 0) {
      const sourceLabel =
        typeof req.body?.sourceLabel === "string" && req.body.sourceLabel.trim().length > 0
          ? req.body.sourceLabel.trim()
          : "uploaded-folder";

      const parsed = parserAgent.parseCodebaseFromSourceFiles(sourceFiles, {
        sourceLabel,
      });

      return res.json(
        buildAnalysisResponse(parsed, {
          sourceType: "upload",
          sourceLabel,
          uploadedFileCount: sourceFiles.length,
        })
      );
    }

    const targetPath = req.body?.targetPath ? path.resolve(req.body.targetPath) : process.cwd();
    const parsed = parserAgent.parseCodebase(targetPath);

    return res.json(
      buildAnalysisResponse(parsed, {
        sourceType: "filesystem",
        targetPath,
      })
    );
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Analysis failed",
      error: error.message,
    });
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
