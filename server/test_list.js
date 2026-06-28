const b = require('@whiskeysockets/baileys');
const msg = b.proto.Message.fromObject({
  listMessage: {
    title: 'Pick an option',
    description: 'Tap below',
    buttonText: 'View',
    listType: 1,
    sections: [{
      title: 'Menu',
      rows: [{ title: 'Pizza', rowId: 'pizza', description: 'Cheesy' }]
    }]
  }
});
const lm = msg.listMessage;
console.log('title:', lm.title);
console.log('buttonText:', lm.buttonText);
console.log('listType:', lm.listType);
console.log('sections:', lm.sections?.length);
console.log('rows:', lm.sections?.[0]?.rows?.length);
console.log('row title:', lm.sections?.[0]?.rows?.[0]?.title);
console.log('row id:', lm.sections?.[0]?.rows?.[0]?.rowId);

const full = b.generateWAMessageFromContent('test@s.whatsapp.net', msg, { userJid: 'me@s.whatsapp.net' });
console.log('fullMsg key:', full.key?.id);
console.log('message keys:', Object.keys(full.message));
console.log('has listMessage:', !!full.message.listMessage);
console.log('listMessage title:', full.message.listMessage?.title);
console.log('listMessage buttonText:', full.message.listMessage?.buttonText);
console.log('listMessage listType:', full.message.listMessage?.listType);
console.log('sections:', full.message.listMessage?.sections?.length);
console.log('row title:', full.message.listMessage?.sections?.[0]?.rows?.[0]?.title);
