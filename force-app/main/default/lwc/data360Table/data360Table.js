import { LightningElement, api, wire } from 'lwc';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { getRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import Id from '@salesforce/user/Id';

import getConfigByName from '@salesforce/apex/Data360ConfigService.getConfigByName';
import executeQuery from '@salesforce/apex/Data360ConfigService.executeQuery';

export default class Data360Table extends LightningElement {
  @api recordId;
  @api objectApiName;
  @api configName;
  @api title;
  @api iconName;
  @api showRecordCount = false;

  // For direct query mode (used by configurator preview)
  @api columnLabels;

  _queryString;
  _queryStringInitialized = false;

  @api
  get queryString() {
    return this._queryString;
  }
  set queryString(value) {
    const prev = this._queryString;
    this._queryString = value;
    // After initial render, re-execute when query changes
    if (this._queryStringInitialized && value && value !== prev) {
      this._parseColumnLabels();
      this._executeAndRender(value);
    }
  }

  // Table state
  tableData = [];
  tableColumns = [];
  keyField = 'Id';
  sortedBy;
  sortedDirection = 'asc';

  // UI state
  isLoading = false;
  errorMessage = '';

  // Private
  _isRendered = false;
  _mergeMap = new Map();
  _objectApiName;
  _objectInfo;
  _getRecordFields = [];
  _assembledQuery;
  _columnLabelsMap = new Map();

  get hasData() {
    return !this.isLoading && !this.errorMessage && this.tableData.length > 0;
  }

  get hasError() {
    return !this.isLoading && this.errorMessage;
  }

  get isEmpty() {
    return !this.isLoading && !this.errorMessage && this.tableData.length === 0 && this._assembledQuery;
  }

  get recordCountLabel() {
    return `${this.tableData.length} record${this.tableData.length !== 1 ? 's' : ''}`;
  }

  // Wire for $record merge field resolution
  @wire(getObjectInfo, { objectApiName: '$_objectApiName' })
  objectInfoWire({ error, data }) {
    if (error) {
      this._handleError('Object info error', error);
    } else if (data && this._mergeMap.size > 0) {
      this._objectInfo = data;
      this._getRecordFields = Array.from(this._mergeMap.values()).map((c) => c.objectQualifiedFieldApiName);
    }
  }

  @wire(getRecord, { recordId: '$recordId', fields: '$_getRecordFields' })
  recordWire({ error, data }) {
    if (error) {
      this._handleError('Record data error', error);
    } else if (data) {
      // Merge field values into the query
      let query = this._assembledQuery;
      for (const [key, config] of this._mergeMap.entries()) {
        const fieldValue = data.fields[config.fieldApiName].value;
        const dataType = this._objectInfo.fields[config.fieldApiName].dataType.toLowerCase();
        const needsQuotes = ['string', 'reference', 'picklist', 'text', 'textarea', 'email', 'phone', 'url'].includes(
          dataType
        );
        query = query.replace(key, needsQuotes ? `'${fieldValue}'` : fieldValue);
      }
      this._executeAndRender(query);
    }
  }

  async connectedCallback() {
    if (this._queryString) {
      // Direct query mode (preview from configurator)
      this._parseColumnLabels();
      await this._executeAndRender(this._queryString);
      this._queryStringInitialized = true;
      return;
    }
    this._queryStringInitialized = true;

    if (!this.configName) {
      return;
    }

    this.isLoading = true;
    try {
      const config = await getConfigByName({ configName: this.configName });
      if (!config) {
        this._handleError('Config Error', `Data 360 Config '${this.configName}' not found`);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(config.Config_JSON__c);
      } catch (e) {
        this._handleError('Config Error', `Invalid JSON: ${e.message}`);
        return;
      }

      // Build column labels map from config
      const visibleFields = parsed.fields.filter((f) => f.visible);
      if (visibleFields.length === 0) {
        this._handleError('Config Error', 'No visible fields configured');
        return;
      }

      this._columnLabelsMap = new Map(visibleFields.map((f) => [f.fieldName, f.label]));

      const fieldNames = visibleFields.map((f) => f.fieldName).join(', ');
      const whereClause = parsed.whereClause || '';
      const limit = parsed.limit || 100;
      let query = `SELECT ${fieldNames} FROM ${parsed.objectApiName} ${whereClause} LIMIT ${limit}`;

      // Handle merge fields
      if (query.includes('$recordId')) {
        query = query.replace(/\$recordId/g, `'${this.recordId}'`);
      }
      if (query.includes('$CurrentUserId')) {
        query = query.replace(/\$CurrentUserId/g, `'${Id}'`);
      }

      // $record.FieldName -> LDS merge
      if (query.includes('$record.')) {
        query = query.replace(/\$record\./g, '$CurrentRecord.');
      }
      if (query.includes('$CurrentRecord.')) {
        if (!this.objectApiName) {
          this._handleError('Config Error', '$record merge fields require a Record Page');
          return;
        }
        const matches = query.match(/(\$CurrentRecord\.\w+)/g);
        if (matches) {
          matches.forEach((original) => {
            const fieldApiName = original.replace('$CurrentRecord.', '');
            this._mergeMap.set(original, {
              objectQualifiedFieldApiName: `${this.objectApiName}.${fieldApiName}`,
              fieldApiName: fieldApiName
            });
          });
          this._assembledQuery = query;
          this._objectApiName = this.objectApiName;
          // Wire handlers will pick up from here
          return;
        }
      }

      await this._executeAndRender(query);
    } catch (error) {
      this._handleError('Load Error', error);
    }
  }

  // Public API for configurator to refresh preview
  @api
  async refreshWithQuery(queryString, columnLabelsString) {
    this.tableData = [];
    this.tableColumns = [];
    this.errorMessage = '';
    if (columnLabelsString) {
      this._columnLabelsMap = new Map(
        columnLabelsString
          .split(',')
          .filter((m) => m.includes('=>'))
          .map((m) => m.split('=>').map((p) => p.trim()))
      );
    }
    await this._executeAndRender(queryString);
  }

  handleSort(event) {
    const { fieldName, sortDirection } = event.detail;
    this.sortedBy = fieldName;
    this.sortedDirection = sortDirection;
    this.tableData = this._sortData(fieldName, sortDirection);
  }

  // Private methods

  async _executeAndRender(queryString) {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const result = await executeQuery({ queryString: queryString });
      this._assembledQuery = queryString;

      // Apply column labels from config
      this.tableColumns = result.tableColumns.map((col) => {
        const customLabel = this._columnLabelsMap.get(col.fieldName);
        return {
          ...col,
          label: customLabel || col.label,
          sortable: true
        };
      });

      // Detect key field - use 'Id' if present, otherwise generate row keys
      const hasId = result.tableColumns.some((c) => c.fieldName === 'Id');
      if (!hasId && result.tableData.length > 0) {
        this.keyField = '_rowKey';
        this.tableData = result.tableData.map((row, idx) => ({ ...row, _rowKey: `row-${idx}` }));
      } else {
        this.keyField = 'Id';
        this.tableData = result.tableData;
      }
    } catch (error) {
      this._handleError('Query Error', error);
    } finally {
      this.isLoading = false;
    }
  }

  _parseColumnLabels() {
    if (this.columnLabels) {
      this._columnLabelsMap = new Map(
        this.columnLabels
          .split(',')
          .filter((m) => m.includes('=>'))
          .map((m) => m.split('=>').map((p) => p.trim()))
      );
    }
  }

  _sortData(fieldName, sortDirection) {
    const data = [...this.tableData];
    const reverse = sortDirection === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      const aVal = a[fieldName] || '';
      const bVal = b[fieldName] || '';
      if (aVal < bVal) return -1 * reverse;
      if (aVal > bVal) return 1 * reverse;
      return 0;
    });
    return data;
  }

  _handleError(title, error) {
    this.isLoading = false;
    const message =
      typeof error === 'string' ? error : error.body ? error.body.message : error.message || JSON.stringify(error);
    this.errorMessage = message;
    this.dispatchEvent(new ShowToastEvent({ title, message, variant: 'error', mode: 'sticky' }));
  }
}
