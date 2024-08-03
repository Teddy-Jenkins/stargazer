import StargazerActorBase from "./base-actor.mjs";

export default class StargazerNPC extends StargazerActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.hits = new fields.SchemaField({
      value: new fields.StringField({ required: true, blank: true }),
      max: new fields.StringField({ required: true, blank: true })
    });
    schema.morale = new fields.SchemaField({
      value: new fields.StringField({ required: true, blank: true }),
      max: new fields.StringField({ required: true, blank: true })
    });
    
    return schema
  }

  prepareDerivedData() {
    this.xp = this.cr * this.cr * 100;
  }
}