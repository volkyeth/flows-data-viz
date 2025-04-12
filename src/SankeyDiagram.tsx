import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { useEffect, useRef, useState } from "react";

interface GrantItem {
  title: string;
  status: number;
  recipient: string;
  monthlyIncomingFlowRate: string;
  monthlyOutgoingFlowRate: string;
  flowId: string | null;
  isFlow: boolean;
  id: string;
}

interface SankeyDiagramProps {
  items: GrantItem[];
}

interface LocalSankeyNode {
  nodeId: string;
  name: string;
  title?: string;
  originalData?: GrantItem;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  value?: number;
  isRecipient?: boolean;
  isFlow?: boolean;
  username?: string;
  profileUrl?: string;
  flowUrl?: string;
  itemUrl?: string;
}

interface LocalSankeyLink {
  source: string | LocalSankeyNode;
  target: string | LocalSankeyNode;
  value: number;
  width?: number;
  y0?: number;
  y1?: number;
}

interface NeynarUserProfile {
  object: string;
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  custody_address: string;
  profile: {
    bio: {
      text: string;
    };
    location?: {
      latitude: number;
      longitude: number;
      address: {
        city: string;
        state: string;
        country: string;
        country_code: string;
      };
    };
  };
  follower_count: number;
  following_count: number;
  verifications: string[];
  verified_addresses: {
    eth_addresses: string[];
    sol_addresses: string[];
    primary: {
      eth_address: string | null;
      sol_address: string | null;
    };
  };
  verified_accounts: Array<{
    platform: string;
    username: string;
  }>;
  power_badge: boolean;
}

type NeynarResponse = Record<string, NeynarUserProfile[]>;

