import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import getConfigs from '@salesforce/apex/Data360ConfigService.getConfigs';
import saveConfig from '@salesforce/apex/Data360ConfigService.saveConfig';
import deleteConfig from '@salesforce/apex/Data360ConfigService.deleteConfig';
import getDataCloudFields from '@salesforce/apex/Data360ConfigService.getDataCloudFields';
import getSearchableObjects from '@salesforce/apex/Data360ConfigService.getSearchableObjects';
import getRecordFieldValues from '@salesforce/apex/Data360ConfigService.getRecordFieldValues';

export default class Data360Configurator extends LightningElement {
  configName = '';
  configDescription = '';
  selectedConfigId = '';
  selectedObject = '';
  whereClause = '';
  rowLimit = 100;

  @track fields = [];
  configOptions = [];

  isLoading = false;
  showDeleteModal = false;

  // Object name direct-entry
  objectApiNameInput = '';

  // Context record state
  contextObjectApiName = '';
  contextObjectLabel = '';
  contextObjectSearchTerm = '';
  contextRecordId = '';
  @track contextObjectResults = [];
  showContextObjectDropdown = false;
  _contextFieldValues = {};
  _mergeTokens = [];
  _contextBlurTimeout;

  // Field visibility filter
  fieldVisibilityFilter = 'all';

  _configsMap = new Map();

  get hasFields() {
    return this.fields.length > 0;
  }

  get fieldVisibilityFilterOptions() {
    return [
      { label: 'All Fields', value: 'all' },
      { label: 'Selected Only', value: 'selected' },
      { label: 'Unselected Only', value: 'unselected' }
    ];
  }

  get fieldsWithPosition() {
    let filtered = this.fields;
    if (this.fieldVisibilityFilter === 'selected') {
      filtered = this.fields.filter(f => f.visible);
    } else if (this.fieldVisibilityFilter === 'unselected') {
      filtered = this.fields.filter(f => !f.visible);
    }
    const allLen = this.fields.length;
    return filtered.map(f => {
      const srcIdx = this.fields.findIndex(s => s.fieldName === f.fieldName);
      return {
        ...f,
        isFirst: srcIdx === 0,
        isLast: srcIdx === allLen - 1
      };
    });
  }

  get isSaveDisabled() {
    return !this.configName;
  }

  get isDeleteDisabled() {
    return !this.selectedConfigId;
  }

  get isLoadFieldsDisabled() {
    return !this.objectApiNameInput;
  }

  get fieldCount() {
    return this.fields.length;
  }

  get previewQueryString() {
    const visibleFields = this.fields.filter(f => f.visible);
    if (!this.selectedObject || visibleFields.length === 0) {
      return '';
    }
    const fieldNames = visibleFields.map(f => f.fieldName).join(', ');
    const where = this.whereClause || '';
    const limit = this.rowLimit || 100;
    return `SELECT ${fieldNames} FROM ${this.selectedObject} ${where} LIMIT ${limit}`;
  }

  get previewColumnLabels() {
    const visibleFields = this.fields.filter(f => f.visible);
    if (visibleFields.length === 0) {
      return '';
    }
    return visibleFields.map(f => `${f.fieldName}=>${f.label}`).join(',');
  }

  get resolvedPreviewQueryString() {
    const raw = this.previewQueryString;
    if (!raw) {
      return '';
    }
    if (this._mergeTokens.length === 0) {
      return raw;
    }
    // Tokens exist but no context record selected yet
    if (!this.contextRecordId) {
      return '';
    }
    // Tokens exist, record selected, but values not yet fetched
    if (Object.keys(this._contextFieldValues).length === 0) {
      return '';
    }
    let resolved = raw;
    for (const fieldName of this._mergeTokens) {
      const value = this._contextFieldValues[fieldName];
      const token = `$record.${fieldName}`;
      if (value === null || value === undefined) {
        resolved = resolved.split(token).join('NULL');
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        resolved = resolved.split(token).join(String(value));
      } else {
        resolved = resolved.split(token).join(`'${String(value)}'`);
      }
    }
    return resolved;
  }

