@IsTest
private class Data360ConfigServiceTests {

  @TestSetup
  static void setup() {
    Data_360_Table_Config__c config = new Data_360_Table_Config__c(
      Name = 'Test Config',
      Description__c = 'Test description',
      Object_API_Name__c = 'Account',
      Config_JSON__c = '{"objectApiName":"Account","fields":[{"fieldName":"Name","label":"Name","visible":true}],"whereClause":"","limit":100}'
    );
    insert config;
  }

  @IsTest
  static void getConfigs_returns_all_configs() {
    Test.startTest();
    List<Data_360_Table_Config__c> configs = Data360ConfigService.getConfigs();
    Test.stopTest();

    System.assertEquals(1, configs.size());
    System.assertEquals('Test Config', configs[0].Name);
  }

  @IsTest
  static void getConfigByName_returns_matching_config() {
    Test.startTest();
    Data_360_Table_Config__c config = Data360ConfigService.getConfigByName('Test Config');
    Test.stopTest();

    System.assertNotEquals(null, config);
    System.assertEquals('Test Config', config.Name);
    System.assertEquals('Test description', config.Description__c);
  }

  @IsTest
  static void getConfigByName_returns_null_for_missing() {
    Test.startTest();
    Data_360_Table_Config__c config = Data360ConfigService.getConfigByName('Nonexistent');
    Test.stopTest();

    System.assertEquals(null, config);
  }

  @IsTest
  static void saveConfig_inserts_new_config() {
    Data_360_Table_Config__c newConfig = new Data_360_Table_Config__c(
      Name = 'New Config',
      Description__c = 'New description',
      Object_API_Name__c = 'Contact',
      Config_JSON__c = '{"objectApiName":"Contact","fields":[],"whereClause":"","limit":50}'
    );

    Test.startTest();
    Data_360_Table_Config__c result = Data360ConfigService.saveConfig(newConfig);
    Test.stopTest();

    System.assertNotEquals(null, result.Id);
    System.assertEquals('New Config', result.Name);
  }

  @IsTest
  static void saveConfig_updates_existing_config() {
    Data_360_Table_Config__c existing = [SELECT Id, Name, Description__c FROM Data_360_Table_Config__c LIMIT 1];
    existing.Description__c = 'Updated description';

    Test.startTest();
    Data_360_Table_Config__c result = Data360ConfigService.saveConfig(existing);
    Test.stopTest();

    Data_360_Table_Config__c refreshed = [SELECT Description__c FROM Data_360_Table_Config__c WHERE Id = :result.Id];
    System.assertEquals('Updated description', refreshed.Description__c);
  }

  @IsTest
  static void deleteConfig_removes_config() {
    Data_360_Table_Config__c existing = [SELECT Id FROM Data_360_Table_Config__c LIMIT 1];

    Test.startTest();
    Data360ConfigService.deleteConfig(existing.Id);
    Test.stopTest();

    List<Data_360_Table_Config__c> remaining = [SELECT Id FROM Data_360_Table_Config__c];
    System.assertEquals(0, remaining.size());
  }

  @IsTest
  static void getDataCloudObjects_returns_list() {
    Test.startTest();
    List<Map<String, String>> objects = Data360ConfigService.getDataCloudObjects();
    Test.stopTest();

    System.assertNotEquals(null, objects);
    System.debug('Data Cloud objects found: ' + objects.size());
    System.debug('Objects: ' + objects);
  }

  @IsTest
  static void getDataCloudFields_returns_fields_for_standard_object() {
    Test.startTest();
    List<Map<String, String>> fields = Data360ConfigService.getDataCloudFields('Account');
    Test.stopTest();

    System.assert(fields.size() > 0, 'Expected at least one field');
    Map<String, String> firstField = fields[0];
    System.assert(firstField.containsKey('fieldName'), 'Expected fieldName key');
    System.assert(firstField.containsKey('label'), 'Expected label key');
  }

  @IsTest
  static void executeQuery_returns_data_and_columns() {
    Account testAcc = new Account(Name = 'Query Test Account');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('SELECT Id, Name FROM Account LIMIT 5');
    Test.stopTest();

    System.assertNotEquals(null, result.get('tableData'));
    System.assertNotEquals(null, result.get('tableColumns'));
    System.assertEquals('Account', result.get('objectApiName'));
  }

