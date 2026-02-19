import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import getConfigs from '@salesforce/apex/Data360ConfigService.getConfigs';
import saveConfig from '@salesforce/apex/Data360ConfigService.saveConfig';
import deleteConfig from '@salesforce/apex/Data360ConfigService.deleteConfig';
import getDataCloudObjects from '@salesforce/apex/Data360ConfigService.getDataCloudObjects';
import getDataCloudFields from '@salesforce/apex/Data360ConfigService.getDataCloudFields';

export default class Data360Configurator extends LightningElement {
  configName = '';
  configDescription = '';
  selectedConfigId = '';
  selectedObject = '';
  whereClause = '';
  rowLimit = 100;

  @track fields = [];
  configOptions = [];
  objectOptions = [];

  isLoading = false;
  showDeleteModal = false;

  _configsMap = new Map();

  get hasFields() {
    return this.fields.length > 0;
  }

  get isSaveDisabled() {
    return !this.configName || !this.selectedObject || !this.fields.some(f => f.visible);
  }

  get isDeleteDisabled() {
    return !this.selectedConfigId;
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

  async connectedCallback() {
    await this._loadConfigs();
    await this._loadObjects();
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
      this.selectedObject = parsed.objectApiName;
      this.whereClause = parsed.whereClause || '';
      this.rowLimit = parsed.limit || 100;
      await this._loadFieldsForObject(this.selectedObject);
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
    this.whereClause = '';
    this.rowLimit = 100;
    this.fields = [];
  }

  handleNameChange(event) {
    this.configName = event.detail.value;
  }

  handleDescriptionChange(event) {
    this.configDescription = event.detail.value;
  }

  async handleObjectSelect(event) {
    this.selectedObject = event.detail.value;
    if (this.selectedObject) {
      await this._loadFieldsForObject(this.selectedObject);
    } else {
      this.fields = [];
    }
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

  handleWhereChange(event) {
    this.whereClause = event.detail.value;
  }

  handleLimitChange(event) {
    this.rowLimit = event.detail.value;
  }

  async handleSave() {
    if (!this.configName) {
      this._showToast('Validation Error', 'Config Name is required', 'error');
      return;
    }
    if (!this.selectedObject) {
      this._showToast('Validation Error', 'Please select a Data Cloud object', 'error');
      return;
    }
    if (!this.fields.some(f => f.visible)) {
      this._showToast('Validation Error', 'At least one field must be visible', 'error');
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

  async _loadObjects() {
    try {
      const objects = await getDataCloudObjects();
      this.objectOptions = objects;
    } catch (error) {
      this.objectOptions = [];
      this._showToast('Info', 'No Data Cloud objects found in this org', 'info');
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
