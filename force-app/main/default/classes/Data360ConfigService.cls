public inherited sharing class Data360ConfigService {

  // ── CRUD ──────────────────────────────────────────────────────

  @AuraEnabled
  public static List<Data_360_Table_Config__c> getConfigs() {
    return [
      SELECT Id, Name, Description__c, Object_API_Name__c, Config_JSON__c
      FROM Data_360_Table_Config__c
      ORDER BY Name ASC
    ];
  }

  @AuraEnabled(cacheable=true)
  public static Data_360_Table_Config__c getConfigByName(String configName) {
    List<Data_360_Table_Config__c> configs = [
      SELECT Id, Name, Description__c, Object_API_Name__c, Config_JSON__c
      FROM Data_360_Table_Config__c
      WHERE Name = :configName
      LIMIT 1
    ];
    if (configs.isEmpty()) {
      return null;
    }
    return configs[0];
  }

  @AuraEnabled
  public static Data_360_Table_Config__c saveConfig(Data_360_Table_Config__c config) {
    upsert config;
    return config;
  }

  @AuraEnabled
  public static void deleteConfig(Id configId) {
    delete [SELECT Id FROM Data_360_Table_Config__c WHERE Id = :configId];
  }

  // ── Data Cloud Field Discovery ───────────────────────────────
  // Note: Data Cloud object discovery is handled client-side via
  // fetch('/services/data/v62.0/sobjects') in the LWC, because DC objects
  // are not available through Schema.getGlobalDescribe() or EntityDefinition,
  // and UserInfo.getSessionId() from @AuraEnabled returns a restricted
  // Lightning session that cannot make REST API callouts.

  @AuraEnabled
  public static List<Map<String, String>> getDataCloudFields(String objectApiName) {
    if (String.isBlank(objectApiName)) {
      return new List<Map<String, String>>();
    }
    // Try FieldDefinition first (standard/custom objects)
    List<Map<String, String>> fields = getFieldsViaFieldDefinition(objectApiName);
    if (!fields.isEmpty()) {
      return fields;
    }
    // Try Schema.describeSObjects (works for DC objects by explicit name)
    fields = getFieldsViaDescribe(objectApiName);
    if (!fields.isEmpty()) {
      return fields;
    }
    // Last resort: FIELDS(ALL) probe query (bounded-field objects only)
    return getFieldsViaProbeQuery(objectApiName);
  }

  @TestVisible
  private static List<Map<String, String>> getFieldsViaFieldDefinition(String objectApiName) {
    List<Map<String, String>> fields = new List<Map<String, String>>();
    if (String.isBlank(objectApiName)) {
      return fields;
    }
    try {
      for (FieldDefinition fd : [
        SELECT QualifiedApiName, Label
        FROM FieldDefinition
        WHERE EntityDefinition.QualifiedApiName = :objectApiName
        ORDER BY QualifiedApiName ASC
      ]) {
        fields.add(new Map<String, String>{
          'fieldName' => fd.QualifiedApiName,
          'label' => fd.Label
        });
      }
    } catch (Exception e) {
      // FieldDefinition may not work for all Data Cloud objects — fall through
      System.debug('FieldDefinition query failed for ' + objectApiName + ': ' + e.getMessage());
    }
    return fields;
  }

  @TestVisible
  private static List<Map<String, String>> getFieldsViaDescribe(String objectApiName) {
    List<Map<String, String>> fields = new List<Map<String, String>>();
    if (String.isBlank(objectApiName)) {
      return fields;
    }
    try {
      Schema.DescribeSObjectResult[] describes = Schema.describeSObjects(new List<String>{ objectApiName });
      if (!describes.isEmpty()) {
        Map<String, Schema.SObjectField> fieldMap = describes[0].fields.getMap();
        List<String> fieldNames = new List<String>(fieldMap.keySet());
        fieldNames.sort();
        for (String fieldName : fieldNames) {
          Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();
          fields.add(new Map<String, String>{
            'fieldName' => dfr.getName(),
            'label' => dfr.getLabel()
          });
        }
      }
    } catch (Exception e) {
      System.debug('describeSObjects failed for ' + objectApiName + ': ' + e.getMessage());
    }
    return fields;
  }

  @TestVisible
  private static List<Map<String, String>> getFieldsViaProbeQuery(String objectApiName) {
    List<Map<String, String>> fields = new List<Map<String, String>>();
    if (String.isBlank(objectApiName)) {
      throw new Data360ConfigServiceException('Object API name is required');
    }
    try {
      String probeQuery = 'SELECT FIELDS(ALL) FROM ' + String.escapeSingleQuotes(objectApiName) + ' LIMIT 1';
      List<SObject> rows = Database.query(probeQuery);
      if (!rows.isEmpty()) {
        Map<String, Object> populatedFields = rows[0].getPopulatedFieldsAsMap();
        List<String> fieldNames = new List<String>(populatedFields.keySet());
        fieldNames.sort();
        for (String fieldName : fieldNames) {
          fields.add(new Map<String, String>{
            'fieldName' => fieldName,
            'label' => buildLabel(fieldName)
          });
        }
      }
    } catch (Exception e) {
      throw new Data360ConfigServiceException('Unable to discover fields for ' + objectApiName + ': ' + e.getMessage());
    }
    return fields;
  }

  // ── Data Cloud Query Execution ───────────────────────────────

  @AuraEnabled
  public static Map<String, Object> executeQuery(String queryString) {
    if (String.isBlank(queryString)) {
      throw new Data360ConfigServiceException('Missing query string.');
    }
    String objectName = queryString.substringAfter(' FROM ').split(' ').get(0);

    if (!queryString.containsIgnoreCase(' LIMIT ')) {
      queryString += ' LIMIT 500';
    }

    List<SObject> tableData;
    try {
      tableData = Database.query(queryString);
    } catch (Exception e) {
      throw new Data360ConfigServiceException(e.getMessage());
    }

    List<Map<String, Object>> tableColumns = buildColumnData(queryString, tableData);

    return new Map<String, Object>{
      'tableData' => tableData,
      'tableColumns' => tableColumns,
      'objectApiName' => objectName
    };
  }

  @AuraEnabled(cacheable=true)
  public static String getQueryExceptionMessage(String queryString) {
    String errorMessage;
    try {
      Database.query(queryString);
    } catch (System.QueryException e) {
      errorMessage = e.getMessage();
    }
    return errorMessage;
  }

  // ── Column Building ──────────────────────────────────────────

  private static List<Map<String, Object>> buildColumnData(String queryString, List<SObject> rows) {
    String soqlFields = queryString.substring(
        queryString.indexOfIgnoreCase('select') + 7,
        queryString.indexOfIgnoreCase(' from ')
      )
      .trim();
    List<String> fieldNames = soqlFields.split('[,]{1}[\\s]*');
    List<Map<String, Object>> tableColumns = new List<Map<String, Object>>();
    SObject sampleRow = rows.isEmpty() ? null : rows[0];

    for (String fieldName : fieldNames) {
      Map<String, Object> col = new Map<String, Object>();
      col.put('fieldName', fieldName);
      col.put('label', buildLabel(fieldName));
      col.put('type', inferType(sampleRow, fieldName));
      tableColumns.add(col);
    }
    return tableColumns;
  }

  // ── Utilities (self-contained for extraction) ────────────────

  @TestVisible
  private static String buildLabel(String fieldApiName) {
    if (String.isBlank(fieldApiName)) {
      return '';
    }
    String label = fieldApiName;
    if (label.endsWithIgnoreCase('__c')) {
      label = label.removeEndIgnoreCase('__c');
    } else if (label.endsWithIgnoreCase('__dll')) {
      label = label.removeEndIgnoreCase('__dll');
    } else if (label.endsWithIgnoreCase('__dlm')) {
      label = label.removeEndIgnoreCase('__dlm');
    }
    if (label.contains('__')) {
      label = label.substringAfter('__');
    }
    label = label.replace('_', ' ').trim();
    List<String> words = label.split(' ');
    List<String> titled = new List<String>();
    for (String word : words) {
      if (String.isNotBlank(word)) {
        titled.add(word.substring(0, 1).toUpperCase() + word.substring(1).toLowerCase());
      }
    }
    return String.join(titled, ' ');
  }

  @TestVisible
  private static String inferType(SObject sampleRow, String fieldName) {
    if (sampleRow == null) {
      return 'text';
    }
    Object value;
    try {
      value = sampleRow.get(fieldName);
    } catch (Exception e) {
      return 'text';
    }
    if (value == null) {
      return 'text';
    }
    if (value instanceof Boolean) {
      return 'boolean';
    }
    if (value instanceof Decimal || value instanceof Double || value instanceof Integer || value instanceof Long) {
      return 'number';
    }
    if (value instanceof Date) {
      return 'date-local';
    }
    if (value instanceof Datetime) {
      return 'date';
    }
    return 'text';
  }

  // ── Context Record Lookups (Live Preview) ──────────────────

  @AuraEnabled(cacheable=true)
  public static List<Map<String, String>> getSearchableObjects(String searchTerm) {
    String likeClause = String.isBlank(searchTerm) ? '%' : '%' + String.escapeSingleQuotes(searchTerm.trim()) + '%';
    List<Map<String, String>> results = new List<Map<String, String>>();
    for (EntityDefinition ed : [
      SELECT QualifiedApiName, Label
      FROM EntityDefinition
      WHERE Label LIKE :likeClause AND IsQueryable = true
      ORDER BY Label ASC
      LIMIT 25
    ]) {
      String api = ed.QualifiedApiName;
      if (api.endsWith('__dll') || api.endsWith('__dlm')) {
        continue;
      }
      results.add(new Map<String, String>{ 'apiName' => api, 'label' => ed.Label });
      if (results.size() >= 20) {
        break;
      }
    }
    return results;
  }

  @AuraEnabled
  public static Map<String, Object> getRecordFieldValues(String objectApiName, String recordId, List<String> fieldNames) {
    if (String.isBlank(objectApiName) || String.isBlank(recordId) || fieldNames == null || fieldNames.isEmpty()) {
      return new Map<String, Object>();
    }
    // Validate and sanitize field names
    List<String> safeFields = new List<String>();
    Pattern fieldPattern = Pattern.compile('^[a-zA-Z][a-zA-Z0-9_]*(__[a-zA-Z0-9]+)?$');
    for (String fn : fieldNames) {
      if (String.isNotBlank(fn) && fieldPattern.matcher(fn.trim()).matches()) {
        safeFields.add(String.escapeSingleQuotes(fn.trim()));
      }
    }
    if (safeFields.isEmpty()) {
      return new Map<String, Object>();
    }
    String fieldList = String.join(safeFields, ', ');
    String safeObject = String.escapeSingleQuotes(objectApiName.trim());
    String safeRecordId = String.escapeSingleQuotes(recordId.trim());
    String query = 'SELECT ' + fieldList + ' FROM ' + safeObject + ' WHERE Id = \'' + safeRecordId + '\' LIMIT 1';

    List<SObject> rows;
    try {
      rows = Database.query(query);
    } catch (Exception e) {
      throw new Data360ConfigServiceException('Failed to query record fields: ' + e.getMessage());
    }
    if (rows.isEmpty()) {
      return new Map<String, Object>();
    }
    Map<String, Object> result = new Map<String, Object>();
    Map<String, Object> populated = rows[0].getPopulatedFieldsAsMap();
    for (String fn : safeFields) {
      if (populated.containsKey(fn)) {
        result.put(fn, populated.get(fn));
      } else {
        result.put(fn, null);
      }
    }
    return result;
  }

  private class Data360ConfigServiceException extends Exception {}
}
