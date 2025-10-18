import "./Footer.css";
import { FOOTER_SECTIONS, SOCIALS, COPYRIGHT_TEXT } from "../../config/footerLinks";
import { Group, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import LogoGlyph from "@/components/LogoGlyph";

// Compact inline SVGs for icons
const icons = {
  tiktok: (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M21 8.5c-2.6 0-5.1-1.1-6.8-3v9.1c0 3.4-2.8 6.2-6.2 6.2S1.8 18 1.8 14.6c0-3.3 2.7-6 6-6 .3 0 .5 0 .8.1v3.5c-.3-.1-.5-.1-.8-.1-1.5 0-2.7 1.2-2.7 2.7S6.3 17.5 7.8 17.5s2.7-1.2 2.7-2.7V2h3.4c1.3 2.1 3.6 3.5 6.1 3.6V8.5z" />
    </svg>
  ),
  instagram: (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm10 2H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm-5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5zM17.75 6a1.25 1.25 0 1 1-1.25 1.25A1.25 1.25 0 0 1 17.75 6z"/>
    </svg>
  ),
  facebook: (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M13 22v-8h3l.5-4H13V8.1c0-1.1.3-1.8 1.9-1.8H17V2.2C16.3 2.1 15.1 2 13.7 2 10.9 2 9 3.7 9 7v3H6v4h3v8h4z"/>
    </svg>
  ),
  linkedin: (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8h4V23h-4V8zM8 8h3.8v2.1h.1c.5-.9 1.8-2.1 3.7-2.1 4 0 4.7 2.6 4.7 6V23h-4v-5.5c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V23H8V8z"/>
    </svg>
  ),
  x: (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M18 2h3l-7.5 8.6L22 22h-6.8l-4.3-6.3L6 22H3.1l8.1-9.3L2 2h6.8l3.9 5.6L18 2z"/>
    </svg>
  ),
};

export default function Footer() {
  const isInternal = (href) => typeof href === "string" && href.startsWith("/");

  return (
    <footer className="cf-footer">
      <nav className="cf-footer__nav" aria-label="Footer">
        {/* Top row: brand + socials */}
        <div className="cf-footer__top">
          <div className="cf-footer__brand">
            <Link to="/" aria-label="Chatforia home" className="cf-footer__brandlink">
              <Group
                gap="xs"
                align="center"
                wrap="nowrap"
                className="brand-lockup footer-lockup"
                style={{ "--logo-size": "28px" }}
              >
                <span className="brand-logo" aria-hidden="true">
                  <LogoGlyph size={28} />
                </span>
                <Text fw={800} size="lg" className="brand-lockup__name">
                  Chatforia
                </Text>
              </Group>
            </Link>
          </div>

          <div className="cf-footer__social">
            {SOCIALS.map((s) => {
              const Icon = icons[s.icon];
              if (!Icon) return null;
              return (
                <a key={s.name} href={s.href} target="_blank" rel="noreferrer" aria-label={s.name}>
                  <Icon />
                </a>
              );
            })}
          </div>
        </div>

        {/* Columns */}
        <div className="cf-footer__cols">
          {FOOTER_SECTIONS.map((section) => (
            <div className="cf-footer__col" key={section.title}>
              <h3>{section.title}</h3>
              <ul>
                {section.links.map((link) => (
                  <li key={link.label}>
                    {isInternal(link.href) ? (
                      <Link to={link.href} className="cf-footer__link">
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        className="cf-footer__link"
                        href={link.href}
                        target={link.external ? "_blank" : undefined}
                        rel={link.external ? "noreferrer" : undefined}
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="cf-footer__bottom">
          <p>
            {COPYRIGHT_TEXT}
            {" · "}
            <span>Patent pending</span>
          </p>
          <a href="#top" className="cf-footer__toplink">
            ↑ Back to top
          </a>
        </div>
      </nav>
    </footer>
  );
}