export default function SankeyDiagram({ items }: SankeyDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [recipientProfiles, setRecipientProfiles] = useState<Record<string, NeynarUserProfile>>({});

  // Set up ResizeObserver to handle container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      if (!entries.length) return;
      
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Fetch recipient profile data from Neynar API
  useEffect(() => {
    async function fetchRecipientProfiles() {
      // Collect unique recipient addresses
      const uniqueRecipients = new Set<string>();
      items.forEach(item => {
        if (item.recipient && parseFloat(item.monthlyOutgoingFlowRate) === 0) {
          uniqueRecipients.add(item.recipient.toLowerCase());
        }
      });

      if (uniqueRecipients.size === 0) return;

      try {
        // Format addresses for the API request
        const addresses = Array.from(uniqueRecipients).join('%2C');
        const url = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${addresses}&address_types=`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'x-neynar-experimental': 'false',
            'x-api-key': 'NEYNAR_API_DOCS'
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch recipient profiles');
        }

        const data: NeynarResponse = await response.json();
        
        // Process the response into a more usable format
        const profiles: Record<string, NeynarUserProfile> = {};
        
        Object.entries(data).forEach(([address, users]) => {
          if (users.length > 0) {
            profiles[address.toLowerCase()] = users[0];
          }
        });

        setRecipientProfiles(profiles);
      } catch (error) {
        console.error('Error fetching recipient profiles:', error);
      }
    }

    fetchRecipientProfiles();
  }, [items]);

  // Main effect to render the diagram
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !items.length || dimensions.width === 0 || dimensions.height === 0) return;

    const { width, height } = dimensions;
    const margin = { top: 20, right: 150, bottom: 20, left: 150 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Prepare data for Sankey diagram
    const FUNDING_SOURCE_ID = "___funding_source___";
    const nodesMap = new Map<string, LocalSankeyNode>();
    const links: LocalSankeyLink[] = [];

    // Add virtual funding source node
    nodesMap.set(FUNDING_SOURCE_ID, {
      nodeId: FUNDING_SOURCE_ID,
      name: "Funding Source"
    });

    // First pass: Process all nodes
    items.forEach(item => {
      nodesMap.set(item.id, {
        nodeId: item.id,
        name: item.title || item.id,
        title: item.title,
        originalData: item,
        isFlow: item.isFlow,
        flowUrl: item.isFlow ? `https://flows.wtf/flow/${item.id}` : undefined,
        itemUrl: `https://flows.wtf/item/${item.id}`
      });
    });

    // Create recipient nodes for terminal grants (monthlyOutgoingFlowRate = 0)
    const RECIPIENT_PREFIX = "recipient_";
    items.forEach(item => {
      if (parseFloat(item.monthlyOutgoingFlowRate) === 0 && item.recipient) {
        const recipientId = `${RECIPIENT_PREFIX}${item.recipient}`;
        const recipientLowerCase = item.recipient.toLowerCase();
        const profile = recipientProfiles[recipientLowerCase];
        
        // Format name using profile data if available
        let name = item.recipient;
        let username = undefined;
        let profileUrl = undefined;
        
        if (profile) {
          name = `${profile.display_name} (${profile.username})`;
          username = profile.username;
          profileUrl = `https://warpcast.com/${profile.username}`;
        }
        
        // Only add if the recipient node doesn't already exist
        if (!nodesMap.has(recipientId)) {
          nodesMap.set(recipientId, {
            nodeId: recipientId,
            name: name,
            title: profile ? `Recipient: ${profile.display_name}` : `Recipient: ${item.recipient}`,
            isRecipient: true,
            username,
            profileUrl
          });
        }
      }
    });

    // Second pass: Process all links
    items.forEach(item => {
      const value = parseFloat(item.monthlyIncomingFlowRate);
      
      if (value <= 0) return;
      
      const targetNodeId = item.id;
      const sourceNodeId = item.flowId;
      const actualSourceId = sourceNodeId && nodesMap.has(sourceNodeId) 
        ? sourceNodeId 
        : FUNDING_SOURCE_ID;
      
      if (nodesMap.has(targetNodeId)) {
        links.push({
          source: actualSourceId,
          target: targetNodeId,
          value
        });
      }
    });

    // Add links from terminal grants to their recipient nodes
    items.forEach(item => {
      if (parseFloat(item.monthlyOutgoingFlowRate) === 0 && item.recipient) {
        const recipientId = `${RECIPIENT_PREFIX}${item.recipient}`;
        const grantValue = parseFloat(item.monthlyIncomingFlowRate);
        
        if (grantValue > 0 && nodesMap.has(recipientId)) {
          links.push({
            source: item.id,
            target: recipientId,
            value: grantValue, // Using the same value as incoming to the grant
          });
        }
      }
    });

    // Remove the funding source if it has no outgoing links
    if (!links.some(link => link.source === FUNDING_SOURCE_ID)) {
      nodesMap.delete(FUNDING_SOURCE_ID);
    }

    // Filter out nodes with no connected links (value of 0)
    const nodesWithLinks = new Set<string>();
    
    // Collect all nodes that appear in links
    links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.nodeId;
      const targetId = typeof link.target === 'string' ? link.target : link.target.nodeId;
      
      nodesWithLinks.add(sourceId);
      nodesWithLinks.add(targetId);
    });
    
    // Filter the nodesMap to only include nodes with connections
    const filteredNodesMap = new Map<string, LocalSankeyNode>();
    nodesMap.forEach((node, id) => {
      if (nodesWithLinks.has(id)) {
        filteredNodesMap.set(id, node);
      }
    });
    
    // Filter links to only include those with both source and target in the filtered nodes
    const filteredLinks = links.filter(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.nodeId;
      const targetId = typeof link.target === 'string' ? link.target : link.target.nodeId;
      
      return filteredNodesMap.has(sourceId) && filteredNodesMap.has(targetId);
    });

    // Prepare final graph data
    const graph = {
      nodes: Array.from(filteredNodesMap.values()),
      links: filteredLinks
    };

    // Calculate the total value to better proportion the diagram
    const totalValue = filteredLinks.reduce((sum, link) => sum + link.value, 0);

    
    // Determine an appropriate height based on total value
    const valueScaledHeight = Math.max(
      innerHeight,
      Math.min(innerHeight * 6, totalValue / 10000 * innerHeight)
    );

    // Set up D3 Sankey layout
    const sankeyLayout = sankey<LocalSankeyNode, LocalSankeyLink>()
      .nodeId(d => d.nodeId)
      .nodeWidth(32)
      .nodePadding(2)
      .extent([[0, 0], [innerWidth, valueScaledHeight]])
      .iterations(10);

    // Compute layout
    const { nodes, links: layoutLinks } = sankeyLayout(graph);

    // Clear existing SVG content
    d3.select(svgRef.current).selectAll("*").remove();

    // Set up SVG
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);
    
    // Create main group with margin
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Set up color scale
    const color = d3.scaleOrdinal(d3.schemeCategory10);

    // Draw links
    const link = g.append("g")
      .selectAll("path")
      .data(layoutLinks)
      .join("path")
      .attr("d", sankeyLinkHorizontal())
      .attr("stroke-width", d => Math.max(1, d.width || 0))
      .attr("stroke", d => {
        const sourceId = typeof d.source === 'object' ? d.source.nodeId : d.source;
        return color(sourceId as string);
      })
      .attr("stroke-opacity", 0.5)
      .attr("fill", "none")
      .style("mix-blend-mode", "multiply");

    // Add hover effect for links
    link
      .append("title")
      .text(d => {
        const sourceName = typeof d.source === 'object' ? d.source.name : 'Unknown';
        const targetName = typeof d.target === 'object' ? d.target.name : 'Unknown';
        return `${sourceName} → ${targetName}: ${d.value.toLocaleString()}`;
      });

    // Draw nodes
    const node = g.append("g")
      .selectAll(".node")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.x0},${d.y0})`);

    // Node rectangles
    node.append("rect")
      .attr("height", d => Math.max(1, (d.y1 || 0) - (d.y0 || 0)))
      .attr("width", d => (d.x1 || 0) - (d.x0 || 0))
      .attr("fill", d => color(d.nodeId))
      .attr("opacity", 0.8)
      .append("title")
      .text(d => `${d.title || d.name}: ${d.value?.toLocaleString() || 'N/A'}`);

    // Add link icon to nodes
    node.append("text")
      .attr("class", "link-icon")
      .attr("x", d => ((d.x1 || 0) - (d.x0 || 0)) - 18) // Position near right edge of node
      .attr("y", d => ((d.y1 || 0) - (d.y0 || 0)) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("font-size", "12px")
      .text("🔗")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        if (d.isRecipient && d.profileUrl) {
          window.open(d.profileUrl, "_blank");
        } else if (d.isFlow && d.flowUrl) {
          window.open(d.flowUrl, "_blank");
        } else if (!d.isRecipient && d.itemUrl) {
          window.open(d.itemUrl, "_blank");
        }
      });
      
    // Create clickable areas for recipient nodes and flow nodes
    node.each(function(d) {
      const nodeGroup = d3.select(this);
      
      if (d.isRecipient && d.profileUrl) {
        // Create clickable overlay with pointer cursor
        nodeGroup.append("rect")
          .attr("height", Math.max(1, (d.y1 || 0) - (d.y0 || 0)))
          .attr("width", (d.x1 || 0) - (d.x0 || 0))
          .attr("fill", "transparent")
          .attr("cursor", "pointer")
          .on("click", () => {
            window.open(d.profileUrl, "_blank");
          });
      }
      else if (d.isFlow && d.flowUrl) {
        // Create clickable overlay for flow nodes
        nodeGroup.append("rect")
          .attr("height", Math.max(1, (d.y1 || 0) - (d.y0 || 0)))
          .attr("width", (d.x1 || 0) - (d.x0 || 0))
          .attr("fill", "transparent")
          .attr("cursor", "pointer")
          .on("click", () => {
            window.open(d.flowUrl, "_blank");
          });
      }
      // Add clickable overlay for regular (item) nodes
      else if (d.itemUrl && !d.isRecipient) {
        nodeGroup.append("rect")
          .attr("height", Math.max(1, (d.y1 || 0) - (d.y0 || 0)))
          .attr("width", (d.x1 || 0) - (d.x0 || 0))
          .attr("fill", "transparent")
          .attr("cursor", "pointer")
          .on("click", () => {
            window.open(d.itemUrl, "_blank");
          });
      }
    });

    // Node labels
    node.append("text")
      .attr("x", d => (d.x1 || 0) - (d.x0 || 0) + 6)
      .attr("y", d => ((d.y1 || 0) - (d.y0 || 0)) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "start")
      .text(d => d.name)
      .attr("font-size", "10px")
      .attr("font-family", "sans-serif")
      .attr("cursor", d => (d.isRecipient && d.profileUrl) || (d.isFlow && d.flowUrl) || (!d.isRecipient && d.itemUrl) ? "pointer" : "default")
      .on("click", (event, d) => {
        if (d.isRecipient && d.profileUrl) {
          window.open(d.profileUrl, "_blank");
        } else if (d.isFlow && d.flowUrl) {
          window.open(d.flowUrl, "_blank");
        } else if (!d.isRecipient && d.itemUrl) {
          window.open(d.itemUrl, "_blank");
        }
      });

    // Set up zoom and pan
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoomBehavior);

    // Calculate initial zoom to fit the diagram
    // Find maximum x1 and y1 values to determine diagram dimensions
    let maxX1 = 0;
    let maxY1 = 0;
    
    nodes.forEach(node => {
      if (node.x1 !== undefined && node.x1 > maxX1) maxX1 = node.x1;
      if (node.y1 !== undefined && node.y1 > maxY1) maxY1 = node.y1;
    });
    
    if (maxX1 > 0 && maxY1 > 0) {
      const scale = Math.min(
        innerWidth / maxX1,
        innerHeight / maxY1,
        1.0
      ) * 0.9;
      
      const translateX = margin.left + (innerWidth - maxX1 * scale) / 2;
      const translateY = margin.top + (innerHeight - maxY1 * scale) / 2;
      
      svg.call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(translateX, translateY).scale(scale)
      );
    }
  }, [items, dimensions, recipientProfiles]);

  return (
    <div ref={containerRef} className="w-full flex flex-col flex-grow overflow-hidden">
      <svg ref={svgRef} width="100%" height="100%" />
    </div>
  );
} 