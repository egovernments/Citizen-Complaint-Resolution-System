import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_ENDPOINT = 'https://docs.digit.org/platform/~gitbook/mcp';
const LOCAL_URL_PREFIX = 'local://';
const ENGRAM_URL_PREFIX = 'engram://';

// Resolve docs/ and data/engrams/ directories relative to project root (two levels up from src/tools/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..', '..', 'docs');
const ENGRAMS_DIR = join(__dirname, '..', '..', 'data', 'engrams');

interface McpResult {
  result?: {
    content?: Array<{ type: string; text: string }>;
  };
}

/**
 * Search local docs/ directory for markdown files matching a query.
 * Simple keyword matching on file name + content.
 */
async function searchLocalDocs(query: string): Promise<Array<{ title: string; link: string; content: string }>> {
  const results: Array<{ title: string; link: string; content: string }> = [];
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

  let files: string[];
  try {
    files = await readdir(DOCS_DIR);
  } catch {
    return results; // docs/ doesn't exist or isn't readable
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    try {
      const content = await readFile(join(DOCS_DIR, file), 'utf-8');
      const lowerContent = content.toLowerCase();
      const lowerFile = file.toLowerCase();

      // Match if any keyword appears in filename or content
      const matches = keywords.some(kw => lowerFile.includes(kw) || lowerContent.includes(kw));
      if (!matches) continue;

      // Extract title from first heading
      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1] : file.replace('.md', '');

      // Extract a snippet around the first keyword match
      let snippet = '';
      for (const kw of keywords) {
        const idx = lowerContent.indexOf(kw);
        if (idx >= 0) {
          const start = Math.max(0, idx - 100);
          const end = Math.min(content.length, idx + 300);
          snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n/g, ' ').trim() + (end < content.length ? '...' : '');
          break;
        }
      }

      results.push({
        title: `[Local] ${title}`,
        link: `${LOCAL_URL_PREFIX}${file}`,
        content: snippet.slice(0, 500),
      });
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Read a local doc file by its local:// URL.
 */
async function getLocalDoc(localUrl: string): Promise<{ title: string; content: string } | null> {
  const filename = localUrl.replace(LOCAL_URL_PREFIX, '');
  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/')) return null;

  try {
    const content = await readFile(join(DOCS_DIR, filename), 'utf-8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    return {
      title: titleMatch ? titleMatch[1] : filename.replace('.md', ''),
      content,
    };
  } catch {
    return null;
  }
}

/**
 * Search engram files in data/engrams/ for matching content.
 * Same keyword-matching approach as local docs.
 */
async function searchEngramDocs(query: string): Promise<Array<{ title: string; link: string; content: string }>> {
  const results: Array<{ title: string; link: string; content: string }> = [];
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

  let files: string[];
  try {
    files = await readdir(ENGRAMS_DIR);
  } catch {
    return results;
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    try {
      const content = await readFile(join(ENGRAMS_DIR, file), 'utf-8');
      const lowerContent = content.toLowerCase();
      const lowerFile = file.toLowerCase();

      const matches = keywords.some(kw => lowerFile.includes(kw) || lowerContent.includes(kw));
      if (!matches) continue;

      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1] : file.replace('.md', '');

      let snippet = '';
      for (const kw of keywords) {
        const idx = lowerContent.indexOf(kw);
        if (idx >= 0) {
          const start = Math.max(0, idx - 100);
          const end = Math.min(content.length, idx + 300);
          snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n/g, ' ').trim() + (end < content.length ? '...' : '');
          break;
        }
      }

      results.push({
        title: `[Engram] ${title}`,
        link: `${ENGRAM_URL_PREFIX}${file}`,
        content: snippet.slice(0, 500),
      });
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Read an engram file by its engram:// URL.
 */
async function getEngramDoc(engramUrl: string): Promise<{ title: string; content: string } | null> {
  const filename = engramUrl.replace(ENGRAM_URL_PREFIX, '');
  if (filename.includes('..') || filename.includes('/')) return null;

  try {
    const content = await readFile(join(ENGRAMS_DIR, filename), 'utf-8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    return {
      title: titleMatch ? titleMatch[1] : filename.replace('.md', ''),
      content,
    };
  } catch {
    return null;
  }
}

async function searchDocs(query: string): Promise<Array<{ title: string; link: string; content: string }>> {
  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'searchDocumentation',
        arguments: { query },
      },
    }),
  });

  const text = await response.text();
  const results: Array<{ title: string; link: string; content: string }> = [];

  // Parse SSE response
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const data = JSON.parse(line.slice(6)) as McpResult;
      const content = data.result?.content;
      if (!Array.isArray(content)) continue;

      for (const item of content) {
        if (item.type !== 'text' || !item.text) continue;
        const lines = item.text.split('\n');
        const titleLine = lines.find((l: string) => l.startsWith('Title: '));
        const linkLine = lines.find((l: string) => l.startsWith('Link: '));
        const contentStart = lines.findIndex((l: string) => l.startsWith('Content: '));
        const contentText = contentStart >= 0
          ? lines.slice(contentStart).join('\n').replace(/^Content: /, '')
          : '';

        results.push({
          title: titleLine?.replace('Title: ', '') || '(untitled)',
          link: linkLine?.replace('Link: ', '') || '',
          content: contentText.slice(0, 500),
        });
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return results;
}

