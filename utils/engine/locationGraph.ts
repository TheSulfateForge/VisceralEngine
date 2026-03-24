import { LocationGraph, LocationUpdate, LocationEdge, LocationNode, DebugLogEntry } from '../../types';
import { TRIANGLE_INEQUALITY_TOLERANCE } from '../../config/engineConfig';

// v1.20: Fuzzy match threshold for location name dedup
const LOCATION_FUZZY_THRESHOLD = 0.75;

/**
 * v1.20: Computes word-level Jaccard similarity between two location names.
 * Used to detect when the AI generates a different name for the same place.
 */
const locationNameSimilarity = (a: string, b: string): number => {
    const normalize = (s: string) => s.toLowerCase()
        .replace(/[''()\-]/g, ' ')
        .replace(/\b(the|a|an|of|at)\b/g, '')
        .split(/\s+/).filter(w => w.length >= 2);
    const wordsA = new Set(normalize(a));
    const wordsB = new Set(normalize(b));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) if (wordsB.has(w)) intersection++;
    return intersection / (wordsA.size + wordsB.size - intersection);
};

/**
 * v1.20: Find an existing node that fuzzy-matches the given name.
 * Returns the existing node's ID if a match is found at or above the threshold,
 * or null if the name is genuinely new.
 * 
 * Exact ID match is checked first (fast path). Fuzzy match is only used when
 * the normalized ID doesn't already exist.
 */
const findFuzzyMatchingNode = (
    name: string,
    nodes: Record<string, LocationNode>,
    debugLogs: DebugLogEntry[]
): string | null => {
    const candidateId = normalizeLocationId(name);

    // Exact ID match — no ambiguity
    if (nodes[candidateId]) return candidateId;

    // Fuzzy scan against all existing display names
    let bestMatch: { id: string; similarity: number; displayName: string } | null = null;
    for (const [nodeId, node] of Object.entries(nodes)) {
        const sim = locationNameSimilarity(name, node.displayName);
        if (sim >= LOCATION_FUZZY_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
            bestMatch = { id: nodeId, similarity: sim, displayName: node.displayName };
        }
    }

    if (bestMatch) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            type: 'info',
            message: `[LOCATION DEDUP — v1.20] "${name}" matched existing node "${bestMatch.displayName}" ` +
                `(${(bestMatch.similarity * 100).toFixed(0)}% similar). Using ID: ${bestMatch.id}`
        });
        return bestMatch.id;
    }

    return null; // Genuinely new location
};

/** Normalize a location name to a graph node ID. */
export const normalizeLocationId = (name: string): string => {
    return name.toLowerCase().trim().replace(/\s+/g, '_').replace(/^(the|a|an)_/i, '');
};

/** Given two location IDs, find the shortest travel time
 *  through the graph (Dijkstra). Returns Infinity if no path. */
export const getShortestTravelTime = (
    graph: LocationGraph,
    fromId: string,
    toId: string
): number => {
    if (fromId === toId) return 0;
    
    const distances: Record<string, number> = {};
    const unvisited = new Set<string>();
    
    for (const nodeId of Object.keys(graph.nodes)) {
        distances[nodeId] = Infinity;
        unvisited.add(nodeId);
    }
    distances[fromId] = 0;
    
    while (unvisited.size > 0) {
        let current: string | null = null;
        let minDistance = Infinity;
        
        for (const nodeId of unvisited) {
            if (distances[nodeId] < minDistance) {
                minDistance = distances[nodeId];
                current = nodeId;
            }
        }
        
        if (current === null || current === toId) break;
        
        unvisited.delete(current);
        
        const neighbors = graph.edges.filter(e => e.from === current || e.to === current);
        for (const edge of neighbors) {
            const neighborId = edge.from === current ? edge.to : edge.from;
            if (unvisited.has(neighborId)) {
                const alt = distances[current] + edge.travelTimeMinutes;
                if (alt < distances[neighborId]) {
                    distances[neighborId] = alt;
                }
            }
        }
    }
    
    return distances[toId] ?? Infinity;
};

