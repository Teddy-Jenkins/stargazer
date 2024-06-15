import StargazerDataModel from "./base-model.mjs";

export default class StargazerActorBase extends StargazerDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const requiredString = { required: true, nullable: false, type: String };
    const requiredBoolean = { required: true, nullable: false, type: Boolean };
    const schema = {};

    schema.attributes = new fields.SchemaField({
      Fight: new fields.SchemaField({
        score: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        corrected: new fields.BooleanField({ required: true, initial: true })
      }),
      Intrigue: new fields.SchemaField({
        score: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        corrected: new fields.BooleanField({ required: true, initial: true })
      }),
      Venture: new fields.SchemaField({
        score: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        corrected: new fields.BooleanField({ required: true, initial: true })
      })
    });

    schema.notes = new fields.SchemaField({
      extraNotes: new fields.StringField({ required: true, blank: true }),
      skillNotes: new fields.StringField({ required: true, blank: true }),
      characterNotes: new fields.StringField({ required: true, blank: true })
    });

    schema.wounds = new fields.SchemaField({
      lwValue: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      lwMax: new fields.NumberField({ ...requiredInteger, initial: 1 }),
      hwValue: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      hwMax: new fields.NumberField({ ...requiredInteger, initial: 2 })
  });

  schema.funds = new fields.NumberField({ ...requiredInteger, initial: 0 });

  schema.rests = new fields.SchemaField({
      minute: new fields.SchemaField({
          checked: new fields.BooleanField({ ...requiredBoolean, initial: false })
      }),
      hour: new fields.SchemaField({
          checked: new fields.BooleanField({ ...requiredBoolean, initial: false })
      }),
      day: new fields.SchemaField({
          checked: new fields.BooleanField({ ...requiredBoolean, initial: false })
      }),
      week: new fields.SchemaField({
          checked: new fields.BooleanField({ ...requiredBoolean, initial: false })
      })
  });

  schema.carryCap = new fields.SchemaField({
      current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      maximum: new fields.NumberField({ ...requiredInteger, initial: 7 })
  });

  schema.merits = new fields.SchemaField({
      steel: new fields.SchemaField({
          max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
          score: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      heart: new fields.SchemaField({
          max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
          score: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      finesse: new fields.SchemaField({
          max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
          score: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      wisdom: new fields.SchemaField({
          max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
          score: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      readiness: new fields.SchemaField({
          max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
          score: new fields.NumberField({ ...requiredInteger, initial: 0 })
      })
  });
    
    schema.biography = new fields.StringField({ required: true, blank: true }); // equivalent to passing ({initial: ""}) for StringFields

    return schema;
  }

}
