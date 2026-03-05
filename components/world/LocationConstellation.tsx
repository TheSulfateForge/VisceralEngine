import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store';
import { LocationNode, LocationEdge } from '../../types';

interface LayoutNode extends LocationNode {
    x: number;
    y: number;
    vx: number;
    vy: number;
    pinned: boolean;
    mass: number;
}

const SPRING_STRENGTH = 0.005;
const REPULSION_STRENGTH = 500;
const DAMPING = 0.85;
const REST_DISTANCE_SCALE = 0.5; // pixels per minute of travel

export const LocationConstellation: React.FC = () => {
    const { gameWorld } = useGameStore();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [nodes, setNodes] = useState<Record<string, LayoutNode>>({});
    const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
    const [draggedNode, setDraggedNode] = useState<string | null>(null);
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
    const lastMousePos = useRef({ x: 0, y: 0 });

    const graph = gameWorld.locationGraph;

    // Initialize nodes
    useEffect(() => {
        if (!graph) return;

        setNodes(prev => {
            const next = { ...prev };
            let added = false;

            for (const [id, node] of Object.entries(graph.nodes)) {
                if (!next[id]) {
                    // Calculate mass based on edges
                    const edgeCount = graph.edges.filter(e => e.from === id || e.to === id).length;
                    
                    next[id] = {
                        ...node,
                        x: Math.random() * 800,
                        y: Math.random() * 600,
                        vx: 0,
                        vy: 0,
                        pinned: false,
                        mass: 1 + edgeCount * 0.5
                    };
                    added = true;
                }
            }
            return added ? next : prev;
        });
    }, [graph]);

    // Force simulation loop
    useEffect(() => {
        if (!graph || Object.keys(nodes).length === 0) return;

        let animationFrameId: number;

        const simulate = () => {
            setNodes(prev => {
                const next = { ...prev };
                const nodeIds = Object.keys(next);

                // Apply repulsion
                for (let i = 0; i < nodeIds.length; i++) {
                    for (let j = i + 1; j < nodeIds.length; j++) {
                        const n1 = next[nodeIds[i]];
                        const n2 = next[nodeIds[j]];
                        
                        const dx = n2.x - n1.x;
                        const dy = n2.y - n1.y;
                        const distSq = dx * dx + dy * dy;
                        
                        if (distSq > 0) {
                            const dist = Math.sqrt(distSq);
                            const force = REPULSION_STRENGTH / distSq;
                            const fx = (dx / dist) * force;
                            const fy = (dy / dist) * force;

                            if (!n1.pinned) {
                                n1.vx -= fx / n1.mass;
                                n1.vy -= fy / n1.mass;
                            }
                            if (!n2.pinned) {
                                n2.vx += fx / n2.mass;
                                n2.vy += fy / n2.mass;
                            }
                        }
                    }
                }

                // Apply spring forces (edges)
                for (const edge of graph.edges) {
                    const n1 = next[edge.from];
                    const n2 = next[edge.to];
                    
                    if (!n1 || !n2) continue;

                    const dx = n2.x - n1.x;
                    const dy = n2.y - n1.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist > 0) {
                        const restDist = edge.travelTimeMinutes * REST_DISTANCE_SCALE;
                        const force = (dist - restDist) * SPRING_STRENGTH;
                        const fx = (dx / dist) * force;
                        const fy = (dy / dist) * force;

                        if (!n1.pinned) {
                            n1.vx += fx / n1.mass;
                            n1.vy += fy / n1.mass;
                        }
                        if (!n2.pinned) {
                            n2.vx -= fx / n2.mass;
                            n2.vy -= fy / n2.mass;
                        }
                    }
                }

                // Centering force for player location
                if (graph.playerLocationId && next[graph.playerLocationId]) {
                    const playerNode = next[graph.playerLocationId];
                    const cx = 400; // Canvas center X
                    const cy = 300; // Canvas center Y
                    const dx = cx - playerNode.x;
                    const dy = cy - playerNode.y;
                    
                    if (!playerNode.pinned) {
                        playerNode.vx += dx * 0.01;
                        playerNode.vy += dy * 0.01;
                    }
                }

                // Update positions
                let moved = false;
                for (const id of nodeIds) {
                    const n = next[id];
                    if (!n.pinned) {
                        n.vx *= DAMPING;
                        n.vy *= DAMPING;
                        n.x += n.vx;
                        n.y += n.vy;
                        
                        if (Math.abs(n.vx) > 0.1 || Math.abs(n.vy) > 0.1) {
                            moved = true;
                        }
                    }
                }

                return moved ? next : prev;
            });

            animationFrameId = requestAnimationFrame(simulate);
        };

        simulate();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [graph, nodes]);

    // Render loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !graph) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.scale, transform.scale);

        // Draw edges
        for (const edge of graph.edges) {
            const n1 = nodes[edge.from];
            const n2 = nodes[edge.to];
            if (!n1 || !n2) continue;

            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            
            // Edge thickness based on travel time
            const thickness = Math.max(0.5, 3 - (edge.travelTimeMinutes / 100));
            ctx.lineWidth = thickness;
            ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.stroke();

            // Draw travel time label
            const mx = (n1.x + n2.x) / 2;
            const my = (n1.y + n2.y) / 2;
            ctx.fillStyle = 'rgba(150, 150, 150, 0.8)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const timeStr = edge.travelTimeMinutes > 120 
                ? `${Math.round(edge.travelTimeMinutes / 60)}h` 
                : `${edge.travelTimeMinutes}m`;
                
            ctx.fillText(timeStr, mx, my);
        }

        // Draw nodes
        for (const [id, node] of Object.entries(nodes)) {
            const isPlayerHere = id === graph.playerLocationId;
            const isHovered = hoveredNode?.id === id;
            
            // Draw node circle
            ctx.beginPath();
            const radius = isPlayerHere ? 8 : 5 + (node.mass * 0.5);
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            
            if (isPlayerHere) {
                ctx.fillStyle = '#eab308'; // Gold
                ctx.shadowColor = '#eab308';
                ctx.shadowBlur = 10;
            } else {
                ctx.fillStyle = '#ffffff';
                ctx.shadowBlur = 0;
            }
            
            ctx.fill();
            ctx.shadowBlur = 0; // Reset shadow

            // Draw node label
            ctx.fillStyle = isHovered ? '#ffffff' : '#a3a3a3';
            ctx.font = isHovered ? 'bold 12px sans-serif' : '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(node.displayName, node.x, node.y + radius + 4);

            // Draw NPCs at this location
            const npcsHere = gameWorld.knownEntities?.filter(e => 
                (e.status === 'present' || e.status === 'nearby' || e.status === 'distant') && 
                e.location?.toLowerCase().includes(node.displayName.toLowerCase())
            ) || [];

            if (npcsHere.length > 0) {
                const dotRadius = 2;
                const spacing = 6;
                const startX = node.x - ((npcsHere.length - 1) * spacing) / 2;
                
                npcsHere.forEach((npc, idx) => {
                    ctx.beginPath();
                    ctx.arc(startX + idx * spacing, node.y - radius - 6, dotRadius, 0, Math.PI * 2);
                    
                    // Color based on relationship
                    switch (npc.relationship_level) {
                        case 'NEMESIS': ctx.fillStyle = '#dc2626'; break;
                        case 'HOSTILE': ctx.fillStyle = '#ef4444'; break;
                        case 'COLD': ctx.fillStyle = '#3b82f6'; break;
                        case 'WARM': ctx.fillStyle = '#22c55e'; break;
                        case 'ALLIED': ctx.fillStyle = '#4ade80'; break;
                        case 'DEVOTED': ctx.fillStyle = '#a855f7'; break;
                        default: ctx.fillStyle = '#9ca3af';
                    }
                    ctx.fill();
                });
            }
        }

        ctx.restore();
    }, [nodes, graph, transform, hoveredNode, gameWorld.knownEntities]);

    // Interaction handlers
    const getMousePos = (e: React.MouseEvent | React.WheelEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return {
            x: (e.clientX - rect.left - transform.x) / transform.scale,
            y: (e.clientY - rect.top - transform.y) / transform.scale
        };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const pos = getMousePos(e);
        
        if (draggedNode) {
            setNodes(prev => ({
                ...prev,
                [draggedNode]: {
                    ...prev[draggedNode],
                    x: pos.x,
                    y: pos.y,
                    vx: 0,
                    vy: 0
                }
            }));
        } else if (isDraggingCanvas) {
            setTransform(prev => ({
                ...prev,
                x: prev.x + (e.clientX - lastMousePos.current.x),
                y: prev.y + (e.clientY - lastMousePos.current.y)
            }));
        } else {
            // Hover detection
            let foundHover = null;
            for (const node of Object.values(nodes)) {
                const dx = pos.x - node.x;
                const dy = pos.y - node.y;
                if (dx * dx + dy * dy < 100) { // 10px radius
                    foundHover = node;
                    break;
                }
            }
            setHoveredNode(foundHover);
        }
        
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (hoveredNode) {
            setDraggedNode(hoveredNode.id);
            setNodes(prev => ({
                ...prev,
                [hoveredNode.id]: { ...prev[hoveredNode.id], pinned: true }
            }));
        } else {
            setIsDraggingCanvas(true);
        }
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
        if (draggedNode) {
            setNodes(prev => ({
                ...prev,
                [draggedNode]: { ...prev[draggedNode], pinned: false }
            }));
            setDraggedNode(null);
        }
        setIsDraggingCanvas(false);
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const scaleAdjust = e.deltaY > 0 ? 0.9 : 1.1;
        
        // Zoom towards mouse position
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        setTransform(prev => ({
            x: mouseX - (mouseX - prev.x) * scaleAdjust,
            y: mouseY - (mouseY - prev.y) * scaleAdjust,
            scale: prev.scale * scaleAdjust
        }));
    };

    if (!graph || Object.keys(graph.nodes).length === 0) {
        return (
            <div className="flex items-center justify-center h-96 border border-gray-800 bg-black/20 rounded-lg">
                <p className="text-gray-500 italic">Locations will appear here as you explore the world.</p>
            </div>
        );
    }

    return (
        <div className="relative border border-gray-800 bg-black/40 rounded-lg overflow-hidden">
            <canvas
                ref={canvasRef}
                width={800}
                height={600}
                className="w-full h-auto cursor-grab active:cursor-grabbing"
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
            />
            
            {/* Tooltip */}
            {hoveredNode && (
                <div className="absolute bottom-4 left-4 bg-gray-900 border border-gray-700 p-4 rounded shadow-lg max-w-sm pointer-events-none">
                    <h4 className="text-white font-bold">{hoveredNode.displayName}</h4>
                    {hoveredNode.description && (
                        <p className="text-gray-400 text-sm mt-1">{hoveredNode.description}</p>
                    )}
                    {hoveredNode.tags && hoveredNode.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {hoveredNode.tags.map(tag => (
                                <span key={tag} className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
            
            {/* Controls hint */}
            <div className="absolute top-4 right-4 text-[10px] text-gray-500 uppercase tracking-widest text-right pointer-events-none">
                <p>Scroll to zoom</p>
                <p>Drag to pan</p>
                <p>Drag nodes to pin</p>
            </div>
        </div>
    );
};
