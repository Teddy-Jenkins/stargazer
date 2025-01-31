/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class StargazerActorSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["stargazer", "sheet", "actor", "character"],
      width: 700,
      height: 800,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "features", }]
    });
  }

  /** @override */
  get template() {
    return `systems/stargazer/templates/actor/actor-${this.actor.type}-sheet.hbs`;
  }
  /* -------------------------------------------- */

  
  
  /** @override */
  async getData() {
    // Use a safe clone of the actor data for further operations.
    const context = super.getData();
    const prototypeToken = {};

    // Use a safe clone of the actor data for further operations.
    const actorData = this.document.toPlainObject(false);

    // Add the actor's data to context.data for easier access, as well as flags.
    context.system = actorData.system;
    context.flags = actorData.flags;
    context.config = CONFIG.STARGAZER;

    // Prepare character data and items.
    if (actorData.type == 'character') {
      // Ensure prototype tokens are linked by default
    if (this.actor.prototypeToken.actorLink !== true) {
      await this.actor.update({ "prototypeToken.actorLink": true });
    }
      this._prepareItems(context);
      this._prepareCharacterData(context);
    }

    // Prepare NPC data and items.
    if (actorData.type == 'npc') {
      this._prepareItems(context);
    }

    // Enrich biography info for display
    // Enrichment turns text like `[[/r 1d20]]` into buttons
    context.enrichedskillNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.skillNotes
    );
    context.enrichedcharacterNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.characterNotes
    );
    context.enrichedextraNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.extraNotes
    );
    context.enrichedwoundNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.woundNotes
    );

    // Add roll data for TinyMCE editors.
    context.rollData = context.actor.getRollData();

    context.actionPoint = Array.from(document.getElementsByClassName("action-number"));

    context.system.enrichedHTML = await TextEditor.enrichHTML(
      context.system.description
    );
    
    // Retrieve saved active action point index
    const activeIndex = this.actor.getFlag("stargazer", "activeActionPoint") || 0;
    context.activeActionPoint = activeIndex;
    
    return context;
  }
  
  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} actorData The actor to prepare.
   *
   * @return {undefined}
   */
  _prepareItems(context) {

    // Initialize containers.
    const gear = [];
    const features = [];
    const weapons = [];
    const assets = [];

    // Iterate through items, allocating to containers
    // let totalWeight = 0;
    for (let i of context.items) {
      i.img = i.img || DEFAULT_TOKEN;
      // Append to gear.
      if (i.type === 'item') {
        gear.push(i);
      }
      // Append to features.
      else if (i.type === 'feature') {
        features.push(i);
      }
      // Append to weapons.
      else if (i.type === 'weapon') {
        weapons.push(i);
      }
      // Append to assets.
      else if (i.type === 'asset') {
        assets.push(i);
      }
    }

    // Assign and return
    context.gear = gear;
    context.features = features;
    context.weapons = weapons;
    context.assets = assets;
  }

  _prepareCharacterData(context) {
    // Handle ability scores.
    
  }
  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Render the item sheet for viewing/editing prior to the editable check.
    html.on('click', '.item-edit', (ev) => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data('itemId'));
      item.sheet.render(true);
    });

    // -------------------------------------------------------------
    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Add Inventory Item
    html.on('click', '.item-create', this._onItemCreate.bind(this));

    // Delete Inventory Item
    html.on('click', '.item-delete', (ev) => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data('itemId'));
      item.delete();
      li.slideUp(200, () => this.render(false));
    });

    // Active Effect management
    html.on('click', '.effect-control', (ev) => {
      const row = ev.currentTarget.closest('li');
      const document =
        row.dataset.parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(row.dataset.parentId);
      onManageActiveEffect(ev, document);
    });

    // Rollable abilities.
    html.on('click', '.rollable', this._onRoll.bind(this));

    // Drag events for macros.
    if (this.actor.isOwner) {
      let handler = (ev) => this._onDragStart(ev);
      html.find('li.item').each((i, li) => {
        if (li.classList.contains('inventory-header')) return;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', handler, false);
      });
    }
    
      // Retrieve saved index
    const activeIndex = this.actor.getFlag("stargazer", "activeActionPoint") || 0;

    // Find all action-number elements
    const actionPoints = html.find(".action-number");

    if (actionPoints.length > 0 && activeIndex < actionPoints.length) {
      actionPoints.removeClass("active"); // Remove all active classes
      actionPoints.eq(activeIndex).addClass("active"); // Add active to saved index
    }

    // Attach click event
    html.on("click", ".action-number", (event) => this._onAction(event));
    
  }

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
   async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    // Get the type of item to create.
    const type = header.dataset.type;
    // Grab any data associated with this control.
    const data = duplicate(header.dataset);
    // Initialize a default name.
    const name = `New ${type.capitalize()}`;
    // Prepare the item object.
    const itemData = {
      name: name,
      type: type,
      system: data,
    };
    // Remove the type from the dataset since it's in the itemData.type prop.
    delete itemData.system['type'];

    // Finally, create the item!
    return await Item.create(itemData, { parent: this.actor });
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */

   async _onDeleteItem(event) {
    event.preventDefault();

    const itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);

    await item.delete();
  }

  // new Dialog({
  //   title: "My Dialog Title",
  //   content: myContent,
  //   buttons: {
  //     Roll: {
  //       label: "Roll",
  //       callback: () => {this._onRoll(event)},
  //       icon: `<i class="fas fa-check"></i>`
  //     }
  //   }
  // }).render(true);
  // }
    
  //   async _onRoll(event, edges, drawbacks) {
  //     event.preventDefault();
  //     const element = event.currentTarget;
  //     const dataset = element.dataset;
  
  //     // Handle item rolls.
  //     if (dataset.rollType) {
  //       if (dataset.rollType == 'item') {
  //         const itemId = element.closest('.item').dataset.itemId;
  //         const item = this.actor.items.get(itemId);
  //         if (item) return item.roll();
  //       }
  //     }
  
  //     if (dataset.roll) {
  //       let label = dataset.label ? `Roll: ${dataset.label}` : '';
  //       let roll = new Roll(dataset.roll, this.actor.getRollData());
  //       roll.toMessage({
  //         speaker: ChatMessage.getSpeaker({ actor: this.actor }),
  //         flavor: label,
  //         rollMode: game.settings.get('core', 'rollMode'),
  //       });
  //       return roll;
        
  //     }
  //   }