export function registerDocsTools(registry: ToolRegistry): void {
  registry.register({
    name: 'docs_search',
    group: 'docs',
    category: 'docs',
    risk: 'read',
    description:
      'Search the DIGIT documentation (docs.digit.org) for guides, API references, configuration details, architecture docs, and how-to articles. ' +
      'Also searches local docs bundled with this MCP server (UI building guide, API patterns, etc.). ' +
      'Also searches engram knowledge docs (learned API behaviors, workflow patterns, and claims from past sessions). ' +
      'Covers all DIGIT modules: platform, PGR, works, sanitation, health, local governance, and public finance. Returns titles, links, and content snippets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g. "persister configuration", "PGR complaint workflow", "MDMS schema setup", "UI components", "build PGR frontend")',
        },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const query = args.query as string;
      if (!query?.trim()) {
        return JSON.stringify({ success: false, error: 'query is required' });
      }

      try {
        // Search local, engram, and remote docs in parallel
        const [localResults, engramResults, remoteResults] = await Promise.allSettled([
          searchLocalDocs(query.trim()),
          searchEngramDocs(query.trim()),
          searchDocs(query.trim()),
        ]);

        const local = localResults.status === 'fulfilled' ? localResults.value : [];
        const engram = engramResults.status === 'fulfilled' ? engramResults.value : [];
        const remote = remoteResults.status === 'fulfilled' ? remoteResults.value : [];

        // Engrams first (learned knowledge), then local docs, then remote
        const allResults = [...engram, ...local, ...remote];

        if (allResults.length === 0) {
          return JSON.stringify({
            success: true,
            query,
            count: 0,
            results: [],
            hint: 'No results found. Try broader or different search terms.',
          }, null, 2);
        }

        return JSON.stringify({
          success: true,
          query,
          count: allResults.length,
          results: allResults.map((r, i) => ({
            rank: i + 1,
            title: r.title,
            url: r.link,
            snippet: r.content,
          })),
        }, null, 2);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          success: false,
          error: `Documentation search failed: ${message}`,
          hint: 'The docs.digit.org search service may be temporarily unavailable.',
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'docs_get',
    group: 'docs',
    category: 'docs',
    risk: 'read',
    description:
      'Fetch the full markdown content of a DIGIT documentation page. Use docs_search first to find the URL, then pass it here to read the complete page. ' +
      'Accepts docs.digit.org URLs, local:// URLs for bundled docs (e.g. "local://ui.md" for the UI building guide), and engram:// URLs for learned knowledge docs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The docs.digit.org page URL (e.g. "https://docs.digit.org/platform/platform/core-services/mdms-v2-master-data-management-service"), a local:// URL (e.g. "local://ui.md"), or an engram:// URL (e.g. "engram://workflow_registry.md")',
        },
      },
      required: ['url'],
    },
    handler: async (args) => {
      const url = args.url as string;
      if (!url?.trim()) {
        return JSON.stringify({ success: false, error: 'url is required' });
      }

      // Handle local docs
      if (url.startsWith(LOCAL_URL_PREFIX)) {
        const doc = await getLocalDoc(url);
        if (!doc) {
          return JSON.stringify({
            success: false,
            error: `Local doc not found: ${url}`,
            hint: 'Use docs_search to find available local docs.',
          }, null, 2);
        }
        return JSON.stringify({
          success: true,
          url,
          title: doc.title,
          content: doc.content,
        }, null, 2);
      }

      // Handle engram docs
      if (url.startsWith(ENGRAM_URL_PREFIX)) {
        const doc = await getEngramDoc(url);
        if (!doc) {
          return JSON.stringify({
            success: false,
            error: `Engram doc not found: ${url}`,
            hint: 'Use docs_search to find available engram docs.',
          }, null, 2);
        }
        return JSON.stringify({
          success: true,
          url,
          title: doc.title,
          content: doc.content,
        }, null, 2);
      }

      // Ensure it's a docs.digit.org URL
      if (!url.includes('docs.digit.org')) {
        return JSON.stringify({
          success: false,
          error: 'URL must be a docs.digit.org page, a local:// URL, or an engram:// URL',
          hint: 'Use docs_search to find valid documentation URLs.',
        });
      }

      // Append .md if not already present, handling query strings correctly
      let mdUrl: string;
      try {
        const parsed = new URL(url);
        if (!parsed.pathname.endsWith('.md')) {
          parsed.pathname = `${parsed.pathname}.md`;
        }
        mdUrl = parsed.toString();
      } catch {
        // Fallback for malformed URLs — simple append
        mdUrl = url.endsWith('.md') ? url : `${url}.md`;
      }

      try {
        const response = await fetch(mdUrl);
        if (!response.ok) {
          return JSON.stringify({
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            hint: 'The page may not exist. Use docs_search to find valid URLs.',
          }, null, 2);
        }

        const contentType = response.headers.get('content-type') || '';
        // Accept text/markdown, text/plain, text/html (gitbook sometimes returns html), and octet-stream
        const isTextContent = contentType.includes('text/') || contentType.includes('application/octet-stream');
        if (!isTextContent) {
          return JSON.stringify({
            success: false,
            error: `Unexpected content type: ${contentType}`,
            hint: 'The URL may not point to a documentation page. Use docs_search to find valid URLs.',
          }, null, 2);
        }

        const markdown = await response.text();
        // Return the original URL (not the .md one) so agents don't bypass docs_get
        const displayUrl = url.endsWith('.md') ? url.replace(/\.md$/, '') : url;
        return JSON.stringify({
          success: true,
          url: displayUrl,
          content: markdown,
        }, null, 2);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          success: false,
          error: `Failed to fetch page: ${message}`,
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);
}
