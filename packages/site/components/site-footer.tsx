export function SiteFooter() {
  return (
    <footer>
      <div className="footer-brand">
        <span className="footer-brand-name">Glove</span>
        <span className="footer-tagline">Agentic runtime for applications.</span>
      </div>
      <div className="footer-right">
        <span>A product by</span>
        <a
          href="https://dterminal.net"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}
        >
          dterminal
        </a>
        <span>&copy; 2026</span>
      </div>
    </footer>
  );
}
