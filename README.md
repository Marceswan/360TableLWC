# 360 Table LWC

Visual configurator and runtime component for Data Cloud datatables in Salesforce.

## What's Included

- **`data360Table`** — Standalone LWC that renders Data Cloud queries from saved configurations or direct query strings. Supports `$record.FieldName`, `$recordId`, and `$CurrentUserId` merge fields on Record Pages.
- **`data360Configurator`** — Two-panel admin UI for building and previewing Data Cloud table configs. Select objects, toggle field visibility, edit labels, set WHERE clauses, and see a live preview.
- **`Data360ConfigService`** — Apex service handling CRUD for `Data_360_Table_Config__c`, Data Cloud object/field discovery, and query execution.
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

## Property Note

The `data360Table` component uses `configName` (not `data360ConfigName`) as its API property because LWC reserves property names starting with `data` for HTML `data-*` attributes.
