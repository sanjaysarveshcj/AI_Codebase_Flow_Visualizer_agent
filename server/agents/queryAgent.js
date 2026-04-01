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

const ALLOWED_ANSWER_TYPES = new Set([
  "summary",
  "auth_routes",
  "flow_match",
  "flow_explain",
  "flow_compare",
  "dead_code",
  "fallback",
]);

function sanitizeAssistantText(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 600) {
    return trimmed;
  }

  return `${trimmed.slice(0, 597)}...`;
}

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

function answerQuestionHeuristic(question, analysis) {
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

function getFlowIndex(analysis) {
  const flowMap = new Map();
  for (const flow of analysis.flows?.items || []) {
    if (flow?.id) {
      flowMap.set(flow.id, flow);
    }
  }
  return flowMap;
}

function summarizeFlowForLlm(flow) {
  return {
    id: flow.id,
    entry: {
      method: flow.frontendAction?.method,
      endpoint: flow.frontendAction?.endpoint,
    },
    route: {
      method: flow.backendRoute?.method,
      path: flow.backendRoute?.path,
      handler: flow.backendRoute?.handler,
    },
    confidence: flow.confidence || null,
    middlewareChain: flow.middlewareChain || [],
    helperFunctions: flow.indirectFunctions || [],
    databaseOperations: (flow.databaseOperations || []).map((operation) => ({
      model: operation.model,
      operation: operation.operation,
      functionName: operation.functionName,
    })),
    narrative: flow.narrative || "",
  };
}

function buildLlmContext(question, analysis, heuristicAnswer) {
  const flows = analysis.flows?.items || [];
  const topFlows = [...flows]
    .sort((left, right) => (right.confidence?.score || 0) - (left.confidence?.score || 0))
    .slice(0, 8)
    .map(summarizeFlowForLlm);

  const flowHighlights = heuristicAnswer?.highlights?.flowIds || [];

  return {
    question,
    summary: summarizeCounts(analysis),
    deadCodeSummary: analysis.deadCode?.summary || {},
    heuristic: {
      type: heuristicAnswer?.type,
      highlights: flowHighlights,
    },
    topFlows,
    allowedAnswerTypes: [...ALLOWED_ANSWER_TYPES],
  };
}

function extractTextFromPart(part) {
  if (!part || typeof part.text !== "string") {
    return null;
  }

  return part.type === "output_text" || part.type === "text" ? part.text : null;
}

function collectOutputTextParts(output) {
  const textParts = [];

  for (const item of output) {
    if (!item || !Array.isArray(item.content)) {
      continue;
    }

    for (const part of item.content) {
      const text = extractTextFromPart(part);
      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts;
}

function getResponseText(responsePayload) {
  if (!responsePayload || typeof responsePayload !== "object") {
    return "";
  }

  if (typeof responsePayload.output_text === "string" && responsePayload.output_text.trim()) {
    return responsePayload.output_text;
  }

  const output = Array.isArray(responsePayload.output) ? responsePayload.output : [];
  const textParts = collectOutputTextParts(output);

  return textParts.join("\n").trim();
}

function safeParseJson(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return null;
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const firstBrace = withoutFence.indexOf("{");
    const lastBrace = withoutFence.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = withoutFence.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }

    return null;
  }
}

function normalizeProvider(value) {
  const normalized = (value || "").toLowerCase().trim();
  if (normalized === "openrouter") {
    return "openrouter";
  }

  if (normalized === "openai") {
    return "openai";
  }

  return null;
}

function stripTrailingSlash(value) {
  return (value || "").replace(/\/+$/, "");
}

function resolveLlmConfig() {
  const providerOverride = normalizeProvider(process.env.QUERY_AGENT_LLM_PROVIDER);
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (providerOverride === "openrouter") {
    if (!openRouterKey) {
      return null;
    }

    return {
      provider: "openrouter",
      apiKey: openRouterKey,
      model: process.env.QUERY_AGENT_LLM_MODEL || "openai/gpt-4.1-mini",
      baseUrl: stripTrailingSlash(
        process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
      ),
      appName: process.env.OPENROUTER_APP_NAME || "AI Codebase Flow Visualizer",
      siteUrl: process.env.OPENROUTER_SITE_URL || "",
    };
  }

  if (providerOverride === "openai") {
    if (!openAiKey) {
      return null;
    }

    return {
      provider: "openai",
      apiKey: openAiKey,
      model: process.env.QUERY_AGENT_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    };
  }

  if (openRouterKey) {
    return {
      provider: "openrouter",
      apiKey: openRouterKey,
      model: process.env.QUERY_AGENT_LLM_MODEL || "openai/gpt-4.1-mini",
      baseUrl: stripTrailingSlash(
        process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
      ),
      appName: process.env.OPENROUTER_APP_NAME || "AI Codebase Flow Visualizer",
      siteUrl: process.env.OPENROUTER_SITE_URL || "",
    };
  }

  if (openAiKey) {
    return {
      provider: "openai",
      apiKey: openAiKey,
      model: process.env.QUERY_AGENT_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    };
  }

  return null;
}

function normalizeHighlights(highlights, flowMap) {
  const requestedFlowIds = Array.isArray(highlights?.flowIds) ? highlights.flowIds : [];
  const flowIds = [];

  for (const flowId of requestedFlowIds) {
    if (typeof flowId === "string" && flowMap.has(flowId) && !flowIds.includes(flowId)) {
      flowIds.push(flowId);
    }
  }

  return { flowIds };
}

function coerceFlowPayload(data, flowMap) {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        const flow = typeof item === "string" ? flowMap.get(item) : flowMap.get(item?.id);
        return flow || null;
      })
      .filter(Boolean);
  }

  return null;
}