  @IsTest
  static void executeQuery_throws_for_blank_query() {
    try {
      Data360ConfigService.executeQuery('');
      System.assert(false, 'Expected exception');
    } catch (Exception e) {
      System.assert(e.getMessage().contains('Missing query'), 'Expected missing query error, got: ' + e.getMessage());
    }
  }

  @IsTest
  static void getQueryExceptionMessage_returns_null_for_valid_query() {
    System.assertEquals(null, Data360ConfigService.getQueryExceptionMessage('SELECT Id FROM Account LIMIT 1'));
  }

  @IsTest
  static void getQueryExceptionMessage_returns_error_for_invalid_query() {
    String result = Data360ConfigService.getQueryExceptionMessage('SELECT FakeField FROM Account');
    System.assertNotEquals(null, result);
  }

  @IsTest
  static void buildLabel_strips_custom_field_suffix() {
    System.assertEquals('Firstname', Data360ConfigService.buildLabel('FirstName__c'));
  }

  @IsTest
  static void buildLabel_strips_dll_suffix() {
    System.assertEquals('Individual', Data360ConfigService.buildLabel('Individual__dll'));
  }

  @IsTest
  static void buildLabel_strips_dlm_suffix() {
    System.assertEquals('Account', Data360ConfigService.buildLabel('Account__dlm'));
  }

  @IsTest
  static void buildLabel_strips_namespace_prefix() {
    System.assertEquals('Firstname', Data360ConfigService.buildLabel('ssot__FirstName__c'));
  }

  @IsTest
  static void buildLabel_handles_plain_field() {
    System.assertEquals('Id', Data360ConfigService.buildLabel('Id'));
  }

  @IsTest
  static void inferType_returns_text_for_null_row() {
    System.assertEquals('text', Data360ConfigService.inferType(null, 'Name'));
  }

  @IsTest
  static void inferType_returns_number_for_numeric_value() {
    Account a = new Account(NumberOfEmployees = 100);
    System.assertEquals('number', Data360ConfigService.inferType(a, 'NumberOfEmployees'));
  }

  @IsTest
  static void inferType_returns_boolean_for_boolean_value() {
    Lead l = new Lead(LastName = 'Test', Company = 'Test', DoNotCall = false);
    System.assertEquals('boolean', Data360ConfigService.inferType(l, 'DoNotCall'));
  }

  @IsTest
  static void inferType_returns_date_for_date_value() {
    Opportunity opp = new Opportunity(Name = 'Test', CloseDate = Date.today(), StageName = 'Prospecting');
    System.assertEquals('date-local', Data360ConfigService.inferType(opp, 'CloseDate'));
  }

  @IsTest
  static void inferType_returns_date_for_datetime_value() {
    Account a = new Account(Name = 'Test');
    insert a;
    a = [SELECT Id, CreatedDate FROM Account WHERE Id = :a.Id];
    System.assertEquals('date', Data360ConfigService.inferType(a, 'CreatedDate'));
  }

  @IsTest
  static void inferType_returns_text_for_null_value() {
    Account a = new Account(Name = null);
    System.assertEquals('text', Data360ConfigService.inferType(a, 'Name'));
  }

  @IsTest
  static void inferType_returns_text_for_invalid_field() {
    Account a = new Account(Name = 'Test');
    System.assertEquals('text', Data360ConfigService.inferType(a, 'NonExistentField'));
  }

  @IsTest
  static void executeQuery_adds_limit_when_missing() {
    Account testAcc = new Account(Name = 'Test Account');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('SELECT Id, Name FROM Account');
    Test.stopTest();

    System.assertNotEquals(null, result.get('tableData'));
    List<SObject> data = (List<SObject>) result.get('tableData');
    System.assert(data.size() <= 500, 'Expected LIMIT 500 to be applied');
  }

  @IsTest
  static void executeQuery_handles_invalid_query() {
    try {
      Data360ConfigService.executeQuery('SELECT InvalidField FROM Account');
      System.assert(false, 'Expected exception');
    } catch (Exception e) {
      System.assert(e.getMessage().contains('Invalid'), 'Expected invalid field error');
    }
  }

  @IsTest
  static void executeQuery_builds_columns_from_empty_result() {
    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('SELECT Id, Name FROM Account WHERE Name = \'NonExistentRecordName123456\'');
    Test.stopTest();

    List<Map<String, Object>> columns = (List<Map<String, Object>>) result.get('tableColumns');
    System.assertEquals(2, columns.size(), 'Expected 2 columns even with empty results');
  }