/** Triangle inequality check — validates that new edges don't
 *  create impossible distance contradictions.
 *  A→B + B→C must be >= A→C (within tolerance). */
export const validateEdgeConsistency = (
    graph: LocationGraph,
    newEdge: LocationEdge,
    debugLogs: DebugLogEntry[]
): boolean => {
    const existingShortest = getShortestTravelTime(graph, newEdge.from, newEdge.to);
    
    // If the new edge is significantly longer than an existing path, it's fine (just a slower route).
    // If the new edge is significantly shorter, it might be a shortcut, but we should warn if it's absurdly shorter.
    // For now, we'll just accept it but log it.
    if (existingShortest !== Infinity && newEdge.travelTimeMinutes < existingShortest / TRIANGLE_INEQUALITY_TOLERANCE) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            type: 'warning',
            message: `[Location Graph] New edge ${newEdge.from}-${newEdge.to} (${newEdge.travelTimeMinutes}m) is significantly shorter than existing path (${existingShortest}m).`
        });
    }
    
    return true;
};

/** Process a location_update from the AI response.
 *  Creates new nodes, adds edges, validates consistency. */
export const processLocationUpdate = (
    graph: LocationGraph,
    update: LocationUpdate,
    currentTurn: number,
    debugLogs: DebugLogEntry[]
): LocationGraph => {
    const newGraph = {
        nodes: { ...graph.nodes },
        edges: [...graph.edges],
        playerLocationId: graph.playerLocationId
    };
    
    // v1.20: Fuzzy dedup — check if AI generated a different name for an existing place
    const fuzzyMatchId = findFuzzyMatchingNode(update.location_name, newGraph.nodes, debugLogs);
    const currentLocationId = fuzzyMatchId ?? normalizeLocationId(update.location_name);
    
    // Ensure current location node exists
    if (!newGraph.nodes[currentLocationId]) {
        newGraph.nodes[currentLocationId] = {
            id: currentLocationId,
            displayName: update.location_name,
            description: update.description,
            firstMentionedTurn: currentTurn,
            tags: update.tags || []
        };
    } else if (update.description && !newGraph.nodes[currentLocationId].description) {
        // v1.20: Backfill description if existing node was created without one
        newGraph.nodes[currentLocationId].description = update.description;
    }
    
    newGraph.playerLocationId = currentLocationId;
    
    // Process traveled_from
    if (update.traveled_from && update.travel_time_minutes !== undefined) {
        // v1.20: Fuzzy dedup on traveled_from
        const fromFuzzyId = findFuzzyMatchingNode(update.traveled_from, newGraph.nodes, debugLogs);
        const fromId = fromFuzzyId ?? normalizeLocationId(update.traveled_from);
        
        if (!newGraph.nodes[fromId]) {
            newGraph.nodes[fromId] = {
                id: fromId,
                displayName: update.traveled_from,
                firstMentionedTurn: currentTurn,
                tags: []
            };
        }
        
        const newEdge: LocationEdge = {
            from: fromId,
            to: currentLocationId,
            travelTimeMinutes: update.travel_time_minutes,
            source: 'player_travel',
            createdTurn: currentTurn
        };
        
        if (validateEdgeConsistency(newGraph, newEdge, debugLogs)) {
            // Check if edge already exists
            const existingEdgeIndex = newGraph.edges.findIndex(e => 
                (e.from === fromId && e.to === currentLocationId) || 
                (e.to === fromId && e.from === currentLocationId)
            );
            
            if (existingEdgeIndex >= 0) {
                // Update existing edge if the new travel time is faster
                if (update.travel_time_minutes < newGraph.edges[existingEdgeIndex].travelTimeMinutes) {
                    newGraph.edges[existingEdgeIndex] = newEdge;
                }
            } else {
                newGraph.edges.push(newEdge);
            }
        }
    }
    
    // Process nearby_locations
    if (update.nearby_locations && Array.isArray(update.nearby_locations)) {
        for (const nearby of update.nearby_locations) {
            // v1.20: Fuzzy dedup on nearby locations
            const nearbyFuzzyId = findFuzzyMatchingNode(nearby.name, newGraph.nodes, debugLogs);
            const nearbyId = nearbyFuzzyId ?? normalizeLocationId(nearby.name);
            
            if (!newGraph.nodes[nearbyId]) {
                newGraph.nodes[nearbyId] = {
                    id: nearbyId,
                    displayName: nearby.name,
                    firstMentionedTurn: currentTurn,
                    tags: []
                };
            }
            
            const newEdge: LocationEdge = {
                from: currentLocationId,
                to: nearbyId,
                travelTimeMinutes: nearby.travel_time_minutes,
                source: 'ai_declared',
                createdTurn: currentTurn,
                modeOverrides: nearby.mode ? { [nearby.mode]: nearby.travel_time_minutes } : undefined
            };
            
            if (validateEdgeConsistency(newGraph, newEdge, debugLogs)) {
                const existingEdgeIndex = newGraph.edges.findIndex(e => 
                    (e.from === currentLocationId && e.to === nearbyId) || 
                    (e.to === currentLocationId && e.from === nearbyId)
                );
                
                if (existingEdgeIndex >= 0) {
                    if (nearby.travel_time_minutes < newGraph.edges[existingEdgeIndex].travelTimeMinutes) {
                        newGraph.edges[existingEdgeIndex] = newEdge;
                    }
                } else {
                    newGraph.edges.push(newEdge);
                }
            }
        }
    }
    
    return newGraph;
};

