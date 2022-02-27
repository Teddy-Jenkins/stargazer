

export async function _onRoll(skill) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    // Handle item rolls.
    // if (dataset.rollType) {
    //   if (dataset.rollType == 'item') {
    //     const itemId = element.closest('.item').dataset.itemId;
    //     const item = this.actor.items.get(itemId);
    //     if (item) return item.roll();
    //   }
    // }

      const label = dataset.label ? `Rolled ${dataset.label}` : '';
      const roll = new Roll("1d10 + @skill");
    //   await roll.evaluate().toMessage({
    //     speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    //     flavor: label,
    //     rollMode: game.settings.get('core', 'rollMode'),
    //   });

        await roll.evaluate({
            async: true,
        });
      
      return roll;
    
  }