const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "how",
  "in",
  "is",
  "me",
  "of",
  "on",
  "or",
  "show",
  "tell",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
  "you",
]);

const TOKEN_ALIASES = new Map([
  ["log", "login"],
  ["logs", "login"],
  ["logged", "login"],
  ["signin", "login"],
  ["sign", "login"],
  ["signon", "login"],
  ["signup", "register"],
  ["sign-up", "register"],
  ["authentication", "auth"],
  ["authorize", "auth"],
  ["authorization", "auth"],
]);

function summarizeCounts(analysis) {
  const parsed = analysis.parsed || {};
  const flows = analysis.flows || {};
  const deadCode = analysis.deadCode || {};
  const deadCodeSummary = deadCode.summary || {};

  return {
    filesScanned: parsed.filesScanned || 0,
    apiCalls: parsed.frontendApiCalls?.length || 0,
    expressRoutes: parsed.expressRoutes?.length || 0,
    reactRoutes: parsed.reactRoutes?.length || 0,
    mongooseModels: parsed.mongooseModels?.length || 0,
    mongooseOperations: parsed.mongooseOperations?.length || 0,
    flows: flows.count || 0,
    deadCodeCandidates:
      (deadCodeSummary.potentiallyUnusedFunctions || 0) +
      (deadCodeSummary.unlinkedRoutes || 0) +
      (deadCodeSummary.unusedModels || 0),
  };
}

function listAuthRoutes(analysis) {
  const routes = analysis.parsed?.expressRoutes || [];
  return routes.filter((route) => /auth|login|token|signin|signup/i.test(route.path));
}

function normalizeText(value) {
  return (value || "").toLowerCase();
}

function tokenize(value) {
  const roughTokens = normalizeText(value)
    .replaceAll(/[^a-z0-9/._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const expandedTokens = [];

  for (const token of roughTokens) {
    expandedTokens.push(token);

    for (const segment of token.split(/[/. _-]+/)) {
      if (segment) {
        expandedTokens.push(segment);
      }
    }
  }

  const canonicalTokens = expandedTokens.map((token) => TOKEN_ALIASES.get(token) || token);

  return [...new Set(canonicalTokens)].filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token)
  );
}

function flowToSearchText(flow) {
  return [
    flow.frontendAction?.method,
    flow.frontendAction?.endpoint,
    flow.backendRoute?.method,
    flow.backendRoute?.path,
    flow.backendRoute?.handler,
    ...(flow.middlewareChain || []),
    ...(flow.tracedFunctions || []),
    ...(flow.databaseOperations || []).map(
      (operation) => `${operation.model}.${operation.operation}`
    ),
    flow.frontendAction?.filePath,
    flow.backendRoute?.filePath,
  ]
    .filter(Boolean)
    .join(" ");
}

function getFlowScore(flow, questionTokens, loweredQuestion) {
  const searchable = flowToSearchText(flow);
  const flowTokens = new Set(tokenize(searchable));

  let score = 0;

  for (const token of questionTokens) {
    if (flowTokens.has(token)) {
      score += 2;
    }
  }

  const endpoint = normalizeText(flow.frontendAction?.endpoint);
  const routePath = normalizeText(flow.backendRoute?.path);

  if (endpoint && loweredQuestion.includes(endpoint)) {
    score += 6;
  }

  if (routePath && loweredQuestion.includes(routePath)) {
    score += 6;
  }

  if (/login|signin|signup|auth|token/.test(loweredQuestion)) {
    if (/login|signin|signup|auth|token/.test(`${endpoint} ${routePath}`)) {
      score += 3;
    }
  }

  score += (flow.confidence?.score || 0) * 2;

  return score;
}

