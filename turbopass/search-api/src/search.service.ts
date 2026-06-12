import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Trie, CityPayload } from './trie';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private trie: Trie;
  private readonly dataPath = path.join(process.cwd(), '..', 'data'); 

  constructor() {
    this.trie = new Trie();
  }

  onModuleInit() {
    this.logger.log('Loading OSM data into Trie...');
    this.loadData();
  }

  private loadData() {
    if (!fs.existsSync(this.dataPath)) {
      this.logger.warn(`Data directory not found at ${this.dataPath}`);
      return;
    }
    
    const jsonFiles = this.findJsonFiles(this.dataPath);
    let loadedCities = 0;
    
    const insertIntoTrie = (name: string, payload: CityPayload) => {
      this.trie.insert(name, payload);
      const parts = name.split(/[\s-]+/);
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
          const suffix = parts.slice(i).join(' ');
          if (suffix.length > 2) {
            this.trie.insert(suffix, payload);
          }
        }
      }
    };
    
    for (const file of jsonFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const continent = data.continent || 'Unknown';
        const countryName = data.name;
        const countryCode = data.code;
        
        for (const child of data.children || []) {
          if (child.type === 'state') {
            const statePayload: CityPayload = {
              code: child.code,
              name: child.name,
              stateCode: child.code,
              stateName: child.name,
              countryCode,
              countryName,
              continent,
              population: undefined,
              placeType: 'state'
            };
            insertIntoTrie(child.name, statePayload);
            loadedCities++;

            for (const city of child.children || []) {
              if (city.type === 'city') {
                const payload: CityPayload = {
                  code: city.code,
                  name: city.name,
                  stateCode: child.code,
                  stateName: child.name,
                  countryCode,
                  countryName,
                  continent,
                  population: city.population,
                  placeType: city.place_type
                };
                insertIntoTrie(city.name, payload);
                loadedCities++;
              }
            }
          } else if (child.type === 'city') {
            const payload: CityPayload = {
              code: child.code,
              name: child.name,
              stateCode: '',
              stateName: '',
              countryCode,
              countryName,
              continent,
              population: child.population,
              placeType: child.place_type
            };
            insertIntoTrie(child.name, payload);
            loadedCities++;
          }
        }
      } catch (e) {
        this.logger.error(`Failed to load ${file}: ${e.message}`);
      }
    }
    this.logger.log(`Successfully loaded ${loadedCities} cities into Trie.`);
  }

  private findJsonFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        this.findJsonFiles(fullPath, fileList);
      } else if (file === 'hierarchy.json') {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  search(query: string, fuzzy: boolean = true) {
    if (!query) return [];
    if (fuzzy) {
        return this.trie.fuzzySearch(query, 1, 20); // maxEdits = 1
    } else {
        return this.trie.searchPrefix(query, 20);
    }
  }
}
