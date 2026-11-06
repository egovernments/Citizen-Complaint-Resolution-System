# Severity rubric (v0.1 draft)

Severity is judged from **what the complaint text says**, not from who complained or how
angry the tone is. Location and neighbourhood context (schools, hospitals, flood-prone areas,
repeat reports) are handled by a separate geo layer and must **not** change the label here.

When two levels seem to fit, pick the higher one only if a criterion for it is clearly met in the text.
If the text is too short or unclear to judge, label by the complaint type's usual impact and add a note.

## Levels

| Level | Meaning | Typical response |
| --- | --- | --- |
| **Critical** | Immediate danger to life or serious injury, or a major health or safety emergency happening now | Same day |
| **High** | Significant risk to health or safety, or a major service failure affecting many people, if not fixed soon | Within a few days |
| **Medium** | Real inconvenience or a recurring problem with limited risk | Routine |
| **Low** | Minor, cosmetic, informational or request-type issue with no safety or health impact | Routine, low urgency |

## Criteria

**Critical** — at least one of:
- A person or animal is injured, attacked, trapped, electrocuted or has died, or this is clearly imminent.
- Live or exposed electrical wires, or a street light or pole giving shocks.
- An open manhole or open drain in a walkway or road with no barrier, where someone could fall in.
- Fire, or garbage or debris burning in a way that threatens people.
- Large-scale flooding or sewage flooding of homes or roads.
- Suspected outbreak (several people ill with the same symptoms).
- A fallen tree or structure blocking a road, or about to fall onto people or vehicles.

**High** — at least one of:
- Stray dogs or cattle reported as aggressive, biting or threatening, without a current injury.
- Stagnant water or mosquito breeding with illness reported or likely.
- Sewage overflow or contaminated drinking water.
- A deep pothole or damaged road or footpath on a busy route causing accidents or near-misses.
- No drinking water or no electricity for a whole street or area.
- Dead animals left in public spaces.
- Garbage not collected for several days in a way that creates a health hazard.

**Medium** — at least one of:
- Street light not working, with no injury or safety incident mentioned.
- Missed garbage collection, an overflowing bin or poor sweeping, without a health hazard.
- Minor road or footpath damage.
- Encroachment, illegal parking or unauthorised boards or construction.
- Desilting or drain repair that is needed but not yet causing flooding.

**Low** — at least one of:
- Requests such as a new bin, new light, a certificate or property tax queries.
- Cosmetic or minor cleanliness issues.
- Delay or quality of ongoing work with no safety impact.
- General feedback or an unrelated or unclear complaint.

## Notes for labellers

- Judge the most serious thing in the text. A complaint about a bin that also mentions a child was bitten is Critical.
- Words like "urgent" or "immediately" do not raise the level by themselves.
- Repeated or duplicate reports of the same issue do not raise the level; repeat handling is a geo-layer rule.
- If it is a near tie, record the lower label, write the higher one in `notes`, and mark it for the third reviewer.

## Open items

- To be checked with eGov (Rahul Jose) whether severity rules are already defined; if so, align this rubric to them.
- The examples above are a first draft built from the complaint types in `model/ctype_values.json` and need review by someone who handles real complaints.