function buildAuthRouteData(analysis) {
  const authRoutes = listAuthRoutes(analysis);
  const relatedFlows = (analysis.flows?.items || []).filter((flow) =>
    /auth|login|token|signin|signup/i.test(
      `${flow.frontendAction?.endpoint || ""} ${flow.backendRoute?.path || ""}`
    )
  );

  return {
    data: {
      routes: authRoutes,
      relatedFlows,
    },
    highlights: {
      flowIds: relatedFlows.map((flow) => flow.id),
    },
  };
}

function buildDeadCodeData(analysis) {
  const deadCode = analysis.deadCode || {};
  return {
    summary: deadCode.summary || {},
    potentiallyUnusedFunctions: deadCode.potentiallyUnusedFunctions || [],
    unlinkedRoutes: deadCode.unlinkedRoutes || [],
    unusedModels: deadCode.unusedModels || [],
    caveat: deadCode.caveat,
  };
}

function sanitizeFlowMatchData(rawData, flowMap) {
  const payload = coerceFlowPayload(rawData, flowMap);
  if (!payload || payload.length === 0) {
    return null;
  }

  return {
    data: payload,
    highlights: {
      flowIds: payload.map((flow) => flow.id),
    },
  };
}

function sanitizeFlowExplainData(rawData, flowMap) {
  const explanations = Array.isArray(rawData)
    ? rawData
        .map((item) => {
          const flow = flowMap.get(item?.id);
          return flow ? buildFlowExplanation(flow) : null;
        })
        .filter(Boolean)
    : [];

  if (explanations.length === 0) {
    return null;
  }

  return {
    data: explanations,
    highlights: {
      flowIds: explanations.map((item) => item.id),
    },
  };
}

function sanitizeFlowCompareData(rawData, flowMap) {
  const flowIds = Array.isArray(rawData?.flows)
    ? rawData.flows.map((item) => (typeof item === "string" ? item : item?.id))
    : [];

  const explanations = flowIds
    .map((flowId) => flowMap.get(flowId))
    .filter(Boolean)
    .map(buildFlowExplanation);

  if (explanations.length < 2) {
    return null;
  }

  return {
    data: {
      flows: explanations,
      comparison: buildComparisonData(explanations),
    },
    highlights: {
      flowIds: explanations.map((item) => item.id),
    },
  };
}

function applyDeterministicTypePayload(sanitized, analysis) {
  switch (sanitized.type) {
    case "summary": {
      return {
        ...sanitized,
        data: summarizeCounts(analysis),
      };
    }
    case "auth_routes": {
      const authPayload = buildAuthRouteData(analysis);
      return {
        ...sanitized,
        ...authPayload,
      };
    }
    case "dead_code": {
      return {
        ...sanitized,
        data: buildDeadCodeData(analysis),
      };
    }
    default:
      return sanitized;
  }
}