/** Validate that a threat ETA is consistent with the distance
 *  between the threat's origin and the player's location.
 *  Used as an additional Origin Gate check. */
export const validateThreatDistanceConsistency = (
    graph: LocationGraph,
    threatOriginLocation: string,
    playerLocationId: string,
    claimedEtaTurns: number,
    minutesPerTurn: number,
    debugLogs: DebugLogEntry[]
): { valid: boolean; minimumEtaTurns?: number } => {
    const originId = normalizeLocationId(threatOriginLocation);
    
    if (!graph.nodes[originId] || !graph.nodes[playerLocationId]) {
        return { valid: true }; // Can't validate if locations aren't in graph
    }
    
    const travelTime = getShortestTravelTime(graph, originId, playerLocationId);
    if (travelTime === Infinity) {
        return { valid: true }; // No known path
    }
    
    const minimumEtaTurns = Math.ceil(travelTime / minutesPerTurn);
    
    if (claimedEtaTurns < minimumEtaTurns) {
        debugLogs.push({
            timestamp: new Date().toISOString(),
            type: 'warning',
            message: `[Origin Gate] Threat ETA (${claimedEtaTurns}) is too fast for distance. Minimum ETA is ${minimumEtaTurns} turns.`
        });
        return { valid: false, minimumEtaTurns };
    }
    
    return { valid: true };
};

/** Auto-infer location from narrative when no explicit
 *  location_update is provided. Matches against known
 *  node names in text. Returns updated playerLocationId if changed. */
export const inferPlayerLocation = (
    graph: LocationGraph,
    narrative: string,
    currentLocationId: string
): string => {
    const narrativeLower = narrative.toLowerCase();
    
    // Very basic inference: if a known location name appears in the narrative,
    // and the current location doesn't, we might have moved.
    // This is risky, so we only do it if we're sure.
    // For now, we'll just return the current location to be safe.
    return currentLocationId;
};

