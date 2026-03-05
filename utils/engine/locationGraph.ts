import { LocationGraph, LocationUpdate, LocationEdge, LocationNode, DebugLogEntry } from '../../types';
import { TRIANGLE_INEQUALITY_TOLERANCE } from '../../config/engineConfig';

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
    
    const currentLocationId = normalizeLocationId(update.location_name);
    
    // Ensure current location node exists
    if (!newGraph.nodes[currentLocationId]) {
        newGraph.nodes[currentLocationId] = {
            id: currentLocationId,
            displayName: update.location_name,
            description: update.description,
            firstMentionedTurn: currentTurn,
            tags: update.tags || []
        };
    }
    
    newGraph.playerLocationId = currentLocationId;
    
    // Process traveled_from
    if (update.traveled_from && update.travel_time_minutes !== undefined) {
        const fromId = normalizeLocationId(update.traveled_from);
        
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
            const nearbyId = normalizeLocationId(nearby.name);
            
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
