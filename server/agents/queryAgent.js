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

  return {
    filesScanned: parsed.filesScanned || 0,
    apiCalls: parsed.frontendApiCalls?.length || 0,
    expressRoutes: parsed.expressRoutes?.length || 0,
    reactRoutes: parsed.reactRoutes?.length || 0,
    mongooseModels: parsed.mongooseModels?.length || 0,
    mongooseOperations: parsed.mongooseOperations?.length || 0,
    flows: flows.count || 0,
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
      ],
    },
    highlights: getHighlightMeta([]),
  };
}

module.exports = {
  answerQuestion,
};
