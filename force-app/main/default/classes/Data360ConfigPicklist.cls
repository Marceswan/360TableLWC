public class Data360ConfigPicklist extends VisualEditor.DynamicPickList {

  public override VisualEditor.DataRow getDefaultValue() {
    return new VisualEditor.DataRow('-- None --', '');
  }

  public override VisualEditor.DynamicPickListRows getValues() {
    VisualEditor.DynamicPickListRows rows = new VisualEditor.DynamicPickListRows();
    rows.addRow(new VisualEditor.DataRow('-- None --', ''));
    for (Data_360_Table_Config__c config : [
      SELECT Name FROM Data_360_Table_Config__c ORDER BY Name ASC
    ]) {
      rows.addRow(new VisualEditor.DataRow(config.Name, config.Name));
    }
    return rows;
  }
}
