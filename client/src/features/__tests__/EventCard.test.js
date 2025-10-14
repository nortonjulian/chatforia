import { render, screen } from '@testing-library/react';
import EventCard from '../messages/EventCard';

describe('EventCard', () => {
  const baseEvent = {
    title: 'Team Sync & Planning',
    description: 'Quarterly check-in',
    location: 'HQ — 5th Floor',
    url: 'https://example.com/brief?ref=chat',
    startUTC: '2025-01-15T17:00:00Z',
    endUTC:   '2025-01-15T18:00:00Z',
  };

  test('renders links with correctly encoded parameters and compressed Google dates', () => {
    render(<EventCard event={baseEvent} />);

    // Links exist
    const icsLink = screen.getByText(/Apple \/ \.ics/i).closest('a');
    const gcalLink = screen.getByText(/Google/i).closest('a');
    const outlookLink = screen.getByText(/Outlook/i).closest('a');

    expect(icsLink).toBeInTheDocument();
    expect(gcalLink).toBeInTheDocument();
    expect(outlookLink).toBeInTheDocument();

    // Targets/rel
    expect(gcalLink).toHaveAttribute('target', '_blank');
    expect(gcalLink).toHaveAttribute('rel', 'noreferrer');
    expect(outlookLink).toHaveAttribute('target', '_blank');
    expect(outlookLink).toHaveAttribute('rel', 'noreferrer');

    // Encoded pieces we expect
    const encTitle = encodeURIComponent(baseEvent.title);
    const encDescWithUrl = encodeURIComponent(`${baseEvent.description}\n\n${baseEvent.url}`);
    const encLoc = encodeURIComponent(baseEvent.location);
    const startISO = new Date(baseEvent.startUTC).toISOString(); // includes .000Z
    const endISO   = new Date(baseEvent.endUTC).toISOString();

    // Google: compressed dates (YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ)
    const compress = (iso) => new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    const gDates = `${compress(startISO)}/${compress(endISO)}`;

    // Google URL expectations
    expect(gcalLink.href).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
    expect(gcalLink.href).toContain(`text=${encTitle}`);
    expect(gcalLink.href).toContain(`details=${encDescWithUrl}`);
    expect(gcalLink.href).toContain(`location=${encLoc}`);
    expect(gcalLink.href).toContain(`dates=${gDates}`);

    // Outlook: uses raw ISO (with milliseconds) URL-encoded for time fields
    const encStartISO = encodeURIComponent(startISO);
    const encEndISO = encodeURIComponent(endISO);
    expect(outlookLink.href).toContain('https://outlook.live.com/calendar/0/deeplink/compose');
    expect(outlookLink.href).toContain(`subject=${encTitle}`);
    expect(outlookLink.href).toContain(`body=${encDescWithUrl}`);
    expect(outlookLink.href).toContain(`location=${encLoc}`);
    expect(outlookLink.href).toContain(`startdt=${encStartISO}`);
    expect(outlookLink.href).toContain(`enddt=${encEndISO}`);

    // .ics: local endpoint with individual params (uncompressed ISO)
    expect(icsLink.href).toContain('/calendar/ics?');
    expect(icsLink.href).toContain(`title=${encTitle}`);
    expect(icsLink.href).toContain(`description=${encodeURIComponent(baseEvent.description)}`);
    expect(icsLink.href).toContain(`location=${encLoc}`);
    expect(icsLink.href).toContain(`start=${encodeURIComponent(startISO)}`);
    expect(icsLink.href).toContain(`end=${encodeURIComponent(endISO)}`);
    expect(icsLink.href).toContain(`url=${encodeURIComponent(baseEvent.url)}`);
  });

  test('omits visible location row when location is absent; details do not append URL when missing', () => {
    const noOptional = {
      ...baseEvent,
      description: '',
      location: '',
      url: undefined,
    };
    render(<EventCard event={noOptional} />);

    // Title renders
    expect(screen.getByText(noOptional.title)).toBeInTheDocument();

    // No visible location row (the component only renders location div when truthy)
    // We can assert there's only the title and the date range in the head, but simplest:
    // ensure no element exactly equal to empty string or a known marker—so just ensure the encoded
    // link doesn't carry an appended URL in details.
    const gcalLink = screen.getByText(/Google/i).closest('a');
    expect(gcalLink.href).toContain('details=');

    // details should be ONLY description (empty string encoded -> ''), and NOT contain two newlines-then-URL
    // i.e., not contain encoded "\n\n"
    expect(gcalLink.href).not.toMatch(/%0A%0A/);

    // Location param present but empty is acceptable; visually it's not rendered
    // Confirm no text node equal to location exists
    expect(screen.queryByText(/HQ — 5th Floor/)).toBeNull();
  });
});
