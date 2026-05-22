/**
 * TenantTree Component
 *
 * Displays tenants in a hierarchical tree structure based on their code.
 * Tenant codes follow the pattern: state.city (e.g., statea.citya)
 */

import { useState } from 'react';
import { ChevronRight, ChevronDown, Building2, MapPin, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './badge';


interface Tenant {
  code: string;
  name: string;
  description: string;
  logoUrl?: string;
  status: 'active' | 'inactive';
}

interface TreeNode {
  code: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  level: number;
  children: TreeNode[];
  isLeaf: boolean;
}

interface TenantTreeProps {
  tenants: Tenant[];
  onSelectTenant?: (tenant: Tenant) => void;
  selectedCode?: string;
}

// Build tree structure from flat tenant list
function buildTree(tenants: Tenant[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Sort tenants by code to ensure parents come before children
  const sorted = [...tenants].sort((a, b) => a.code.localeCompare(b.code));

  sorted.forEach(tenant => {
    const parts = tenant.code.split('.');
    const level = parts.length - 1;

    const node: TreeNode = {
      code: tenant.code,
      name: tenant.name,
      description: tenant.description,
      status: tenant.status,
      level,
      children: [],
      isLeaf: true,
    };

    nodeMap.set(tenant.code, node);

    if (level === 0) {
      // Root node (state level)
      roots.push(node);
    } else {
      // Find parent
      const parentCode = parts.slice(0, -1).join('.');
      const parent = nodeMap.get(parentCode);
      if (parent) {
        parent.children.push(node);
        parent.isLeaf = false;
      } else {
        // Parent not found, treat as root
        roots.push(node);
      }
    }
  });

  return roots;
}

interface TreeNodeComponentProps {
  node: TreeNode;
  onSelect?: (node: TreeNode) => void;
  selectedCode?: string;
  defaultExpanded?: boolean;
}

function TreeNodeComponent({ node, onSelect, selectedCode, defaultExpanded = true }: TreeNodeComponentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedCode === node.code;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const handleSelect = () => {
    onSelect?.(node);
  };

  // Icon based on level
  const Icon = node.level === 0 ? Building2 : node.level === 1 ? MapPin : Circle;

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-3 rounded-md cursor-pointer transition-colors",
          "hover:bg-accent",
          isSelected && "bg-primary/10 border border-primary/20"
        )}
        onClick={handleSelect}
        style={{ paddingLeft: `${node.level * 24 + 12}px` }}
      >
        {/* Expand/collapse toggle */}
        <button
          onClick={handleToggle}
          className={cn(
            "w-5 h-5 flex items-center justify-center rounded hover:bg-muted",
            !hasChildren && "invisible"
          )}
        >
          {hasChildren && (
            expanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )
          )}
        </button>

        {/* Node icon */}
        <div className={cn(
          "w-8 h-8 rounded-md flex items-center justify-center",
          node.level === 0 ? "bg-primary/10" : "bg-muted"
        )}>
          <Icon className={cn(
            "w-4 h-4",
            node.level === 0 ? "text-primary" : "text-muted-foreground"
          )} />
        </div>

        {/* Node content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "font-medium truncate",
              node.level === 0 && "text-primary"
            )}>
              {node.name}
            </span>
            <Badge
              variant={node.status === 'active' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {node.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {node.code}
          </div>
        </div>

        {/* Children count */}
        {hasChildren && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {node.children.length} {node.children.length === 1 ? 'child' : 'children'}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="relative">
          {/* Vertical line connecting children */}
          <div
            className="absolute left-0 top-0 bottom-0 border-l-2 border-dashed border-muted"
            style={{ marginLeft: `${node.level * 24 + 24}px` }}
          />
          {node.children.map(child => (
            <TreeNodeComponent
              key={child.code}
              node={child}
              onSelect={onSelect}
              selectedCode={selectedCode}
              defaultExpanded={node.level < 1} // Auto-expand first two levels
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TenantTree({ tenants, onSelectTenant, selectedCode }: TenantTreeProps) {
  const tree = buildTree(tenants);

  const handleSelect = (node: TreeNode) => {
    const tenant = tenants.find(t => t.code === node.code);
    if (tenant && onSelectTenant) {
      onSelectTenant(tenant);
    }
  };

  if (tree.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No tenants to display</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card p-2">
      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 mb-2 text-xs text-muted-foreground border-b">
        <div className="flex items-center gap-1">
          <Building2 className="w-3 h-3" />
          <span>State</span>
        </div>
        <div className="flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          <span>City/ULB</span>
        </div>
        <div className="flex items-center gap-1">
          <Circle className="w-3 h-3" />
          <span>Sub-unit</span>
        </div>
      </div>

      {/* Tree nodes */}
      <div className="space-y-1">
        {tree.map(node => (
          <TreeNodeComponent
            key={node.code}
            node={node}
            onSelect={handleSelect}
            selectedCode={selectedCode}
            defaultExpanded={true}
          />
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between px-3 py-2 mt-2 text-xs text-muted-foreground border-t">
        <span>{tenants.length} total tenants</span>
        <span>{tree.length} root {tree.length === 1 ? 'tenant' : 'tenants'}</span>
      </div>
    </div>
  );
}

export default TenantTree;