  get mergeTokenCount() {
    return this._mergeTokens.length;
  }

  get mergeTokenStatusText() {
    if (this._mergeTokens.length === 0) {
      return '';
    }
    if (!this.contextRecordId) {
      return `${this._mergeTokens.length} $record token(s) detected — select a context record to resolve`;
    }
    if (Object.keys(this._contextFieldValues).length > 0) {
      return `${this._mergeTokens.length} token(s) resolved`;
    }
    return `Fetching ${this._mergeTokens.length} field value(s)...`;
  }

  get hasPendingMergeTokens() {
    return this._mergeTokens.length > 0 && !this.contextRecordId;
  }

  get contextObjectNoResults() {
    return this.contextObjectResults.length === 0 && this.contextObjectSearchTerm.length > 0;
  }

  async connectedCallback() {
    await this._loadConfigs();
  }

  async handleConfigSelect(event) {
    const configId = event.detail.value;
    if (!configId) {
      this.handleNew();
      return;
    }
    const config = this._configsMap.get(configId);
    if (!config) {
      return;
    }
    this.selectedConfigId = configId;
    this.configName = config.Name;
    this.configDescription = config.Description__c || '';
    try {
      const parsed = JSON.parse(config.Config_JSON__c);
      this.selectedObject = parsed.objectApiName || '';
      this.whereClause = parsed.whereClause || '';
      this.rowLimit = parsed.limit || 100;
      if (this.selectedObject) {
        this.objectApiNameInput = this.selectedObject;
        await this._loadFieldsForObject(this.selectedObject);
      } else {
        this.objectApiNameInput = '';
      }
      if (parsed.fields) {
        const configFieldMap = new Map(parsed.fields.map(f => [f.fieldName, f]));
        this.fields = this.fields.map(f => {
          const configField = configFieldMap.get(f.fieldName);
          if (configField) {
            return { ...f, visible: configField.visible, label: configField.label };
          }
          return { ...f, visible: false };
        });
      }
    } catch (e) {
      this._showToast('Error', 'Failed to parse config JSON: ' + e.message, 'error');
    }
  }

  handleNew() {
    this.selectedConfigId = '';
    this.configName = '';
    this.configDescription = '';
    this.selectedObject = '';
    this.objectApiNameInput = '';
    this.whereClause = '';
    this.rowLimit = 100;
    this.fields = [];
    this.fieldVisibilityFilter = 'all';
    // Clear context state
    this.contextObjectApiName = '';
    this.contextObjectLabel = '';
    this.contextObjectSearchTerm = '';
    this.contextRecordId = '';
    this.contextObjectResults = [];
    this.showContextObjectDropdown = false;
    this._contextFieldValues = {};
    this._mergeTokens = [];
  }

  handleNameChange(event) {
    this.configName = event.detail.value;
  }

  handleDescriptionChange(event) {
    this.configDescription = event.detail.value;
  }

  handleObjectNameChange(event) {
    this.objectApiNameInput = event.detail.value;
    // Clear validated object if user edits the name
    if (this.selectedObject && this.objectApiNameInput !== this.selectedObject) {
      this.selectedObject = '';
      this.fields = [];
    }
  }

  handleObjectNameKeyUp(event) {
    if (event.key === 'Enter' && this.objectApiNameInput) {
      this.handleLoadFields();
    }
  }

