export default function SidebarBrandMark({
  logo,
  isCustomLogo,
  className = "",
  style = {},
}) {
  if (isCustomLogo) {
    return (
      <img src={logo} alt="Logo" className={className} style={style} />
    );
  }

  return (
    <span
      className={`text-theme-text-primary font-semibold tracking-tight ${className}`}
      style={style}
    >
      DocCursor
    </span>
  );
}