function findFlowForKeyword(analysis, question) {
  const loweredQuestion = normalizeText(question);
  const questionTokens = tokenize(question);
  const flows = analysis.flows?.items || [];

  return flows
    .map((flow) => ({
      flow,
      score: getFlowScore(flow, questionTokens, loweredQuestion),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.flow);
}

function extractEndpointFromQuestion(question) {
  const match = question.match(/\/[a-z0-9:_\-/]+/i);
  return match ? match[0] : null;
}

function buildFlowExplanation(flow) {
  return {
    id: flow.id,
    entry: `${flow.frontendAction?.method || ""} ${flow.frontendAction?.endpoint || ""}`.trim(),
    route: `${flow.backendRoute?.method || ""} ${flow.backendRoute?.path || ""}`.trim(),
    confidence: flow.confidence || { score: 0, level: "low", reasons: [] },
    confidenceCalibration: flow.confidence?.calibration || null,
    steps: flow.steps || [],
    narrative: flow.narrative || "",
    executionPath: flow.executionPath || [],
    middlewareChain: flow.middlewareChain || [],
    helperFunctions: flow.indirectFunctions || [],
    databaseOperations: (flow.databaseOperations || []).map((operation) => ({
      model: operation.model,
      operation: operation.operation,
      functionName: operation.functionName,
      filePath: operation.filePath,
      line: operation.line,
    })),
  };
}

function buildComparisonData(explanations) {
  const dimensions = [
    {
      name: "Confidence",
      values: explanations.map((item) => ({
        flowId: item.id,
        value: `${item.confidence?.level || "low"} (${item.confidence?.score || 0})`,
      })),
    },
    {
      name: "Route",
      values: explanations.map((item) => ({
        flowId: item.id,
        value: item.route,
      })),
    },
    {
      name: "Middleware Steps",
      values: explanations.map((item) => ({
        flowId: item.id,
        value: String(item.middlewareChain?.length || 0),
      })),
    },
    {
      name: "Helper Functions",
      values: explanations.map((item) => ({
        flowId: item.id,
        value: String(item.helperFunctions?.length || 0),
      })),
    },
    {
      name: "DB Operations",
      values: explanations.map((item) => ({
        flowId: item.id,
        value: String(item.databaseOperations?.length || 0),
      })),
    },
  ];

  const sortedByConfidence = [...explanations].sort(
    (left, right) => (right.confidence?.score || 0) - (left.confidence?.score || 0)
  );

  const leader = sortedByConfidence[0];
  const runnerUp = sortedByConfidence[1];

  const insights = [];
  if (leader) {
    insights.push(`Highest-confidence flow: ${leader.entry} -> ${leader.route}.`);
  }

  if (leader && runnerUp) {
    const delta = Number(
      ((leader.confidence?.score || 0) - (runnerUp.confidence?.score || 0)).toFixed(2)
    );
    insights.push(`Confidence gap between top two flows: ${delta}.`);
  }

  return {
    totalFlows: explanations.length,
    dimensions,
    insights,
  };
}

function findFlowExplanationCandidates(analysis, question) {
  const endpointHint = extractEndpointFromQuestion(question);
  const flows = analysis.flows?.items || [];

  if (!endpointHint) {
    return findFlowForKeyword(analysis, question)
      .slice(0, 3)
      .map(buildFlowExplanation);
  }

  const endpointCandidates = flows.filter((flow) => {
    const endpoint = normalizeText(flow.frontendAction?.endpoint);
    const routePath = normalizeText(flow.backendRoute?.path);
    const normalizedHint = endpointHint.toLowerCase();

    return endpoint.includes(normalizedHint) || routePath.includes(normalizedHint);
  });

  if (endpointCandidates.length > 0) {
    return endpointCandidates
      .sort((left, right) => (right.confidence?.score || 0) - (left.confidence?.score || 0))
      .slice(0, 3)
      .map(buildFlowExplanation);
  }

  return findFlowForKeyword(analysis, question)
    .slice(0, 3)
    .map(buildFlowExplanation);
}

function findFlowComparisonCandidates(analysis, question) {
  const keywordMatches = findFlowForKeyword(analysis, question);
  const flows = analysis.flows?.items || [];

  if (keywordMatches.length >= 2) {
    return keywordMatches.slice(0, 4).map(buildFlowExplanation);
  }

  if (flows.length >= 2) {
    return [...flows]
      .sort((left, right) => (right.confidence?.score || 0) - (left.confidence?.score || 0))
      .slice(0, 4)
      .map(buildFlowExplanation);
  }

  return keywordMatches.slice(0, 1).map(buildFlowExplanation);
}

function getHighlightMeta(flowList) {
  return {
    flowIds: flowList.map((flow) => flow.id),
  };
}

function answerQuestion(question, analysis) {
  const lowered = normalizeText(question);

  if (lowered.includes("summary") || lowered.includes("overview")) {
    return {
      type: "summary",
      data: summarizeCounts(analysis),
      highlights: getHighlightMeta([]),
    };
  }

  if (/explain|trace|walk( me)? through|path/.test(lowered)) {
    const explanations = findFlowExplanationCandidates(analysis, question);

    if (explanations.length > 0) {
      return {
        type: "flow_explain",
        data: explanations,
        highlights: {
          flowIds: explanations.map((item) => item.id),
        },
      };
    }
  }

  if (/compare|versus|\bvs\b|difference|different/.test(lowered)) {
    const explanations = findFlowComparisonCandidates(analysis, question);

    if (explanations.length >= 2) {
      return {
        type: "flow_compare",
        data: {
          flows: explanations,
          comparison: buildComparisonData(explanations),
        },
        highlights: {
          flowIds: explanations.map((item) => item.id),
        },
      };
    }
  }

  if (lowered.includes("auth") || lowered.includes("login")) {
    const authRoutes = listAuthRoutes(analysis);
    const relatedFlows = (analysis.flows?.items || []).filter((flow) =>
      /auth|login|token|signin|signup/i.test(
        `${flow.frontendAction?.endpoint || ""} ${flow.backendRoute?.path || ""}`
      )
    );

    return {
      type: "auth_routes",
      data: {
        routes: authRoutes,
        relatedFlows,
      },
      highlights: getHighlightMeta(relatedFlows),
    };
  }

  if (/dead|unused|orphan|unreachable/.test(lowered)) {
    const deadCode = analysis.deadCode || {};
    const candidates = [
      ...(deadCode.potentiallyUnusedFunctions || []),
      ...(deadCode.unlinkedRoutes || []),
      ...(deadCode.unusedModels || []),
    ];

    return {
      type: "dead_code",
      data: {
        summary: deadCode.summary || {},
        potentiallyUnusedFunctions: deadCode.potentiallyUnusedFunctions || [],
        unlinkedRoutes: deadCode.unlinkedRoutes || [],
        unusedModels: deadCode.unusedModels || [],
        caveat: deadCode.caveat,
      },
      highlights: getHighlightMeta([]),
      confidence: candidates.length > 0 ? "medium" : "low",
    };
  }

  const relatedFlows = findFlowForKeyword(analysis, question);
  if (relatedFlows.length > 0) {
    return {
      type: "flow_match",
      data: relatedFlows,
      highlights: getHighlightMeta(relatedFlows),
    };
  }

  return {
    type: "fallback",
    data: {
      message: "No direct match found. Try asking for summary, auth routes, or a specific endpoint.",
      suggestions: [
        "Give me a summary of this codebase flow",
        "Which routes are related to auth?",
        "What happens when user logs in?",
        "Explain flow for /api/auth/profile",
        "Compare login and profile flows",
        "Show dead code candidates",
      ],
    },
    highlights: getHighlightMeta([]),
  };
}

module.exports = {
  answerQuestion,
};