// ============================================================================
// v1.20: One-time save migration — merge duplicate location nodes
// Runs on save load. Identifies clusters of nodes with high name similarity,
// merges them into the earliest-created node, and re-points all edges.
// ============================================================================
export const deduplicateLocationGraph = (
    graph: LocationGraph,
    debugLogs: DebugLogEntry[]
): LocationGraph => {
    const nodes = { ...graph.nodes };
    let edges = [...graph.edges];
    let playerLocationId = graph.playerLocationId;

    const nodeEntries = Object.entries(nodes);
    const mergeMap: Record<string, string> = {}; // oldId → canonicalId

    // Build clusters of similar nodes
    const visited = new Set<string>();
    for (let i = 0; i < nodeEntries.length; i++) {
        const [idA, nodeA] = nodeEntries[i];
        if (visited.has(idA)) continue;

        const cluster: string[] = [idA];
        visited.add(idA);

        for (let j = i + 1; j < nodeEntries.length; j++) {
            const [idB, nodeB] = nodeEntries[j];
            if (visited.has(idB)) continue;

            const sim = locationNameSimilarity(nodeA.displayName, nodeB.displayName);
            if (sim >= LOCATION_FUZZY_THRESHOLD) {
                cluster.push(idB);
                visited.add(idB);
            }
        }

        if (cluster.length > 1) {
            // Canonical = earliest firstMentionedTurn, then longest description
            cluster.sort((a, b) => {
                const turnA = nodes[a].firstMentionedTurn ?? Infinity;
                const turnB = nodes[b].firstMentionedTurn ?? Infinity;
                if (turnA !== turnB) return turnA - turnB;
                return (nodes[b].description?.length ?? 0) - (nodes[a].description?.length ?? 0);
            });

            const canonicalId = cluster[0];
            const canonicalNode = nodes[canonicalId];

            // Merge descriptions — keep the longest
            for (let k = 1; k < cluster.length; k++) {
                const mergingNode = nodes[cluster[k]];
                if (mergingNode.description && (!canonicalNode.description ||
                    mergingNode.description.length > canonicalNode.description.length)) {
                    canonicalNode.description = mergingNode.description;
                }
                // Merge tags
                if (mergingNode.tags) {
                    canonicalNode.tags = [...new Set([...(canonicalNode.tags || []), ...mergingNode.tags])];
                }
                mergeMap[cluster[k]] = canonicalId;
                delete nodes[cluster[k]];
            }

            const mergedNames = cluster.slice(1).map(id => nodeEntries.find(([nid]) => nid === id)?.[1]?.displayName ?? id);
            debugLogs.push({
                timestamp: new Date().toISOString(),
                type: 'info',
                message: `[LOCATION MERGE — v1.20] Merged ${cluster.length} nodes into "${canonicalNode.displayName}": ` +
                    `[${mergedNames.join(', ')}]`
            });
        }
    }

    if (Object.keys(mergeMap).length === 0) return graph;

    // Re-point edges
    edges = edges.map(e => ({
        ...e,
        from: mergeMap[e.from] ?? e.from,
        to: mergeMap[e.to] ?? e.to
    }));

    // Remove self-loops created by merging
    edges = edges.filter(e => e.from !== e.to);

    // Remove duplicate edges (same from/to pair — keep shortest travel time)
    const edgeKey = (e: LocationEdge) => [e.from, e.to].sort().join('|');
    const bestEdges: Record<string, LocationEdge> = {};
    for (const e of edges) {
        const key = edgeKey(e);
        if (!bestEdges[key] || e.travelTimeMinutes < bestEdges[key].travelTimeMinutes) {
            bestEdges[key] = e;
        }
    }
    edges = Object.values(bestEdges);

    // Fix playerLocationId if it was merged
    if (mergeMap[playerLocationId]) {
        playerLocationId = mergeMap[playerLocationId];
    }

    debugLogs.push({
        timestamp: new Date().toISOString(),
        type: 'info',
        message: `[LOCATION MERGE — v1.20] Graph reduced: ${nodeEntries.length} → ${Object.keys(nodes).length} nodes, ` +
            `${graph.edges.length} → ${edges.length} edges.`
    });

    return { nodes, edges, playerLocationId };
};
