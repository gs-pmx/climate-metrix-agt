# A parking garage for notes and backlog items - Climate Metrix development

1. Emissions factor integration
* we are in a place where a number of the base emissions factors are included, but there are many more that are not. We want to improve coverage substantially
    - This means adding factors from:
        - Ember
        - DESNZ
        - EPA EF hub
        - SIDE PROJECT - write upstream factors for all sources
        - State clean fuels CI factors
        - State utility-specific factors
        - Corporate utility emissions factors
        - EIA data ingestion?
        - CEDA
        - Specialized factors
            - E.g., forest emissions, CAPs, 
        - Anything else? Are there other authoritative sources, e.g., in Europe or IPCC, with EFs that we should be ingesting by default?
* Where relevant, we want to build some pipelines to ingest this data automatically when we run an EF update cycle.
* We also want to add some kind of interface/routine to very cleanly add emissions factors to the system, with versioning
* Lastly, we need some kind of report that just lists the emissions factor sources and the categories they cover in a particular inventory.

2. UI polish
* Need some more love on the UI side
    - Default view - maybe shift to reporting unit instead of activity. Alsok, when returning to activity inputs, open the most recent view, not the default.
    - Need to consider options for the by-activity view. It's just too muddled, and it's annoying that everything is collapsed by default. The whole point of the TOC is to make vertical navigation quicker.
        - There is also just not enough visual space and distinction between sections, so it's just not fun to parse with the eyes.
        - Honestly, I don't even like the TOC. I say, we try something different out - remove the text talking about how to paste (we know how to paste), and the implemented/planned stuff - just take it all out. Then we add a vertical nav for Scope 1, Scope 2, and Scope 3. You can click to jump, or you can click the arrow to open a dropdown list of the subheader sections. 
* Need a run calculation button on the spend inputs tab. Honeslty, maybe the run calcs and save checkpoint go on the right side of the sticky nav bar. Then we add a collapsing sidebar with additional navigation -- move 'Projects' and 'Catalog' there, and any future pages that aren't specific to an active project
* The dark mode needs some character. Way too bland right now. So does the light mode now that I think of it.
    - We need an opinionated design review for basic color/font/look-feel
* Add some kind of scroll buffer at the bottom so we can see the bottom data entry tables in mid screen rather than stuck at the very bottom.
* add widtch to the audit output columns, and limit the text wrap so we don't end up with completely illegible, super tall rows.
* The dashboard can be 100X better. Let's talk about how to make that happen
    - Colors need improvement, move source coverage (see below), need substantially better design, navigation, filtering. Need more 
* Move 'Source Coverage' to results. This is also where we will add the export configurations (see New Features below)
* The reporting units config section has a bunch of info bubbles -- the content is good, but the display is clunky. Perhaps we drop the pill-encased info and have a cleaner display, e.g., "9 selected, 7/9 complete, 2 orphaned"

3. Misc
*  The project metadata (inventory year, AR, and Include Trace, potentially others in the future), should be established at project setup, and do not need to be alterable inside the project. In essence, we create a project in the 'project setup' form, and those then become solid attributes. We can add a new button somewhere to 'Edit Project Setup', in which we can change these attributes, but they do not need to be displayed inside the new project layer (see the UI polish notes above). We should find a place to display these values in an unobtrusive manner inside the project interface, but minimize the space they take up and eliminate editing.
* The persistent info bubbles at the top (e.g., "All 36 sources complete, 8 activities have data that isn't included in your inventory.") are very annoying to me. We need a new place for these notifications that is out of the way, but still noticeable, perhaps as a notification icon on the collapsable sidebar. 
* Speed boost on calculation. Is there a way to make the engine faster? Is the engine a bottleneck or is it just moving data back and forth across state/API/persistence? If it's the engine, do we refactor some key parts in rust/c?

4. New features (not currently ordered by importance/value)
* Inventory export -- this is different from an audit export, with several levels of detail (full and selected aggregations), so a user can export numerical results for secondary processing/visualization.
* Climate action scaling module -- THIS IS A MAJOR NEW PROJECT, but need to figure out how we can set ourselves up for success
* Multi-year analysis -- view the trends over time, automated YoY variances by source (RU and category), as well as macro trends
* Hotspotting - where are the biggest leverage points in the inventory
* along with action scalign and YoY, add some kind of forecast and target tracking mechanism
* maybe a knowledge base with some of our top recommendations, based on hotspots
* Automated data ingestion -- VERY HIGH VALUE -- has touchpoint to a new service, i.e., we help customers set up data pipelines that connect with climate metrix for automated tracking
* additional operational insights (branch beyond GHGs, let's look at other operational factors, costs, trends, performance -- full service operational viewport and strategy support)