_onRoll(event) {
  event.preventDefault();
  const element = event.currentTarget;
  const dataset = element.dataset;

  // Handle item rolls.
  if (dataset.rollType) {
    if (dataset.rollType == 'item') {
      const itemId = element.closest('.item').dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) return item.roll();
    }
  }

  // Handle rolls that supply the formula directly.
  if (dataset.roll) {
    let label = dataset.label ? `${dataset.score} ${dataset.label}` : '';
    let roll = new Roll(dataset.roll, this.actor.getRollData());
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: label,
      rollMode: game.settings.get('core', 'rollMode'),
    });
    return roll;
  }
}

async _onAction(event) {
  event.preventDefault();
  
  const point = event.currentTarget;
  const allPoints = Array.from(point.parentNode.children);

  // Remove "active" class from all action points
  allPoints.forEach((p) => p.classList.remove("active"));

  // Add "active" class to the clicked one
  point.classList.add("active");

  // Get the index of the selected action point
  const index = allPoints.indexOf(point);
  console.log("Saving active action point index:", index);

  // Save to actor's flags
  await this.actor.setFlag("stargazer", "activeActionPoint", index);
}
// var actionPoint = Array.from(document.getElementsByClassName("action-number"));

//         for(let i = 0; i < actionPoint.length; i++){
//           actionPoint[i].classList.remove("active");
//           actionPoint[i].addEventListener("click", function (){
//             if (!actionPoint[i].classList.contains("active")){
//               for(let x = 0; x < actionPoint.length; x++){
//                 actionPoint[x].classList.remove("active");
//               }
//               this.classList.add("active");
//               console.log("listening");
//             }
            
//           });
//         }

}
