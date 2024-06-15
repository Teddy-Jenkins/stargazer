import StargazerDataModel from "./base-model.mjs";

export default class StargazerItemBase extends StargazerDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = {};

    schema.description = new fields.StringField({ required: true, blank: true });

    return schema;
  }

}