import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import {
  MapPin,
  Search,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { DigitCard } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';
import { apiClient, boundaryService } from '@/api';
import osmtogeojson from 'osmtogeojson';
import type { Boundary } from '@/api/types';

type Step = 'landing' | 'map-levels' | 'creating' | 'complete';

interface AdminLevel {
  level: number;
  features: any[];
  examples: string[];
  mappedName: string;
}

// Simple point in polygon helper
function getCentroid(feature: any) {
  let x = 0, y = 0, pts = 0;
  const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : 
                 feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates[0][0] : [];
                 
  for(const pt of coords) {
    x += pt[0];
    y += pt[1];
    pts++;
  }
  return [x / pts, y / pts];
}

function pointInPolygon(point: number[], vs: number[][]) {
  let x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i][0], yi = vs[i][1];
    let xj = vs[j][0], yj = vs[j][1];
    let intersect = ((yi > y) != (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function featureContainsPoint(feature: any, point: number[]) {
  if (!feature.geometry) return false;
  if (feature.geometry.type === 'Polygon') {
    return pointInPolygon(point, feature.geometry.coordinates[0]);
  } else if (feature.geometry.type === 'MultiPolygon') {
    for (const poly of feature.geometry.coordinates) {
      if (pointInPolygon(point, poly[0])) return true;
    }
  }
  return false;
}

export default function Phase2Page() {
  const { completePhase, addUndo, state } = useApp();
  const navigate = useNavigate();
  const boundaryTenant = state.targetTenant || state.tenant;

  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [adminLevels, setAdminLevels] = useState<AdminLevel[]>([]);
  
  const [createdCounts, setCreatedCounts] = useState<Record<string, number>>({});
  const [totalCreated, setTotalCreated] = useState(0);
  const [existingHierarchy, setExistingHierarchy] = React.useState(false);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  React.useEffect(() => {
    if (searchTerm.length <= 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    // Only fetch if showSuggestions is true (meaning user is actively typing, not just selected an item)
    if (!showSuggestions) return;

    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:3000/search?q=${encodeURIComponent(searchTerm)}&limit=5`);
        if (!res.ok) throw new Error("Turbopass Search API failed");
        const data = await res.json();
        setSuggestions(data.results || []);
      } catch (e) {
        console.error("Nominatim search failed", e);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, showSuggestions]);

  const formatSuggestion = (item: any) => {
    const parts = [];
    if (item.name) parts.push(item.name);
    if (item.stateName && item.stateName !== item.name) parts.push(item.stateName);
    if (item.countryName && item.countryName !== item.stateName && item.countryName !== item.name) parts.push(item.countryName);

    const type = item.placeType || 'location';
    return {
      text: parts.join('/'),
      type: `[${type}]`
    };
  };

  React.useEffect(() => {
    boundaryService.getHierarchies(boundaryTenant).then(hierarchies => {
      if (hierarchies.some(h => h.hierarchyType === 'ADMIN')) {
        setExistingHierarchy(true);
      }
    }).catch(console.error);
  }, [boundaryTenant]);

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setError("Please enter a location name to search.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = `[out:json][timeout:90];
area["name"="${searchTerm}"]->.searchArea;
(
  rel(area.searchArea)["boundary"="administrative"];
);
out body;
>;
out skel qt;`;
      
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query
      });
      if (!res.ok) throw new Error("Overpass API failed");
      const data = await res.json();
      
      const geojson = osmtogeojson(data);
      
      let targetAdminLevel = 0;
      const sTerm = searchTerm.toLowerCase().trim();
      geojson.features.forEach((feature: any) => {
        const featName = feature.properties?.name?.toLowerCase() || '';
        const featAltName = feature.properties?.alt_name?.toLowerCase() || '';
        if (featName === sTerm || featName.includes(sTerm) || featAltName === sTerm) {
          const lvl = parseInt(feature.properties.admin_level, 10);
          // If we found a match, we prefer the HIGHEST admin_level number (most specific)
          // Wait, if it's the search target, it should be the ROOT. 
          // e.g. "Maputo" matches Level 4 (Cidade de maputo).
          // If "Maputo" also matches a Level 8 "Maputo Bairro", we might accidentally set targetAdminLevel to 8,
          // filtering out Level 4! That's bad.
          // We want the LOWEST admin_level number that matches, so we don't accidentally filter out the actual city!
          if (!isNaN(lvl) && (targetAdminLevel === 0 || lvl < targetAdminLevel)) {
            targetAdminLevel = lvl;
          }
        }
      });

      const levelsMap = new Map<number, any[]>();
      geojson.features.forEach((feature: any) => {
        if (feature.properties?.boundary === 'administrative' && feature.properties?.admin_level) {
          const lvl = parseInt(feature.properties.admin_level, 10);
          if (!isNaN(lvl) && (targetAdminLevel === 0 || lvl >= targetAdminLevel)) {
            if (!levelsMap.has(lvl)) levelsMap.set(lvl, []);
            levelsMap.get(lvl)!.push(feature);
          }
        }
      });

      
      const extractedLevels = Array.from(levelsMap.entries()).map(([level, features]) => {
        const uniqueNames = Array.from(new Set(features.map(f => f.properties.name).filter(Boolean)));
        return {
          level,
          features,
          examples: uniqueNames.slice(0, 3),
          mappedName: ''
        };
      }).sort((a, b) => a.level - b.level);
      
      if (extractedLevels.length === 0) {
        setError("No administrative boundaries found. Please try a different location.");
        setLoading(false);
        return;
      }
      
      setAdminLevels(extractedLevels);
      setStep('map-levels');
    } catch (e) {
      console.error(e);
      setError("Failed to fetch data from OSM. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBoundaries = async () => {
    const validLevels = adminLevels.filter(l => l.mappedName.trim());
    if (validLevels.length < 2) {
      setError("Please map at least two admin levels to create a hierarchy.");
      return;
    }

    setLoading(true);
    setError(null);
    setStep('creating');

    try {
      const hierarchyType = "ADMIN";
      const levelNames = validLevels.map(l => l.mappedName.trim());
      
      
      // Step 1: Create Hierarchy
      try {
        await boundaryService.createHierarchyFromLevels(
          boundaryTenant,
          hierarchyType,
          levelNames
        );
        addUndo('create_hierarchy', `Created hierarchy: ${hierarchyType}`);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.toLowerCase().includes('already exist') || msg.includes('DUPLICATE')) {
          console.log("Hierarchy already exists, proceeding to create boundaries...");
        } else {
          throw e;
        }
      }


      // Save highest admin level config in MDMS (numeric highest = smallest unit)
      const highestAdminLevelObj = validLevels.reduce((prev, current) => (prev.level > current.level) ? prev : current);
      const lowestBoundaryType = highestAdminLevelObj.mappedName.trim();
      
      try {
        await apiClient.post('/mdms-v2/v2/_create/tenant.uiConfig', {
          RequestInfo: apiClient.buildRequestInfo(),
          Mdms: {
            tenantId: boundaryTenant,
            schemaCode: "tenant.uiConfig",
            uniqueIdentifier: "PGR_BOUNDARY_LOWEST_LEVEL",
            data: {
              PGR_BOUNDARY_LOWEST_LEVEL: lowestBoundaryType
            },
            isActive: true
          }
        });
      } catch(e) {
        console.warn('MDMS config store failed (schema may not exist):', e);
      }

      // Build Boundary array with parent-child relationships
      const boundaries: Boundary[] = [];
      const codeFormat = (id: string) => id.replace('/', '_');
      
      const sortedLevels = [...validLevels].sort((a, b) => a.level - b.level);
      
      for (let i = 0; i < sortedLevels.length; i++) {
        const lvl = sortedLevels[i];
        const bType = lvl.mappedName.trim();
        
        for (const feature of lvl.features) {
          if (!feature.properties.name) continue;
          
          let parentCode: string | undefined = undefined;
          
            if (i > 0 && feature.geometry) {
              const centroid = getCentroid(feature);
              
              // Search ONLY the immediate parent level to maintain strict tree
              const parentLvl = sortedLevels[i - 1];
              for (const pFeature of parentLvl.features) {
                if (featureContainsPoint(pFeature, centroid)) {
                  parentCode = codeFormat(pFeature.id);
                  break;
                }
              }
              
              // Fallback: if no spatial parent found (e.g. Maputo City and Province are disjoint, or missing OSM data),
              // link to the first item of the immediate parent level to satisfy boundary-service strict tree.
              if (!parentCode && parentLvl.features.length > 0) {
                parentCode = codeFormat(parentLvl.features[0].id);
              }
            }
          
          let finalGeometry = feature.geometry;
          if (finalGeometry && finalGeometry.type === 'MultiPolygon') {
            let maxPoints = 0;
            let largestPolygon = finalGeometry.coordinates[0];
            for (const poly of finalGeometry.coordinates) {
              const points = poly[0] ? poly[0].length : 0;
              if (points > maxPoints) {
                maxPoints = points;
                largestPolygon = poly;
              }
            }
            finalGeometry = {
              type: 'Polygon',
              coordinates: largestPolygon
            };
          }
          
          boundaries.push({
            id: '', // Will be assigned by backend
            tenantId: boundaryTenant,
            code: codeFormat(feature.id),
            name: feature.properties.name,
            boundaryType: bType,
            hierarchyType: hierarchyType,
            parent: parentCode,
            geometry: finalGeometry
          });
        }
      }

      // Create boundaries
      const result = await boundaryService.createBoundaries(boundaries, () => {});
      
      const counts: Record<string, number> = {};
      result.success.forEach(b => {
        counts[b.boundaryType] = (counts[b.boundaryType] || 0) + 1;
      });
      
      setCreatedCounts(counts);
      setTotalCreated(result.success.length);
      
      if (result.success.length > 0) {
        addUndo('create_boundaries', `Created ${result.success.length} boundaries from OSM data`);
      }
      
      setStep('complete');
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to create boundaries.");
      setStep('map-levels');
    } finally {
      setLoading(false);
    }
  };

  const handleNextPhase = () => {
    completePhase(2);
    navigate('/phase/3');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 border-2 border-primary rounded flex items-center justify-center flex-shrink-0">
          <MapPin className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <Header className="mb-0 text-lg sm:text-2xl">Phase 2: Boundaries</Header>
          <p className="text-sm sm:text-base text-muted-foreground truncate">Define the geographical hierarchy and fetch polygons from OpenStreetMap.</p>
        </div>
      </div>

      <DigitCard className="max-w-4xl mx-auto border-none shadow-none mt-4">
        {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      
      {step === 'landing' && (
        <div className="space-y-6">
          {existingHierarchy && (
            <Alert className="mb-6 bg-blue-50/50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                A boundary hierarchy already exists for this tenant. 
                You can proceed to the next phase, or fetch new data from OSM to overwrite/append boundaries.
              </AlertDescription>
              <div className="mt-4">
                 <Button variant="outline" onClick={handleNextPhase}>Proceed to Phase 3</Button>
              </div>
            </Alert>
          )}
          <div className="border border-border rounded-xl p-8 bg-card text-center space-y-4">

            <Search className="h-12 w-12 mx-auto text-primary opacity-80" />
            <h2 className="text-xl font-semibold">Fetch Boundaries from OSM</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Enter the name of your city or region to automatically fetch administrative boundaries and their map polygons from OpenStreetMap.
            </p>
            
            <div className="relative max-w-sm mx-auto pt-4">
              <div className="flex space-x-2">
                <Input
                  placeholder="e.g., Maputo"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShowSuggestions(true);
                  }}
                  disabled={loading}
                />
                <Button onClick={handleSearch} disabled={!searchTerm || loading}>
                  {loading ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}
                  Search
                </Button>
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md overflow-hidden">
                  <ul className="py-1">
                    {suggestions.map((item, i) => {
                      const { text, type } = formatSuggestion(item);
                      return (
                        <li 
                          key={i} 
                          className="px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground text-left text-sm flex items-center justify-between"
                          onClick={() => {
                            setSearchTerm(item.name || text.split('/')[0]);
                            setShowSuggestions(false);
                          }}
                        >
                          <span className="truncate pr-2">{text}</span>
                          <span className="opacity-50 text-xs flex-shrink-0">{type}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 'map-levels' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Header>Map Admin Levels</Header>
          <SubHeader>
              We found {adminLevels.length} levels of administrative boundaries for {searchTerm}. 
              Please provide a local name for each level (e.g., "Province", "District", "City", "Neighborhood").
          </SubHeader>

          <div className="space-y-4 pt-4">
            {adminLevels.map((lvl, index) => (
              <div key={lvl.level} className="border p-6 rounded-lg bg-card/50 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-lg flex items-center">
                      OSM Admin Level {lvl.level}
                      <Badge variant="outline" className="ml-2 bg-background">
                        {lvl.features.length} regions
                      </Badge>
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Examples: {lvl.examples.join(', ')}{lvl.examples.length < lvl.features.length ? ', etc.' : ''}
                    </p>
                  </div>
                </div>
                
                <div className="pt-2">
                  <label className="text-sm font-medium mb-1.5 block">Hierarchy Name</label>
                  <Input 
                    placeholder="e.g., District"
                    value={lvl.mappedName}
                    onChange={(e) => {
                      const newLevels = [...adminLevels];
                      newLevels[index].mappedName = e.target.value;
                      setAdminLevels(newLevels);
                    }}
                    disabled={loading}
                  />
                </div>
              </div>
            ))}
          </div>

          <SubmitBar 
            label={loading ? "Creating..." : "Create Hierarchy & Boundaries"} 
            onSubmit={handleCreateBoundaries} 
            disabled={loading || adminLevels.filter(l => l.mappedName.trim()).length < 2} 
          />
        </div>
      )}

      {step === 'creating' && (
        <div className="py-24 text-center space-y-6">
          <Loader2 className="h-16 w-16 mx-auto text-primary animate-spin" />
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold">Creating Boundaries</h2>
            <p className="text-muted-foreground">
              Building geographic hierarchy and writing polygons to the database...
            </p>
          </div>
        </div>
      )}

      {step === 'complete' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Banner 
            successful={true} 
            message="Phase 2 Complete!" 
            info={`Successfully generated ${totalCreated} boundaries from OSM data.`} 
          />

          <div className="max-w-lg mx-auto mt-6">
            <h3 className="text-lg font-semibold mb-4">Summary</h3>
            <div className="space-y-3">
              {Object.entries(createdCounts).map(([type, count]) => (
                <div key={type} className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                  <span className="font-medium">{type}</span>
                  <Badge variant="secondary">{count} items</Badge>
                </div>
              ))}
            </div>
          </div>

          <SubmitBar 
            label="Continue to Common Masters" 
            onSubmit={handleNextPhase} 
            icon={<ChevronRight className="w-5 h-5 ml-2" />} 
          />
        </div>
      )}
      </DigitCard>
    </div>
  );
}
