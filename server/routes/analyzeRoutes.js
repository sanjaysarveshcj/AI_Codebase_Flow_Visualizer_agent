const express = require("express");
const path = require("node:path");
const parserAgent = require("../agents/parserAgent");
const flowAgent = require("../agents/flowAgent");
const graphBuilderAgent = require("../agents/graphBuilderAgent");
const queryAgent = require("../agents/queryAgent");
const deadCodeAgent = require("../agents/deadCodeAgent");

const router = express.Router();

router.post("/", (req, res) => {
  try {
    const targetPath = req.body?.targetPath
      ? path.resolve(req.body.targetPath)
      : process.cwd();

    const parsed = parserAgent.parseCodebase(targetPath);
    const flows = flowAgent.buildExecutionFlows(parsed);
    const graph = graphBuilderAgent.buildGraph(parsed, flows);
    const deadCode = deadCodeAgent.analyzeDeadCode(parsed, flows);

    res.json({
      ok: true,
      meta: {
        targetPath,
        generatedAt: new Date().toISOString(),
      },
      parsed,
      flows,
      graph,
      deadCode,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Analysis failed",
      error: error.message,
    });
  }
});

router.post("/query", (req, res) => {
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

    const answer = queryAgent.answerQuestion(question, analysis);

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
