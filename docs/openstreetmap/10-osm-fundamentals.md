# 10 — OSM fundamentals

What the data *is*, before any API gets involved. Everything downstream — Overpass
queries, geocoding results, boundary polygons — is a projection of this model, and most
surprising behaviour traces back to it.

## The data model: three primitives

OSM has exactly three element types. There is no "polygon" type, which is the single
most consequential fact for boundary work.

| Element | What it is | Identity |
|---|---|---|
| **Node** | A point: `lat`, `lon`, plus optional tags | `node/123` |
| **Way** | An ordered list of node references. *Open* = a line (a road). *Closed* (first node == last node) = an area, **by tag convention only** | `way/456` |
| **Relation** | An ordered list of members (nodes, ways, or other relations), each with a **role** | `relation/789` |

Consequences you will meet in practice:

- **A closed way is only an area because its tags say so.** `area=yes`,
  `building=yes`, `landuse=*` imply area; a closed `highway=*` is a loop road. Tools
  like `osmtogeojson` encode these conventions — this is precisely what that library
  is for, and why you should not hand-roll the conversion.
- **Administrative boundaries are relations, not ways.** A country/county/ward is a
  `type=boundary` relation whose `outer`/`inner` member ways must be *stitched* into
  rings. The member ways arrive in arbitrary order, may be split into dozens of
  segments shared with the neighbouring boundary, and may be reversed. Ring assembly
  is a real algorithm, not a concatenation — again, use a library.
- **Holes are `inner` members.** A district fully enclosing another (or a lake
  excluded from a ward) produces a Polygon with interior rings. Any point-in-polygon
  test that ignores interior rings will assign points to the wrong parent.
- **Relations can nest**, and cycles are technically possible in broken data.

## Tags are freeform strings

Tags are `key=value` pairs of arbitrary UTF-8. There is **no schema, no type system,
and no enforced vocabulary** — only conventions documented on the OSM wiki and enforced
socially by editors and QA tools. Therefore:

- `admin_level` is a *string*, not an integer. `"4"` sorts before `"10"`
  lexicographically. Cast before comparing.
- A tag you rely on may simply be absent on some objects, or misspelled, or carry a
  locally-invented value. Defensive parsing is mandatory.
- Values can change without warning when a mapper retags an object.

### The tags that matter for administrative boundaries

```
type=boundary
boundary=administrative
admin_level=2..11
name=<primary name, in the LOCAL language>
name:en=<English name>            # optional
int_name / alt_name / official_name / old_name   # optional variants
ISO3166-1=<CC>                    # on admin_level=2 (country) relations
ISO3166-2=<CC-SS>                 # on subdivisions, patchily
wikidata=Q…                       # a stable cross-source join key when present
```

Two traps worth internalising:

**`name` is in the local language.** Not English, not the language of whoever is
searching. The OSM relation for Maputo city is `name="Cidade de Maputo"` with
`name:en="Maputo City"`; an English-sourced string like "Maputo Province" matches
`name:en` but *not* `name`. Any name-based lookup must match across
`name`/`name:en`/`int_name`/`alt_name` or it will silently return zero results for
non-anglophone geographies. (CCRS shipped and then fixed exactly this bug — see
[part 60](60-ccrs-implementation.md).)

**`admin_level` semantics are country-specific.** The number is *not* a portable
meaning. The OSM wiki maintains a per-country table; the same level means different
things in different states:

| Level | Kenya | Mozambique | India (typical) |
|---|---|---|---|
| 2 | Country | Country | Country |
| 4 | County | Province / Cidade | State |
| 5 | — | Distrito | — |
| 6 | Sub-county | — | District |
| 8 | Ward-ish | Bairro | Municipality / Town |
| 10–11 | rarely used | — | Ward |

So you cannot hardcode "wards are `admin_level=8`". You must either discover which
levels are actually present for the searched place and let an operator name them, or
carry a per-country mapping table. Levels are also frequently **non-contiguous** — a
country may use 2, 4, 8 with nothing at 5, 6, 7.

## Licensing: ODbL 1.0

OSM data is licensed **[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/)**
(the *data*; the cartography/tile images are CC-BY-SA). The practical obligations:

1. **Attribution.** Credit `© OpenStreetMap contributors` visibly wherever the data or
   a rendering of it is shown. On a map this conventionally sits bottom-right and must
   not be hidden behind a toggle or covered by UI chrome.
2. **Share-alike on Derivative Databases.** If you publicly use an adapted version of
   the database, you must offer that adapted database under ODbL too.
3. **"Produced Works" are exempt from share-alike.** A rendered map image, a printed
   report, a screenshot, or a dashboard chart is a Produced Work: you must attribute,
   but you need not open-license the artefact.

Where the line falls for a system like ours is worth stating explicitly, because it is
the question that actually comes up:

- Showing OSM tiles and OSM-derived ward outlines in a UI → **Produced Work**.
  Attribution only.
- Importing OSM boundary polygons into `boundary-service` and running the platform on
  them → an internal Derivative Database. No public distribution, so no share-alike
  trigger, but attribution still applies to anything user-visible.
- **Publishing** the resulting boundary dataset (an onboarding kit, an open-data
  release, a GeoJSON download endpoint) → distributing a Derivative Database.
  **ODbL applies, and you must say so.** Ship a `LICENCE`/`ATTRIBUTION` note beside
  the file.
- A boundary file that *mixes* OSM with a differently-licensed source (a national
  agency shapefile) needs both licences checked for compatibility before publication.

**Do not** copy from Google Maps, Bing, or any proprietary basemap into OSM or into an
OSM-derived dataset. It is a licence violation both ways and the OSM community treats
it as a serious offence.

## What OSM guarantees, and what it does not

| Guarantee | Reality |
|---|---|
| Global coverage | Yes, but wildly uneven in **density and depth** |
| Freshness | Edits appear in minutes on the main API; downstream services lag (see [part 30](30-apis.md)) |
| Stable IDs | **Weak.** Element IDs usually persist, but a mapper can delete and recreate an object, splitting or merging IDs. Do not use `relation/123` as a long-lived business key |
| Administrative completeness | **No.** Lower levels (wards, bairros, quarteirões) are the first thing missing |
| Geometric accuracy | Varies by contributor and region; no stated tolerance |
| Non-overlapping coverage | **No.** Sibling boundaries may overlap slightly or leave gaps; a point can fall in zero or two of them |

The "stable IDs are weak" point has a direct design implication: derive your own
business codes (e.g. from a normalised name) rather than persisting `relation_123` as a
boundary code, or a future re-import will not reconcile.

The "no non-overlapping coverage" point means every point-in-polygon assignment needs a
defined behaviour for *zero matches* and for *multiple matches* — typically
smallest-containing-area wins, with an explicit, operator-visible list of what could
not be placed. Silently dropping unmatched features is how boundary trees end up
mysteriously incomplete.

## Coordinates and projections

- OSM stores lon/lat in **EPSG:4326** (WGS 84), at 7 decimal places (~1 cm).
- Web maps render in **EPSG:3857** (Web Mercator / "spherical Mercator"), which is what
  tile pyramids and zoom levels are defined in. See [part 40](40-rendering.md) for the
  maths.
- **GeoJSON is `[longitude, latitude]`**, in that order. Almost every other API and UI
  says "lat, lng". This ordering swap is the most common geo bug in existence; if your
  features land in the ocean off West Africa (0°, 0°) or in the wrong hemisphere,
  check it first.
- Areas, centroids and distances computed directly on lon/lat degrees are distorted
  (a degree of longitude shrinks with latitude). For centroid/point-in-polygon at
  city scale the error is tolerable; for area comparison or distance, project first
  or use a geodesic library.

## Further reading

- [OSM wiki: Elements](https://wiki.openstreetmap.org/wiki/Elements)
- [OSM wiki: Tags](https://wiki.openstreetmap.org/wiki/Tags) ·
  [Map features](https://wiki.openstreetmap.org/wiki/Map_features)
- [OSM wiki: Relation:boundary](https://wiki.openstreetmap.org/wiki/Relation:boundary)
- [OSM wiki: Tag:boundary=administrative](https://wiki.openstreetmap.org/wiki/Tag:boundary%3Dadministrative)
  — includes the per-country `admin_level` tables
- [OSM copyright and licence](https://www.openstreetmap.org/copyright) ·
  [ODbL summary](https://wiki.osmfoundation.org/wiki/Licence)
