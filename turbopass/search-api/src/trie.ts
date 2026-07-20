export interface CityPayload {
  code: string;
  name: string;
  stateCode: string;
  stateName: string;
  countryCode: string;
  countryName: string;
  continent: string;
  population?: string;
  placeType?: string;
}

class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEndOfWord: boolean = false;
  payloads: CityPayload[] = [];
}

export class Trie {
  private root: TrieNode = new TrieNode();

  insert(word: string, payload: CityPayload) {
    if (!word) return;
    let node = this.root;
    const normalized = word.toLowerCase();
    for (const char of normalized) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char)!;
    }
    node.isEndOfWord = true;
    node.payloads.push(payload);
  }

  searchPrefix(prefix: string, limit: number = 20): CityPayload[] {
    let node = this.root;
    const normalized = prefix.toLowerCase();
    for (const char of normalized) {
      if (!node.children.has(char)) {
        return [];
      }
      node = node.children.get(char)!;
    }
    return this.collectAllWords(node, limit);
  }

  private collectAllWords(node: TrieNode, limit: number): CityPayload[] {
    const results: CityPayload[] = [];
    const queue: TrieNode[] = [node];
    
    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;
      if (current.isEndOfWord) {
        results.push(...current.payloads);
      }
      for (const child of current.children.values()) {
        queue.push(child);
      }
    }
    
    return results.slice(0, limit);
  }

  fuzzySearch(word: string, maxEdits: number = 2, limit: number = 20): CityPayload[] {
    if (!word) return [];
    
    const results: CityPayload[] = [];
    const normalized = word.toLowerCase();
    
    const currentRow = Array.from({ length: normalized.length + 1 }, (_, i) => i);
    
    for (const [char, child] of this.root.children.entries()) {
      this.searchRecursive(child, char, normalized, currentRow, results, maxEdits, limit);
    }
    
    // Deduplicate results
    const uniqueIds = new Set<string>();
    const uniqueResults: CityPayload[] = [];
    for (const res of results) {
      if (!uniqueIds.has(res.code)) {
        uniqueIds.add(res.code);
        uniqueResults.push(res);
      }
    }
    return uniqueResults.slice(0, limit);
  }

  private searchRecursive(
    node: TrieNode,
    char: string,
    word: string,
    previousRow: number[],
    results: CityPayload[],
    maxEdits: number,
    limit: number
  ) {
    if (results.length >= limit * 2) return; // gather a bit more before deduplication

    const columns = word.length + 1;
    const currentRow = [previousRow[0] + 1];

    for (let c = 1; c < columns; c++) {
      const insertCost = currentRow[c - 1] + 1;
      const deleteCost = previousRow[c] + 1;
      const replaceCost = word[c - 1] === char ? previousRow[c - 1] : previousRow[c - 1] + 1;
      currentRow.push(Math.min(insertCost, deleteCost, replaceCost));
    }

    // Exact match distance logic: if the word prefix so far is within edit distance,
    // we consider all remaining paths. But for standard fuzzy search, we only match
    // if the terminal node's distance is <= maxEdits. 
    // However, for autocomplete fuzzy prefix, we might want to collect all children if 
    // distance is small enough at the end of input word.
    
    // If we've processed all chars in `word` and distance <= maxEdits, collect everything below it
    // Wait, the standard Levenshtein Trie algorithm matches exact words within edit distance.
    // If we want fuzzy prefix matching, any node where currentRow[last] <= maxEdits is a fuzzy prefix match.
    if (currentRow[currentRow.length - 1] <= maxEdits) {
        if (node.isEndOfWord) {
            results.push(...node.payloads);
        }
        // Also, since this is a prefix match, all descendants of this node are also valid prefix matches!
        // So we can collect them.
        this.collectAllWordsFast(node, results, limit * 2);
        return; // Don't continue recursive edit distance since we already collected children
    }

    if (Math.min(...currentRow) <= maxEdits) {
      for (const [nextChar, child] of node.children.entries()) {
        this.searchRecursive(child, nextChar, word, currentRow, results, maxEdits, limit);
      }
    }
  }

  private collectAllWordsFast(node: TrieNode, results: CityPayload[], maxTotal: number) {
      const queue: TrieNode[] = [node];
      while (queue.length > 0 && results.length < maxTotal) {
          const curr = queue.shift()!;
          if (curr !== node && curr.isEndOfWord) { // node's own payloads already added above if isEndOfWord
              results.push(...curr.payloads);
          }
          for (const child of curr.children.values()) {
              queue.push(child);
          }
      }
  }
}
