# Just a brainstorm on the ETL update

Currently, the ETL takes the data input from a forecast table with a set of mappings. This is reasonalby functional, but there's a manual step in the process -- rolling the inventory data into the forecast. What we really want is for the data to pull from the inventory, enter as an entry into an existing multi-year store, automatically generate the forecast based on pre-set parameters, and then load the data into powerBI fact tables (one for the inventory, one for the forecast)

Under this architecture, the forecasts need to be their own objects that ingest actuals
The actuals need to be entries in a database with data security, stability, and version control. So really, we're talking about upstreaming this ETL from the forecast to the inventory. Right now the inventory pull only works for one year. I don't want to build it out for more than one year, I don't think, because the complexity LOE starts to get a little out of hand for such a fragile system.

Instead of trying to pull all inventory data at once, I should just pull inventory audit outputs into a data store that can keep the outputs in a BI-optimized format

Dimensions:
* date
* scope (and scope_display)
* facility
* category
* business unit
* scenario
* EntryType -- ALWAYS ACTUAL when pulled from inventory. Forecast must be generated midstream
* MetricType -- activity, emissions
* Metric -- akin to 'source' in the audit data file
* Unit (display)