  async handleLoadFields() {
    if (!this.objectApiNameInput) {
      return;
    }
    const objectName = this.objectApiNameInput.trim();
    this.isLoading = true;
    try {
      const fieldData = await getDataCloudFields({ objectApiName: objectName });
      if (fieldData.length === 0) {
        this._showToast('No Fields Found', `No fields returned for "${objectName}". Verify the API name is correct.`, 'warning');
        this.selectedObject = '';
        this.fields = [];
      } else {
        this.selectedObject = objectName;
        this.objectApiNameInput = objectName;
        this.fields = fieldData.map(f => ({
          fieldName: f.fieldName,
          label: f.label,
          visible: true
        }));
        this._showToast('Success', `Loaded ${fieldData.length} fields for ${objectName}`, 'success');
      }
    } catch (error) {
      this.selectedObject = '';
      this.fields = [];
      this._showToast('Invalid Object', error.body ? error.body.message : error.message, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  handleObjectClear() {
    this.selectedObject = '';
    this.objectApiNameInput = '';
    this.fields = [];
  }

  handleFieldVisibleChange(event) {
    const fieldName = event.target.dataset.fieldName;
    this.fields = this.fields.map(f => {
      if (f.fieldName === fieldName) {
        return { ...f, visible: event.target.checked };
      }
      return f;
    });
  }

  handleFieldLabelChange(event) {
    const fieldName = event.target.dataset.fieldName;
    const newLabel = event.detail.value;
    this.fields = this.fields.map(f => {
      if (f.fieldName === fieldName) {
        return { ...f, label: newLabel };
      }
      return f;
    });
  }

  handleSelectAll() {
    this.fields = this.fields.map(f => ({ ...f, visible: true }));
  }

  handleDeselectAll() {
    this.fields = this.fields.map(f => ({ ...f, visible: false }));
  }

  handleFieldVisibilityFilterChange(event) {
    this.fieldVisibilityFilter = event.detail.value;
  }

  handleMoveFieldUp(event) {
    const fieldName = event.currentTarget.dataset.fieldName;
    const idx = this.fields.findIndex(f => f.fieldName === fieldName);
    if (idx <= 0) return;
    const updated = [...this.fields];
    [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
    this.fields = updated;
  }

  handleMoveFieldDown(event) {
    const fieldName = event.currentTarget.dataset.fieldName;
    const idx = this.fields.findIndex(f => f.fieldName === fieldName);
    if (idx < 0 || idx >= this.fields.length - 1) return;
    const updated = [...this.fields];
    [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
    this.fields = updated;
  }

  handleWhereChange(event) {
    this.whereClause = event.detail.value;
    this._parseMergeTokens();
    if (this.contextRecordId && this._mergeTokens.length > 0) {
      this._fetchContextFieldValues();
    }
  }

  handleLimitChange(event) {
    this.rowLimit = event.detail.value;
  }

  async handleSave() {
    if (!this.configName) {
      this._showToast('Validation Error', 'Config Name is required', 'error');
      return;
    }

    this.isLoading = true;
    try {
      const configJson = JSON.stringify({
        objectApiName: this.selectedObject,
        fields: this.fields,
        whereClause: this.whereClause,
        limit: this.rowLimit
      });

      const record = {
        Name: this.configName,
        Description__c: this.configDescription,
        Object_API_Name__c: this.selectedObject,
        Config_JSON__c: configJson
      };

      if (this.selectedConfigId) {
        record.Id = this.selectedConfigId;
      }

      const result = await saveConfig({ config: record });
      this.selectedConfigId = result.Id;
      await this._loadConfigs();
      this._showToast('Success', `Config "${this.configName}" saved`, 'success');
    } catch (error) {
      this._showToast('Save Error', error.body ? error.body.message : error.message, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  handleDeleteClick() {
    this.showDeleteModal = true;
  }

  handleDeleteCancel() {
    this.showDeleteModal = false;
  }

  async handleDeleteConfirm() {
    this.showDeleteModal = false;
    this.isLoading = true;
    try {
      await deleteConfig({ configId: this.selectedConfigId });
      this._showToast('Success', `Config "${this.configName}" deleted`, 'success');
      this.handleNew();
      await this._loadConfigs();
    } catch (error) {
      this._showToast('Delete Error', error.body ? error.body.message : error.message, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  // ── Context Object Search Handlers ─────────────────────────

  async handleContextObjectSearch(event) {
    this.contextObjectSearchTerm = event.detail.value;
    // Clear selection if user edits after selecting
    if (this.contextObjectApiName) {
      this.contextObjectApiName = '';
      this.contextObjectLabel = '';
      this.contextRecordId = '';
      this._contextFieldValues = {};
    }
    if (this.contextObjectSearchTerm.length < 1) {
      this.contextObjectResults = [];
      this.showContextObjectDropdown = false;
      return;
    }
    try {
      const results = await getSearchableObjects({ searchTerm: this.contextObjectSearchTerm });
      this.contextObjectResults = results;
      this.showContextObjectDropdown = true;
    } catch (error) {
      this.contextObjectResults = [];
      this.showContextObjectDropdown = false;
    }
  }

  handleContextObjectKeyUp(event) {
    if (event.key === 'Escape') {
      this.showContextObjectDropdown = false;
    }
  }

  handleContextObjectFocus() {
    if (this.contextObjectResults.length > 0 && !this.contextObjectApiName) {
      this.showContextObjectDropdown = true;
    }
  }

  handleContextObjectBlur() {
    // Delay to allow onmousedown on dropdown options to fire first
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this._contextBlurTimeout = setTimeout(() => {
      this.showContextObjectDropdown = false;
    }, 200);
  }

  handleContextObjectSelect(event) {
    if (this._contextBlurTimeout) {
      clearTimeout(this._contextBlurTimeout);
    }
    const apiName = event.currentTarget.dataset.apiName;
    const label = event.currentTarget.dataset.label;
    this.contextObjectApiName = apiName;
    this.contextObjectLabel = label;
    this.contextObjectSearchTerm = `${label} (${apiName})`;
    this.contextRecordId = '';
    this._contextFieldValues = {};
    this.showContextObjectDropdown = false;
    this.contextObjectResults = [];
  }

  handleContextRecordChange(event) {
    this.contextRecordId = event.detail.recordId || '';
    this._contextFieldValues = {};
    if (this.contextRecordId && this._mergeTokens.length > 0) {
      this._fetchContextFieldValues();
    }
  }

  // ── Merge Token Resolution ────────────────────────────────

  _parseMergeTokens() {
    const fullQuery = this.previewQueryString;
    if (!fullQuery) {
      this._mergeTokens = [];
      return;
    }
    const matches = fullQuery.match(/\$record\.(\w+)/g);
    if (!matches) {
      this._mergeTokens = [];
      return;
    }
    const fieldNames = [...new Set(matches.map(m => m.replace('$record.', '')))];
    this._mergeTokens = fieldNames;
  }

  async _fetchContextFieldValues() {
    if (!this.contextObjectApiName || !this.contextRecordId || this._mergeTokens.length === 0) {
      return;
    }
    try {
      const result = await getRecordFieldValues({
        objectApiName: this.contextObjectApiName,
        recordId: this.contextRecordId,
        fieldNames: this._mergeTokens
      });
      this._contextFieldValues = result || {};
    } catch (error) {
      this._contextFieldValues = {};
      this._showToast('Context Error', error.body ? error.body.message : error.message, 'error');
    }
  }

  async _loadConfigs() {
    try {
      const configs = await getConfigs();
      this._configsMap = new Map(configs.map(c => [c.Id, c]));
      this.configOptions = [
        { label: '-- New Config --', value: '' },
        ...configs.map(c => ({ label: c.Name, value: c.Id }))
      ];
    } catch (error) {
      this._showToast('Error', 'Failed to load configs: ' + (error.body ? error.body.message : error.message), 'error');
    }
  }

  async _loadFieldsForObject(objectApiName) {
    this.isLoading = true;
    try {
      const fieldData = await getDataCloudFields({ objectApiName: objectApiName });
      this.fields = fieldData.map(f => ({
        fieldName: f.fieldName,
        label: f.label,
        visible: true
      }));
    } catch (error) {
      this.fields = [];
      this._showToast('Field Discovery Error', error.body ? error.body.message : error.message, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  _showToast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
