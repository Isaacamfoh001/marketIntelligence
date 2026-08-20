// Blocking inline script, rendered as the very first thing in <head>.
// Runs synchronously before any paint so there is no flash of the wrong
// theme. Reads an explicit user preference from localStorage if set,
// otherwise follows the OS preference — mirrors the fallback logic in
// ThemeToggle.tsx.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("korbly-theme");
    var isDark = stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
