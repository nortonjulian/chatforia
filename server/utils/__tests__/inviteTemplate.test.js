import { createInviteTemplate } from '../../utils/inviteTemplate.js';

describe('createInviteTemplate', () => {
  test('returns HTML string with all event details interpolated', () => {
    const html = createInviteTemplate({
      eventName: 'Project Kickoff',
      eventDate: 'October 31, 2025',
      eventTime: '2:00 PM MT',
      location: 'Denver HQ / Zoom',
      hostName: 'Avery Johnson',
      joinLink: 'https://example.com/join/room-123',
    });

    // It's a string
    expect(typeof html).toBe('string');

    // Basic structure
    expect(html).toMatch(/<div[^>]*>/);
    expect(html).toMatch(/<\/div>\s*$/);

    // Header contains event name
    expect(html).toContain(`<h2>You're Invited: Project Kickoff</h2>`);

    // Date / Time / Location / Host blocks are present and labeled
    expect(html).toContain('<strong>Date:</strong> October 31, 2025');
    expect(html).toContain('<strong>Time:</strong> 2:00 PM MT');
    expect(html).toContain('<strong>Location:</strong> Denver HQ / Zoom');
    expect(html).toContain('<strong>Host:</strong> Avery Johnson');

    // Link
    expect(html).toContain(
      `<a href="https://example.com/join/room-123" style="color: #007BFF;">Join Event</a>`
    );

    // Inline styles we care about (ensures we keep the simple, readable formatting)
    expect(html).toMatch(/font-family:\s*Arial/);
    expect(html).toMatch(/line-height:\s*1\.5/);
  });

  test('handles empty strings without throwing and directly interpolates them', () => {
    const html = createInviteTemplate({
      eventName: '',
      eventDate: '',
      eventTime: '',
      location: '',
      hostName: '',
      joinLink: '',
    });

    // Should still render the template scaffolding and not crash
    expect(typeof html).toBe('string');

    // Check that we got empty fields literally in the HTML
    expect(html).toContain(`<h2>You're Invited: </h2>`);
    expect(html).toContain('<strong>Date:</strong> ');
    expect(html).toContain('<strong>Time:</strong> ');
    expect(html).toContain('<strong>Location:</strong> ');
    expect(html).toContain('<strong>Host:</strong> ');

    // href should still be present even if empty
    expect(html).toContain(`<a href="" style="color: #007BFF;">Join Event</a>`);
  });
});