function sanitizeLlmAnswer(candidate, analysis, heuristicAnswer) {
  if (!candidate || typeof candidate !== "object" || !ALLOWED_ANSWER_TYPES.has(candidate.type)) {
    return null;
  }

  const answerText = sanitizeAssistantText(
    candidate.answerText || candidate.assistantMessage || candidate.message
  );

  const flowMap = getFlowIndex(analysis);
  let sanitized = {
    type: candidate.type,
    data: candidate.data,
    highlights: normalizeHighlights(candidate.highlights, flowMap),
  };

  if (sanitized.type === "flow_match") {
    const flowMatch = sanitizeFlowMatchData(sanitized.data, flowMap);
    if (!flowMatch) {
      return null;
    }
    sanitized = {
      ...sanitized,
      ...flowMatch,
    };
  }

  if (sanitized.type === "flow_explain") {
    const flowExplain = sanitizeFlowExplainData(sanitized.data, flowMap);
    if (!flowExplain) {
      return null;
    }
    sanitized = {
      ...sanitized,
      ...flowExplain,
    };
  }

  if (sanitized.type === "flow_compare") {
    const flowCompare = sanitizeFlowCompareData(candidate.data, flowMap);
    if (!flowCompare) {
      return null;
    }
    sanitized = {
      ...sanitized,
      ...flowCompare,
    };
  }

  if (sanitized.type === "fallback" && heuristicAnswer.type !== "fallback") {
    return {
      ...heuristicAnswer,
      answerText,
    };
  }

  const deterministicPayload = applyDeterministicTypePayload(sanitized, analysis);

  return {
    ...deterministicPayload,
    answerText,
  };
}

function getChatCompletionText(responsePayload) {
  const choice = responsePayload?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part?.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function buildLlmPrompts(question, analysis, heuristicAnswer) {
  const llmContext = buildLlmContext(question, analysis, heuristicAnswer);

  const systemPrompt = [
    "You are a query-classification assistant for a code-flow analyzer.",
    "Choose exactly one answer type from:",
    "summary, auth_routes, flow_match, flow_explain, flow_compare, dead_code, fallback.",
    "Return JSON only with this shape:",
    '{"type":"...","answerText":"short direct answer to the user","data":...,"highlights":{"flowIds":["flow-..."]}}',
    "answerText must be a concise natural-language answer (1-4 sentences).",
    "For flow_match, data must be an array of flow ids or objects with id.",
    "For flow_explain, data must be an array of objects with id only.",
    "For flow_compare, data must be an object: { flows: [flow ids or objects with id] }.",
    "Never invent flow ids. Use only ids provided in context.",
    "If uncertain, return fallback.",
  ].join("\n");

  const userPrompt = JSON.stringify(llmContext, null, 2);

  return {
    systemPrompt,
    userPrompt,
  };
}

async function callOpenAiForQuery(config, question, analysis, heuristicAnswer) {
  const { systemPrompt, userPrompt } = buildLlmPrompts(question, analysis, heuristicAnswer);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        max_output_tokens: 700,
        input: [
          {
            role: "system",
            content: [
              {
                type: "text",
                text: systemPrompt,
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const text = getResponseText(payload);

    return safeParseJson(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenRouterForQuery(config, question, analysis, heuristicAnswer) {
  const { systemPrompt, userPrompt } = buildLlmPrompts(question, analysis, heuristicAnswer);

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  if (config.siteUrl) {
    headers["HTTP-Referer"] = config.siteUrl;
  }

  if (config.appName) {
    headers["X-Title"] = config.appName;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const text = getChatCompletionText(payload);

    return safeParseJson(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callLlmForQuery(question, analysis, heuristicAnswer) {
  const config = resolveLlmConfig();
  if (!config) {
    return null;
  }

  const answer =
    config.provider === "openrouter"
      ? await callOpenRouterForQuery(config, question, analysis, heuristicAnswer)
      : await callOpenAiForQuery(config, question, analysis, heuristicAnswer);

  if (!answer) {
    return null;
  }

  return {
    answer,
    provider: config.provider,
    model: config.model,
  };
}

async function answerQuestion(question, analysis) {
  const heuristicAnswer = answerQuestionHeuristic(question, analysis);

  const llmResult = await callLlmForQuery(question, analysis, heuristicAnswer);
  if (!llmResult) {
    return {
      ...heuristicAnswer,
      strategy: "heuristic",
    };
  }

  const llmAnswer = sanitizeLlmAnswer(llmResult.answer, analysis, heuristicAnswer);
  if (!llmAnswer) {
    return {
      ...heuristicAnswer,
      strategy: "heuristic_fallback",
    };
  }

  return {
    ...llmAnswer,
    strategy: "llm_primary_with_heuristic_guardrails",
    llmProvider: llmResult.provider,
    llmModel: llmResult.model,
  };
}

module.exports = {
  answerQuestion,
  answerQuestionHeuristic,
};
