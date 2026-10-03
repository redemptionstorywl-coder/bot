import { describe, expect, it } from 'vitest';
import { renderObject, renderTemplate } from '../../src/utils/variables';

const user = { id: '1', username: 'Player', displayName: 'Player', discriminator: '0', createdTimestamp: 0, displayAvatarURL: () => 'http://a' } as never;

describe('renderTemplate', () => {
  it('remplace les variables connues et laisse les inconnues', () => {
    const out = renderTemplate('Bienvenue {user} sur {server} ({memberCount}) {unknown}', { user, guild: { name: 'RS', memberCount: 42 } as never });
    expect(out).toBe('Bienvenue <@1> sur RS (42) {unknown}');
  });
  it('rend récursivement un objet', () => {
    const out = renderObject({ title: '{server}', fields: [{ name: '{username}', value: 'x' }] }, { guild: { name: 'RS', memberCount: 1 } as never, user });
    expect(out.title).toBe('RS');
    expect(out.fields[0]!.name).toBe('Player');
  });
});
