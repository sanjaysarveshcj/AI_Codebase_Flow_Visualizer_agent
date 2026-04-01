import { MarkerType, Position } from "@xyflow/react";

const TYPE_STYLES = {
  api_call: {
    color: "#92400e",
    background: "#ffedd5",
    border: "#f97316",
    lane: 0,
    label: "Frontend API Call"
  },
  express_route: {
    color: "#134e4a",
    background: "#ccfbf1",
    border: "#14b8a6",
    lane: 1,
    label: "Backend Route"
  },
  middleware: {
    color: "#4c1d95",
    background: "#ede9fe",
    border: "#8b5cf6",
    lane: 2,
    label: "Middleware"
  },
  controller: {
    color: "#0f172a",
    background: "#e2e8f0",
    border: "#475569",
    lane: 3,
    label: "Controller"
  },
  function: {
    color: "#7c2d12",
    background: "#ffedd5",
    border: "#f97316",
    lane: 4,
    label: "Helper Function"
  },
  db_operation: {
    color: "#14532d",
    background: "#dcfce7",
    border: "#22c55e",
    lane: 5,
    label: "DB Operation"
  },
  mongoose_model: {
    color: "#1f2937",
    background: "#e5e7eb",
    border: "#6b7280",
    lane: 6,
    label: "Database Model"
  }
};

function styleForType(type) {
  return TYPE_STYLES[type] || {
    color: "#1f2937",
    background: "#f3f4f6",
    border: "#9ca3af",
    lane: 1,
    label: "Code Node"
  };
}

function laneForType(type) {
  return styleForType(type).lane;
}

function buildNodePositions(nodes) {
  const laneBuckets = new Map();

  for (const node of nodes) {
    const lane = laneForType(node.type);
    if (!laneBuckets.has(lane)) {
      laneBuckets.set(lane, []);
    }

    laneBuckets.get(lane).push(node);
  }

  for (const bucket of laneBuckets.values()) {
    bucket.sort((a, b) => a.label.localeCompare(b.label));
  }

  const positions = new Map();

  for (const [lane, bucket] of laneBuckets.entries()) {
    bucket.forEach((node, index) => {
      positions.set(node.id, {
        x: 80 + lane * 360,
        y: 80 + index * 160
      });
    });
  }

  return positions;
}

function collectFlowEdgeIds(edges, activeFlowId) {
  const highlightedEdges = new Set();

  if (!activeFlowId) {
    return highlightedEdges;
  }

  for (const edge of edges) {
    if (edge.meta?.flowId === activeFlowId) {
      highlightedEdges.add(edge.id);
    }
  }

  return highlightedEdges;
}

function collectNodeNeighborEdgeIds(edges, activeNodeId) {
  const highlightedEdges = new Set();

  if (!activeNodeId) {
    return highlightedEdges;
  }

  for (const edge of edges) {
    if (edge.source === activeNodeId || edge.target === activeNodeId) {
      highlightedEdges.add(edge.id);
    }
  }

  return highlightedEdges;
}

function collectHighlightedNodes(edges, highlightedEdges, activeNodeId) {
  const highlightedNodes = new Set();

  if (activeNodeId) {
    highlightedNodes.add(activeNodeId);
  }

  for (const edge of edges) {
    if (highlightedEdges.has(edge.id)) {
      highlightedNodes.add(edge.source);
      highlightedNodes.add(edge.target);
    }
  }

  return highlightedNodes;
}

function getHighlightState(graph, activeFlowId, activeNodeId, playbackHighlight) {
  const edges = graph.edges || [];
  const highlightedEdges = collectFlowEdgeIds(edges, activeFlowId);
  const nodeNeighborEdges = collectNodeNeighborEdgeIds(edges, activeNodeId);

  for (const edgeId of nodeNeighborEdges) {
    highlightedEdges.add(edgeId);
  }

  if (playbackHighlight?.edgeIds) {
    for (const edgeId of playbackHighlight.edgeIds) {
      highlightedEdges.add(edgeId);
    }
  }

  const highlightedNodes = collectHighlightedNodes(edges, highlightedEdges, activeNodeId);

  if (playbackHighlight?.nodeIds) {
    for (const nodeId of playbackHighlight.nodeIds) {
      highlightedNodes.add(nodeId);
    }
  }

  return {
    highlightedEdges,
    highlightedNodes
  };
}

export function toReactFlowElements(graph, activeFlowId, activeNodeId, playbackHighlight) {
  if (!graph) {
    return {
      nodes: [],
      edges: []
    };
  }

  const positions = buildNodePositions(graph.nodes || []);
  const { highlightedEdges, highlightedNodes } = getHighlightState(
    graph,
    activeFlowId,
    activeNodeId,
    playbackHighlight
  );

  const hasHighlight = highlightedEdges.size > 0 || highlightedNodes.size > 0;

  const nodes = (graph.nodes || []).map((node) => {
    const typeTheme = styleForType(node.type);
    const isHighlighted = highlightedNodes.has(node.id);

    return {
      id: node.id,
      position: positions.get(node.id) || { x: 0, y: 0 },
      data: {
        label: node.label,
        meta: node.meta,
        category: typeTheme.label
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        width: 250,
        borderRadius: 14,
        border: `2px solid ${typeTheme.border}`,
        color: typeTheme.color,
        background: typeTheme.background,
        boxShadow: isHighlighted
          ? "0 10px 30px rgba(20, 184, 166, 0.22)"
          : "0 6px 20px rgba(15, 23, 42, 0.08)",
        opacity: hasHighlight && !isHighlighted ? 0.35 : 1,
        transition: "all 180ms ease"
      }
    };
  });

  const edges = (graph.edges || []).map((edge) => {
    const isHighlighted = highlightedEdges.has(edge.id);

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "smoothstep",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: isHighlighted ? "#0f766e" : "#9ca3af"
      },
      style: {
        strokeWidth: isHighlighted ? 3.5 : 1.8,
        stroke: isHighlighted ? "#0f766e" : "#9ca3af",
        opacity: hasHighlight && !isHighlighted ? 0.25 : 0.85
      },
      animated: isHighlighted,
      labelStyle: {
        fill: "#1f2937",
        fontWeight: 600,
        fontSize: 12
      }
    };
  });

  return {
    nodes,
    edges
  };
}
