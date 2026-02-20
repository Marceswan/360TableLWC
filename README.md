# 360 Table LWC

> **Built on the shoulders of [James Hou's](https://github.com/tsalb) [lwc-utils](https://github.com/tsalb/lwc-utils).** The SOQL Datatable architecture and patterns from that project served as the foundation for this Data Cloud-specific implementation.

Visual configurator and runtime component for Data Cloud datatables in Salesforce.

## What's Included

- **`data360Table`** — Standalone LWC that renders Data Cloud queries from saved configurations or direct query strings. Supports `$record.FieldName`, `$recordId`, and `$CurrentUserId` merge fields on Record Pages.
- **`data360Configurator`** — Two-panel admin UI for building and previewing Data Cloud table configs. Select objects, toggle field visibility, edit labels, reorder fields, set WHERE clauses, and see a live preview. Includes context record lookup for resolving `$record.FieldName` merge tokens in the preview.
- **`Data360ConfigService`** — Apex service handling CRUD for `Data_360_Table_Config__c`, Data Cloud object/field discovery, query execution, searchable object lookup, and context record field value retrieval.
- **`Data360ConfigPicklist`** — `VisualEditor.DynamicPickList` that populates the App Builder dropdown with saved config names.
- **`Data_360_Table_Config__c`** — Custom object storing config JSON, object API name, description, and human-readable name.
- **Permission Sets** — `Data_360_Table_User` (read-only) and `Data_360_Table_Admin` (full CRUD).

## Deployment

```bash
sf project deploy start -p force-app
```

## Run Tests

```bash
sf apex run test -n Data360ConfigServiceTests -r human -w 10
```

## App Builder Usage

1. Assign the `Data_360_Table_Admin` permission set to configurator admins.
2. Create a new App Page and add the `data360Configurator` component.
3. Use the configurator to select a Data Cloud object, configure fields, and save.
4. On any App Page or Record Page, add the `data360Table` component and select a saved config from the **Data 360 Config** dropdown.

## Configurator Features

### Live Preview with Context Records

When a WHERE clause contains `$record.FieldName` merge tokens, the configurator lets you select a **context object** and **context record** so the preview can resolve those tokens to real values. The flow:

1. Type a WHERE clause with `$record.FieldName` tokens (e.g. `WHERE Industry = $record.Industry`).
2. Search for and select a context object (e.g. Account).
3. Pick a specific record via the record picker.
4. The preview resolves merge tokens and executes the query with actual values.

### Field Management

- **Select All / Deselect All** — Bulk toggle field visibility.
- **Visibility Filter** — Filter the field list to show All Fields, Selected Only, or Unselected Only.
- **Reorder** — Move fields up or down with arrow buttons to control column order in the generated query and preview.

## Property Note

The `data360Table` component uses `configName` (not `data360ConfigName`) as its API property because LWC reserves property names starting with `data` for HTML `data-*` attributes.