  @IsTest
  static void buildLabel_handles_multiple_words() {
    System.assertEquals('First Name Last', Data360ConfigService.buildLabel('first_name_last'));
  }

  @IsTest
  static void buildLabel_handles_blank_word() {
    System.assertEquals('Last', Data360ConfigService.buildLabel('first__last'));
  }

  @IsTest
  static void inferType_returns_number_for_decimal() {
    Opportunity opp = new Opportunity(Name = 'Test', Amount = 1000.50, CloseDate = Date.today(), StageName = 'Prospecting');
    System.assertEquals('number', Data360ConfigService.inferType(opp, 'Amount'));
  }

  @IsTest
  static void executeQuery_extracts_object_name() {
    Account testAcc = new Account(Name = 'Test');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('SELECT Id FROM Account WHERE Name = \'Test\'');
    Test.stopTest();

    System.assertEquals('Account', result.get('objectApiName'));
  }

  @IsTest
  static void buildLabel_handles_mixed_case() {
    System.assertEquals('First Name', Data360ConfigService.buildLabel('FIRST_NAME'));
  }

  @IsTest
  static void buildLabel_handles_single_word() {
    System.assertEquals('Name', Data360ConfigService.buildLabel('name'));
  }

  @IsTest
  static void getDataCloudFields_handles_entity_with_fields() {
    Test.startTest();
    List<Map<String, String>> fields = Data360ConfigService.getDataCloudFields('Contact');
    Test.stopTest();

    System.assertNotEquals(null, fields);
  }

  @IsTest
  static void executeQuery_handles_complex_query() {
    Account testAcc = new Account(Name = 'Complex Query Test', Industry = 'Technology');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery(
      'SELECT Id, Name, Industry FROM Account WHERE Industry = \'Technology\' LIMIT 10'
    );
    Test.stopTest();

    List<Map<String, Object>> columns = (List<Map<String, Object>>) result.get('tableColumns');
    System.assertEquals(3, columns.size(), 'Expected 3 columns');
  }

  @IsTest
  static void buildLabel_handles_underscores_and_capitalization() {
    String result = Data360ConfigService.buildLabel('FIRST_MIDDLE_LAST__c');
    System.assertEquals('First Middle Last', result);
  }

  @IsTest
  static void executeQuery_parses_fields_from_soql() {
    Account testAcc = new Account(Name = 'Parse Test');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('SELECT Id, Name FROM Account LIMIT 1');
    Test.stopTest();

    List<Map<String, Object>> columns = (List<Map<String, Object>>) result.get('tableColumns');
    System.assertEquals(2, columns.size());
  }

  @IsTest
  static void inferType_returns_text_for_string_value() {
    Account a = new Account(Name = 'Test Account');
    System.assertEquals('text', Data360ConfigService.inferType(a, 'Name'));
  }

  @IsTest
  static void executeQuery_handles_whitespace_in_soql() {
    Account testAcc = new Account(Name = 'Whitespace Test');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('  SELECT Id FROM Account  ');
    Test.stopTest();

    System.assertNotEquals(null, result.get('tableData'));
  }

  @IsTest
  static void getDataCloudFields_fallback_to_probe_for_unsupported_object() {
    try {
      Test.startTest();
      List<Map<String, String>> fields = Data360ConfigService.getDataCloudFields('InvalidObject__dll');
      Test.stopTest();
      System.assert(false, 'Expected exception for invalid object');
    } catch (Exception e) {
      System.assert(e.getMessage().contains('Unable to discover fields'), 'Expected field discovery error');
    }
  }

  @IsTest
  static void getDataCloudObjects_handles_no_data_cloud_objects() {
    Test.startTest();
    List<Map<String, String>> objects = Data360ConfigService.getDataCloudObjects();
    Test.stopTest();

    System.assertNotEquals(null, objects);
  }

  @IsTest
  static void executeQuery_handles_multiple_fields() {
    Account testAcc1 = new Account(Name = 'Multi Field Test 1', Industry = 'Technology');
    Account testAcc2 = new Account(Name = 'Multi Field Test 2', Industry = 'Finance');
    insert new List<Account>{testAcc1, testAcc2};

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('SELECT Id, Name, Industry, CreatedDate FROM Account');
    Test.stopTest();

    List<Map<String, Object>> columns = (List<Map<String, Object>>) result.get('tableColumns');
    System.assertEquals(4, columns.size(), 'Expected 4 columns');
  }

