# Facility Source Checklist — Product Alignment

This is the gate before Phase C2. The feature sounds simple ("each facility has a card showing available sources; users check the ones that apply; only those show in By Facility") but there are several product decisions that shape both UI and data model. Each question below includes why it matters, the real options, and a recommendation.

## Q1. Where does applicability live — facility, project, or both?

**Why it matters.** Not all activities are facility-bound. Scope 1 and most Scope 2 activities are natural fits for per-facility ownership (this building burns natural gas; that one doesn't). But large chunks of Scope 3 — business travel, employee commuting, some waste streams, purchased goods — are typically collected at the organization level, not per-facility. Forcing them onto facility cards will feel wrong.

**Options.**

- **A. Facility-only.** Every activity type belongs to a facility card. Clean data model (one list per facility). But forces awkward mappings for org-level Scope 3 — users end up creating a "headquarters" or "corporate" pseudo-facility and attaching everything there. That's the pattern most spreadsheets use, so it's familiar, but it's a convention, not a model.

- **B. Project + facility split.** `FacilityDraft` gets `applicable_activity_types` for facility-bound categories. Project snapshot gets `applicable_activity_types` at the top level for non-facility-bound categories. Two lists to maintain, but each is natural in its own scope.

- **C. Both, unified.** Every activity lives somewhere, but the "somewhere" can be facility or project. Store as `applicability: list[{scope: 'facility' | 'project', target_id: str, activity_type_id: str}]`. Most flexible, most complex.

**What needs to be decided first.** Does the catalog already distinguish facility-scoped from org-scoped activities? If yes, option B is a clean read from catalog metadata. If no, adding a `typical_scope` field to `ActivityTypeDefinition` (e.g., `"facility" | "organization" | "either"`) is a tiny catalog change that makes B trivially implementable.

**Recommendation.** Option B. Add a `typical_scope` hint to the catalog so the UI can auto-route activities into facility cards vs. a single project-level card. This matches how GHG inventories are actually assembled in practice. The data model cost is small (one new field on `FacilityDraft`, one on `ProjectSnapshot`), both additive and JSON-embedded — no migration.

### RESPONSE: D. Basically, this is option A in practice. Every facility/asset can take ownership over any activity type. But in practice, one facility/asset/domain might be 'global'. The point here is simple enough -- we aren't going to add an additional entry interface for 'project' owned emissions, that would be silly and added complexity for little ROI. Instead, data entry is flexible to allow for a wide range of business contexts, with the core domain model holding and flexing to the different operational/ownership/reporting shapes. Consider this response and let me know if you have any follow-up questions or additional recommendations.

### FOLLOWUP (Claude):

Agreed — this is simpler and a stronger product stance. One entry paradigm, flexibly used. Concretely it means:

- `FacilityDraft` gets a single field: `applicable_activity_types: list[str]`.
- No `typical_scope` on the catalog. No project-level applicability list. No new entry surfaces.
- A "corporate" or "global" facility is just a facility the user named that way and attached the relevant activities to. Convention, not schema.

**Two follow-up questions this opens:**

1. **Do facilities need a "kind" or "type" field?** You hinted at this with "facility/asset/domain" framing. Options:
   - Stay untyped. `FacilityDraft` is just `{ id, name, location, applicable_activity_types }`. Users convey meaning via naming.
   - Add a `kind` or `category` enum (e.g., `"facility" | "asset" | "domain" | "global"`). Drives copy and defaults (e.g., a "global" kind pre-suggests Scope 3 categories on first configure).
   
   My recommendation: **untyped for v1.** Adding a kind field is a near-term schema change that might pre-commit us to a taxonomy we'll regret. If after use we notice users always create a "corporate" facility and attach the same Scope 3 sources, we add a "duplicate from template" flow then — not a schema field now.

2. **Renaming.** Your Q2 response mentioned "targeted renaming" for the facilities tab. The term "facility" skews toward physical locations but you want this to cover assets/domains/global entities too. Options I've seen in the GHG/sustainability space:
   - **Source** — accurate but collides with "emission source" (activity type) in catalog terminology. Confusing.
   - **Emissions source owner** — precise but wordy.
   - **Reporting entity / entity** — broad, matches standard accounting language.
   - **Asset** — common in sustainability software (e.g., Watershed, Persefoni) but narrows mental model away from intangibles.
   - **Reporting unit** — generic, works for location, asset, or domain.
   
   My recommendation: **"Source" for the UI label (tab name and noun in copy), but keep `FacilityDraft` internal for now.** Reason: "Source" is what sustainability practitioners say. Internal rename of `FacilityDraft` → `SourceDraft` is a separate refactor (touches snapshot schema, DB table names, API schemas) and not worth blocking on. But happy to do the internal rename as part of Phase B2 (transport DTO layer) if you want — that's when we're remapping schemas anyway.
   
   **What I need from you:** preferred UI term (Source? Entity? Reporting Unit? something else?), and whether to also rename internally now or defer to Phase B.

## Q2. What does "empty / unset" mean for a brand-new facility?

**Why it matters.** This controls onboarding. If a user creates a new facility and opens By Facility, do they see all 22 implemented activity types (overwhelming) or nothing (blocked)?

**Options.**

- **A. Unset = show all.** The checklist is a pure filter. Users get the current behavior until they configure. Safe, discoverable, but the checklist does nothing until users find and use it — which means most users will never find it.

- **B. Unset = show nothing, with explicit "configure sources to begin" empty state.** Forces users through the checklist as a deliberate planning step. Matches your stated intent ("create our data entry checklist directly in the interface"). Risk: user-hostile for quick experiments or imports.

- **C. Hybrid.** New facility defaults to all-unchecked, but the By Facility view shows a clear empty state inviting configuration, with a "show all activities" escape hatch that stays visible. Also: on *existing* facilities that pre-date the feature, treat unset as "show all" for backwards compatibility.

**Recommendation.** Option C. Treat new-facility defaults and legacy-facility defaults differently. New facilities get the deliberate onboarding; existing facilities silently keep working. The empty-state message is where we teach the feature.

**Downstream UX.** Once C is chosen, we need: an empty state component, a persistent "configure sources" affordance in the By Facility view (not buried), and a clear indicator when a facility has partial configuration (e.g., "6 of 22 sources selected").

### RESPONSE: Modified option C. When users create the facilities/assets/sources on the facilities tab (we can consider some targeted renaming), they should have a button in a new column for selecting emissions sources, and it should call out for configuration if the user has never touched it (as you recommended). Then in the data entry section, there should be another clear indicator -- could be an "add source" empty row at the bottom of the 'by facility' entry and it could be an 'add facility' empty row at the bottom of the 'by activity' data entry. What do you think of that approach? It does mean adding two different selection views, one in which we are adding a source to a facility and one in which we are adding a facility to a source. Thoughts there? 

### FOLLOWUP (Claude):

I like this. Two views of the same underlying state (`facility.applicable_activity_types`) just pivoted differently. Low complexity, covers both mental models.

**Under the hood.** The "add source to facility" and "add facility to source" dialogs both mutate the same list — just indexed differently. No data model implications beyond what Q1 already settled.

**One UX pushback.** I'd rethink the "empty row at the bottom" affordance for checklist modification. Bottom rows in a data grid historically mean "add another data row" (like a blank row in Excel). Repurposing them for "add another source to the applicability list" blurs two different operations: data entry vs. configuration. Two risks:
- Users might think they're adding an activity data row and be surprised by a dialog.
- Once the list is populated, the "empty row at the bottom" disappears and discoverability drops.

**Counter-proposal.** A persistent control at the top or side of each view — not a row:
- **By Facility view, per facility card:** a "+ configure sources" button next to the facility header, always visible. Opens the "add source to facility" selector. When a facility has no sources configured, the body shows only this button with copy like "No sources configured yet — click to choose which apply to this facility."
- **By Activity view, per activity header:** a "+ add facility" button next to the activity-type header, always visible. Opens the "add facility to source" selector. Shows all facilities and lets the user check which ones this source applies to.

Both paths mutate the same data. The control is discoverable whether the list is empty or full. The bottom-row convention stays for actual data entry (adding a time-period row, adding a new repeatable entry).

**Edge case: first-time experience.** In a brand-new project with zero facilities, the "add facility to source" dialog in By Activity has nothing to list. Two options:
- Offer an inline "+ create facility" link inside the dialog that pops the facility-create flow.
- Show an empty state with "Create a facility first" and a button that navigates to the Facilities tab.

My recommendation: option two (route to Facilities tab). Keeps flows separated and reduces dialog-in-dialog complexity.

**What I need from you:** thumbs up on the per-header button placement vs. bottom-row affordance, and a vote on the first-time-experience routing.

## Q3. When a project version is cloned or a new version is saved, does the checklist carry forward?

**Why it matters.** Projects have versions. Versioning semantics affect whether users re-plan on every save or just when they explicitly reset.

**Observations.** Currently, "versions" is what happens on every snapshot save — not an explicit user-initiated branch. So this question is really: *does the checklist live with the draft data (carried across every save) or with the project (persistent across versions but editable independently)?*

**Options.**

- **A. Checklist is per-snapshot.** Lives inside `ProjectSnapshot` / `FacilityDraft`. Cloned on save, editable per version, can diff across versions. Consistent with how facilities and activities already work.

- **B. Checklist is per-project.** Lives at the project level (new table or on the `projects` row), single source of truth that all versions share. Editing it doesn't create a new version. Simpler mental model but inconsistent with existing versioning.

- **C. Per-snapshot, but auto-copied from previous version on save.** A is the default, B's convenience layered on top.

**Recommendation.** Option A, plain. Keeps the model consistent with facilities and activities (which are per-snapshot). Since every save creates a new version anyway, the checklist carries forward naturally. If users need to compare checklists across versions later, the version-comparison endpoint (Phase C4) gets it for free.

### RESPONSE: I think we go with option A here, but in practice, I think there is little downside on the UX side to options A and B. Let's do with a simple implementation first and not change unless that becomes obviously necessary.

## Q4. What happens to existing activity data when a user unchecks a source?

**Why it matters.** This is the most likely way to lose user data silently. If a user has entered 12 months of natural gas data for Facility A, then accidentally unchecks "natural gas stationary combustion," we must not silently delete it.

**Options.**

- **A. Hard delete.** Unchecking removes the activities. Destructive, requires confirmation dialog, probably a mistake even with confirmation.

- **B. Soft-hide.** Data stays in the snapshot, rows are hidden in By Facility. Re-checking the source restores visibility. Data never lost.

- **C. Soft-hide + warn.** B, plus a notice at uncheck time saying "this facility has existing data for X — it will be hidden, not deleted." Users know what's happening.

**Recommendation.** Option C. Never destructive, always recoverable, transparent about it. Implementation: the UI filters on `applicable_activity_types`, but existing activities with types outside that list remain in the snapshot and continue flowing through calculation. Optionally, a "show hidden activities" toggle in the By Facility view for users who want to see what's there.

**Open edge case.** What about By Activity view? Activities for unchecked sources: show them there? Yes — By Activity is a cross-facility view, and the checklist is a By Facility filter. Keeping them visible in By Activity makes hidden data findable and recoverable without digging into the JSON.

### RESPONSE: Very clearly option C here, thank you. For the edge case -- This is a very good question. Here's what I think -- if we implement the change above and only show facilities that have that activity checked off, then maybe this becomes moot. We don't delete the data, and we show all sources in the by-activity entry section, but if a facility is unchecked, it is hidden from view. As an alternative (and please slow me down if this adds significant complexity to the frontend), we could always show rows with data entered in the by-activity view, but perhaps we add a visual flag or indicator saying that this data is not currenly included in the calculation. I'm not bound to this approach, so please follow up with me to discuss the LOE. 

### This all makes me think of another important consideration -- we must make sure that only activities that are checked for each facility are included in the results. Maybe they all get calculated either way, I'm agnostic on that point, but unchecked sources should not silently flow into the results, that would be a major issue.

### FOLLOWUP (Claude):

**On hide vs. visual-flag for unchecked-with-data rows in By Activity:**

LOE difference is small either way (both need a membership check against `facility.applicable_activity_types`). But the UX difference is significant. My recommendation: **hide, not flag.**

Reasoning: showing "data that exists but isn't counted" in the primary data-entry surface creates a confusing mental model. Users will wonder "if I type here, does it count? No? Then why is this row here?" Every glance at the grid costs mental cycles parsing which rows are live and which are inert. That cost compounds.

The right surface for "hidden data exists" is the configure-sources dialog itself — when editing a facility's applicability list, if unchecking a source would hide existing data, the dialog shows "⚠ this facility has existing data for X — will be hidden, not deleted." That's where the information is actionable (they're making the decision that hides it) instead of passively noisy.

If users later need to "rescue" hidden data, the affordance is: go to the facility, re-check the source, data reappears. Clean round-trip. No need for an always-on visual flag.

**On unchecked activities must not flow into results — critical and I fully agree.**

This is a backend correctness requirement, not just a UI nicety. The question is *where* to enforce the filter:

- **A. Filter at snapshot save / inventory canonicalization.** `SQLiteInventoryStore.save_inventory_version()` skips activities whose `(facility_id, activity_type_id)` isn't in that facility's applicability list. Inventory tables only ever hold applicable activities. Calculation reads from inventory → automatically correct.

- **B. Filter at calculation time.** The `/calculate` endpoint filters the activity list before passing to the engine. Inventory stores everything, calculation only runs on applicable.

- **C. Filter at the frontend.** Client only sends applicable activities. Trust the client.

**My recommendation: Option A.** Reasoning:
- **Canonical state = accounting truth.** If the user looks at inventory version 3, it should reflect what they actually counted, not everything they ever typed. This matters for audit and version comparison.
- **Calculation is derived from inventory** — if inventory is already filtered correctly, calculation is correct by construction. No duplicate filter logic to keep in sync.
- **Workspace JSON still preserves soft-hidden data** (that's Q4 Option C). Users don't lose anything. Rechecking a source means its data gets canonicalized on the next snapshot save.
- **One filter, one place, backend-enforced.** Frontend bugs can't leak unchecked data into results.

**Concrete implementation note.** This is small work inside `sqlite_inventory.py` — already has the "skip incomplete activity" pattern on line 203–205. We just extend that check: skip if incomplete **or** if `(facility_id, activity_type_id)` isn't in the owning facility's `applicable_activity_types`. Same for the calculation run materialization.

**What I need from you:** thumbs up on hide-not-flag for By Activity, and thumbs up on Option A (filter at inventory canonicalization).

## Q5. Is the checklist a filter, or a planning/progress tool?

**Why it matters.** The phrasing in your UI/UX notes leans heavily toward "planning tool": *create our data entry checklist directly in the interface*. If that's the intent, the feature is not just a filter — it should surface progress. Otherwise it's just a hide-stuff dropdown dressed up.

**Planning-tool implications.** Per facility, we show:
- Total selected sources: N
- Sources with any data entered: M
- Sources with complete data: K
- Progress bar / chips / some visual

This changes the facility card from "configure sources" to "data entry checklist" — the card IS the plan, and users work down it.

**Filter-tool implications.** Just a filter. The checklist is a settings panel, not a primary surface.

**Recommendation.** Build it as a planning tool. The marginal work is small (counts from existing draft state), but the user value is large — it matches the mental model of GHG data collection, which is genuinely a checklist exercise. It also gives us natural hooks for future features (assignee per source, due date per source, source-level notes) without schema rework.

**Data model implication.** None additional for v1. Progress is derived from existing activity drafts + the selected list. If we later add assignees/notes, those are per-source (facility_id + activity_type_id) metadata.

### RESPONSE: Absolutely we want this to be a planning tool, I love every thing about this idea. 

## Q6. Granularity — one checkbox per `activity_type_id`, or nested?

**Why it matters.** The catalog has 30 activity types. Some feel monolithic (e.g., "waste — landfill, no recovery") while others feel like roll-ups of many operational variants (e.g., "mobile combustion" spans 9+ fuel/vehicle combos).

**Observations.** Looking at the current catalog, each `activity_type_id` already represents a distinct accounting row. Nesting checkboxes below activity_type_id would duplicate the catalog taxonomy.

**Recommendation.** One checkbox per `activity_type_id`. If users find the list too long, solve with grouping (by Scope, by category) and search/filter on the checklist UI itself — not with a deeper data model.

### RESPONSE: Group up the check boxes logically. Ideally, this isn't something people are frequently touching -- they should be guided to enter it upfront and add to it occasionally if and when new sources are identified. I'm not overly concerned about length right now, but organization is great.

## Summary of what I need from you

Six answers, but they collapse into a small set of decisions:

| Q | Recommended answer | Core decision |
|---|---|---|
| Q1 | Project + facility split, with `typical_scope` hint on catalog | Where does the checklist data live? |
| Q2 | Hybrid: new facilities get deliberate onboarding, legacy treated as "show all" | Default behavior for unset state |
| Q3 | Per-snapshot (same as facilities/activities) | Versioning semantics |
| Q4 | Soft-hide with transparent warning at uncheck | Data preservation on uncheck |
| Q5 | Planning tool with progress, not just a filter | What the feature IS |
| Q6 | One checkbox per `activity_type_id` | Granularity |

If you agree with all six recommendations, Phase C2 is well-scoped and we can proceed. If any of these feel wrong, the one most worth pushing back on is probably Q1 (project + facility split) — that's the only one that touches the catalog schema. The rest are UI/draft-state decisions with no migration cost.

## Revised model after your responses

Your decisions simplify the feature significantly:

| Q | Resolved approach | Open follow-ups |
|---|---|---|
| Q1 | Facility-only. Single `applicable_activity_types: list[str]` on `FacilityDraft`. "Global" facilities are a naming convention, not a schema concept. | Do facilities need a `kind` field? UI term for "facility" (Source? Entity?)? |
| Q2 | Configure-sources button per facility on the Facilities tab with call-out when unset. Add-source / add-facility affordances in the entry views. Legacy facilities treated as "show all." | Per-header button vs. bottom-row affordance? First-time-experience routing when no facilities exist? |
| Q3 | Per-snapshot. Simple. | — |
| Q4 | Soft-hide with transparent warning. Hide unchecked-facility rows in By Activity (no visual-flag clutter). **Backend filters at inventory canonicalization — unchecked activities never reach results.** | Confirm hide-not-flag; confirm backend-filter location. |
| Q5 | Planning tool with progress surfaces per facility. | — |
| Q6 | One checkbox per `activity_type_id`, grouped logically in the configure dialog. | — |

## FINAL SCOPE (locked 2026-04-23)

All questions resolved. Phase C2 is ready to build.

| Decision | Resolution |
|---|---|
| Applicability data model | `applicable_activity_types: list[str]` on `FacilityDraft`. No project-level list. No catalog `typical_scope` field. "Global" entities are a naming convention. |
| UI terminology | **"Reporting Unit"** for the tab and UI copy. "Source" collides with activity-category terminology in the domain; "Reporting Unit" ties to the core reporting construct. Internal `FacilityDraft` rename deferred to Phase B2 (when we're remapping schemas anyway). |
| Reporting Unit typing | Untyped. No `kind`/`category` field. |
| Unset-state behavior | New Reporting Units: deliberate onboarding via configure button on the Reporting Units tab, with call-out when unconfigured. Legacy units: treated as "show all" for backwards compatibility. |
| Add/configure affordance | Persistent per-header button (not bottom-row). "+ configure sources" on each Reporting Unit card; "+ add Reporting Unit" on each activity header in By Activity. |
| By Activity behavior for unchecked units | Hide the row. Do not show a visual flag. The configure-sources dialog is where unchecking warns about existing data. |
| Unchecked-activity filter location | Backend, at inventory canonicalization (`sqlite_inventory.py`). Workspace JSON preserves soft-hidden data; canonical inventory tables and calculations only contain applicable activities. |
| Versioning | Per-snapshot. Checklist lives inside `FacilityDraft`, carried across saves naturally. |
| Checklist as planning tool | Yes. Progress surfaces per Reporting Unit (total / with data / complete). |
| Granularity | One checkbox per `activity_type_id`. Logical grouping (by Scope, by category) in the configure dialog. |
| First-time UX when "+ add Reporting Unit" has no units to list | Deferred — cross that bridge when we get there. |
