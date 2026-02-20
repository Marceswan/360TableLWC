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
  defaultSortField = '';
  defaultSortDirection = 'asc';
  showRecordCount = false;
  showSearch = false;
  showRefresh = false;

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
  _dragFieldName;

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
    if (this.fieldVisibilityFilter === 'selected') {
      return this.fields.filter(f => f.visible);
    }
    if (this.fieldVisibilityFilter === 'unselected') {
      return this.fields.filter(f => !f.visible);
    }
    return this.fields;
  }

  get isSaveDisabled() {
    return !this.configName;
  }

  get isDeleteDisabled() {
    return !this.selectedConfigId;
  }

  get isCloneDisabled() {
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

  get previewSortableFields() {
    const visibleFields = this.fields.filter(f => f.visible);
    if (visibleFields.length === 0) {
      return '';
    }
    return visibleFields.map(f => `${f.fieldName}=>${f.sortable}`).join(',');
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

  get sortableFieldOptions() {
    const options = [{ label: '-- None --', value: '' }];
    for (const f of this.fields) {
      if (f.visible && f.sortable) {
        options.push({ label: `${f.label} (${f.fieldName})`, value: f.fieldName });
      }
    }
    return options;
  }

  get sortDirectionOptions() {
    return [
      { label: 'Ascending', value: 'asc' },
      { label: 'Descending', value: 'desc' }
    ];
  }

  get isDefaultSortDirectionDisabled() {
    return !this.defaultSortField;
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
      this.defaultSortField = parsed.defaultSortField || '';
      this.defaultSortDirection = parsed.defaultSortDirection || 'asc';
      this.showRecordCount = parsed.showRecordCount || false;
      this.showSearch = parsed.showSearch || false;
      this.showRefresh = parsed.showRefresh || false;
      // Restore view state
      if (parsed.viewState) {
        this.fieldVisibilityFilter = parsed.viewState.fieldVisibilityFilter || 'all';
        this.contextObjectApiName = parsed.viewState.contextObjectApiName || '';
        this.contextObjectLabel = parsed.viewState.contextObjectLabel || '';
        this.contextObjectSearchTerm = parsed.viewState.contextObjectSearchTerm || '';
        this.contextRecordId = parsed.viewState.contextRecordId || '';
      } else {
        this.fieldVisibilityFilter = 'all';
        this.contextObjectApiName = '';
        this.contextObjectLabel = '';
        this.contextObjectSearchTerm = '';
        this.contextRecordId = '';
      }
      this._contextFieldValues = {};
      if (parsed.fields) {
        // Build a map of loaded fields (from Apex) keyed by fieldName
        const loadedFieldMap = new Map(this.fields.map(f => [f.fieldName, f]));
        // Rebuild in config-saved order, then append any new fields not in the config
        const orderedFields = [];
        const seen = new Set();
        for (const cf of parsed.fields) {
          const loaded = loadedFieldMap.get(cf.fieldName);
          if (loaded) {
            orderedFields.push({
              ...loaded,
              visible: cf.visible,
              label: cf.label,
              sortable: cf.sortable !== false
            });
            seen.add(cf.fieldName);
          }
        }
        // Append fields that exist on the object but weren't in the saved config
        for (const f of this.fields) {
          if (!seen.has(f.fieldName)) {
            orderedFields.push({ ...f, visible: false, sortable: true });
          }
        }
        this.fields = orderedFields;
      }
      // Parse merge tokens and fetch context values if a record was saved
      this._parseMergeTokens();
      if (this.contextRecordId && this._mergeTokens.length > 0) {
        this._fetchContextFieldValues();
      }
    } catch (e) {
      this._showToast('Error', 'Failed to parse config JSON: ' + e.message, 'error');
    }
  }

  handleClone() {
    this.selectedConfigId = '';
    this.configName = this.configName + ' - Copy';
    this._showToast('Cloned', 'Config cloned — update the name and click Save to create a new copy.', 'info');
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
    this.defaultSortField = '';
    this.defaultSortDirection = 'asc';
    this.showRecordCount = false;
    this.showSearch = false;
    this.showRefresh = false;
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
          visible: true,
          sortable: true
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

  handleFieldSortableChange(event) {
    const fieldName = event.target.dataset.fieldName;
    this.fields = this.fields.map(f => {
      if (f.fieldName === fieldName) {
        return { ...f, sortable: event.target.checked };
      }
      return f;
    });
    // Clear default sort if the field was deselected from sortable
    if (!event.target.checked && this.defaultSortField === fieldName) {
      this.defaultSortField = '';
    }
  }

  handleDefaultSortFieldChange(event) {
    this.defaultSortField = event.detail.value;
  }

  handleDefaultSortDirectionChange(event) {
    this.defaultSortDirection = event.detail.value;
  }

  handleShowRecordCountChange(event) {
    this.showRecordCount = event.target.checked;
  }

  handleShowSearchChange(event) {
    this.showSearch = event.target.checked;
  }

  handleShowRefreshChange(event) {
    this.showRefresh = event.target.checked;
  }

  handleDragStart(event) {
    this._dragFieldName = event.currentTarget.dataset.fieldName;
    event.currentTarget.classList.add('field-row-dragging');
    event.dataTransfer.effectAllowed = 'move';
  }

  handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const row = event.target.closest('tr[data-field-name]');
    // Clear previous drop indicators
    this.template.querySelectorAll('.field-row-drop-above, .field-row-drop-below').forEach(el => {
      el.classList.remove('field-row-drop-above', 'field-row-drop-below');
    });
    if (row && row.dataset.fieldName !== this._dragFieldName) {
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (event.clientY < midY) {
        row.classList.add('field-row-drop-above');
      } else {
        row.classList.add('field-row-drop-below');
      }
    }
  }

  handleDrop(event) {
    event.preventDefault();
    const targetRow = event.target.closest('tr[data-field-name]');
    if (!targetRow || !this._dragFieldName) return;
    const targetFieldName = targetRow.dataset.fieldName;
    if (targetFieldName === this._dragFieldName) return;

    const fromIdx = this.fields.findIndex(f => f.fieldName === this._dragFieldName);
    const toIdx = this.fields.findIndex(f => f.fieldName === targetFieldName);
    if (fromIdx < 0 || toIdx < 0) return;

    // Determine if dropping above or below the target
    const rect = targetRow.getBoundingClientRect();
    const dropAbove = event.clientY < rect.top + rect.height / 2;

    const updated = [...this.fields];
    const [moved] = updated.splice(fromIdx, 1);
    let insertIdx = updated.findIndex(f => f.fieldName === targetFieldName);
    if (!dropAbove) {
      insertIdx += 1;
    }
    updated.splice(insertIdx, 0, moved);
    this.fields = updated;
    this._dragFieldName = null;
  }

  handleDragEnd() {
    this._dragFieldName = null;
    this.template.querySelectorAll('.field-row-dragging, .field-row-drop-above, .field-row-drop-below').forEach(el => {
      el.classList.remove('field-row-dragging', 'field-row-drop-above', 'field-row-drop-below');
    });
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
        limit: this.rowLimit,
        defaultSortField: this.defaultSortField,
        defaultSortDirection: this.defaultSortDirection,
        showRecordCount: this.showRecordCount,
        showSearch: this.showSearch,
        showRefresh: this.showRefresh,
        viewState: {
          fieldVisibilityFilter: this.fieldVisibilityFilter,
          contextObjectApiName: this.contextObjectApiName,
          contextObjectLabel: this.contextObjectLabel,
          contextObjectSearchTerm: this.contextObjectSearchTerm,
          contextRecordId: this.contextRecordId
        }
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
        visible: true,
        sortable: true
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