  @IsTest
  static void executeQuery_with_explicit_limit() {
    Account testAcc = new Account(Name = 'Limit Test');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery('SELECT Id FROM Account LIMIT 1');
    Test.stopTest();

    List<SObject> data = (List<SObject>) result.get('tableData');
    System.assert(data.size() <= 1, 'Expected at most 1 record');
  }

  @IsTest
  static void buildLabel_handles_consecutive_underscores() {
    System.assertEquals('Name', Data360ConfigService.buildLabel('___name___'));
  }

  @IsTest
  static void inferType_handles_empty_account() {
    Account a = new Account();
    System.assertEquals('text', Data360ConfigService.inferType(a, 'Name'));
  }

  @IsTest
  static void executeQuery_extracts_object_name_with_where_clause() {
    Account testAcc = new Account(Name = 'Where Test');
    insert testAcc;

    Test.startTest();
    Map<String, Object> result = Data360ConfigService.executeQuery(
      'SELECT Id FROM Account WHERE Name != null LIMIT 1'
    );
    Test.stopTest();

    System.assertEquals('Account', result.get('objectApiName'));
  }

  @IsTest
  static void buildLabel_handles_all_caps_with_suffix() {
    System.assertEquals('Field Name', Data360ConfigService.buildLabel('FIELD_NAME__c'));
  }

  @IsTest
  static void buildLabel_handles_null_input() {
    System.assertEquals('', Data360ConfigService.buildLabel(null));
  }

  @IsTest
  static void getFieldsViaProbeQuery_throws_exception_for_invalid_object() {
    try {
      Test.startTest();
      List<Map<String, String>> fields = Data360ConfigService.getFieldsViaProbeQuery('NonExistentObject__dll');
      Test.stopTest();
      System.assert(false, 'Expected exception for invalid object');
    } catch (Exception e) {
      System.assert(e.getMessage().contains('Unable to discover fields'), 'Expected field discovery error: ' + e.getMessage());
    }
  }

  @IsTest
  static void getDataCloudFields_with_blank_object_name_returns_empty_list() {
    Test.startTest();
    List<Map<String, String>> fields = Data360ConfigService.getDataCloudFields('');
    Test.stopTest();

    System.assertEquals(0, fields.size(), 'Expected empty list for blank object name');
  }

  @IsTest
  static void getFieldsViaFieldDefinition_handles_exception_gracefully() {
    Test.startTest();
    List<Map<String, String>> fields = Data360ConfigService.getFieldsViaFieldDefinition(null);
    Test.stopTest();

    System.assertEquals(0, fields.size(), 'Expected empty list when FieldDefinition query fails');
  }

  @IsTest
  static void getFieldsViaProbeQuery_validates_object_api_name() {
    try {
      Test.startTest();
      Data360ConfigService.getFieldsViaProbeQuery('');
      Test.stopTest();
      System.assert(false, 'Expected exception for blank object name');
    } catch (Exception e) {
      System.assert(e.getMessage().contains('Object API name is required'), 'Expected validation error');
    }
  }

  @IsTest
  static void buildLabel_handles_empty_string() {
    System.assertEquals('', Data360ConfigService.buildLabel(''));
  }

  // ── Picklist Tests ────────────────────────────────────────────

  @IsTest
  static void picklist_getDefaultValue_returns_none() {
    Data360ConfigPicklist picklist = new Data360ConfigPicklist();

    Test.startTest();
    VisualEditor.DataRow defaultRow = picklist.getDefaultValue();
    Test.stopTest();

    System.assertEquals('-- None --', defaultRow.getLabel());
    System.assertEquals('', defaultRow.getValue());
  }

  @IsTest
  static void picklist_getValues_includes_saved_configs() {
    Data360ConfigPicklist picklist = new Data360ConfigPicklist();

    Test.startTest();
    VisualEditor.DynamicPickListRows rows = picklist.getValues();
    Test.stopTest();

    // At least "-- None --" + the test config from @TestSetup
    System.assert(rows.size() >= 2, 'Expected at least 2 rows, got: ' + rows.size());
  }
}
