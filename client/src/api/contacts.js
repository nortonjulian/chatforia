import axios from './axiosClient';

export async function importContacts({ contacts }) {
  // The shared endpoint accepts one phone contact per item, not preview rows.
  const items = (Array.isArray(contacts) ? contacts : []).flatMap(contact =>
    (Array.isArray(contact?.phones) ? contact.phones : [])
      .filter(phone => typeof phone === 'string' && phone.trim())
      .map(phone => ({
        externalPhone: phone.trim(),
        externalName: typeof contact.name === 'string' ? contact.name.trim() : '',
      }))
  );
  if (!items.length) {
    throw new Error('Select a contact with a phone number. Email-only contacts cannot be imported here.');
  }
  const { data } = await axios.post('/contacts/import', { items });
  if (data?.ok !== true || !Number.isInteger(data.importedCount) || data.importedCount < 0 ||
      !Array.isArray(data.items) || data.items.length !== data.importedCount) {
    throw new Error('The server did not confirm the import. Check People before trying again.');
  }
  return data;
}
