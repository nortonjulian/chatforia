export const INTERFACE_FONT_SIZES = { sm: '87.5%', md: '100%', lg: '112.5%', xl: '125%' };

// Root-relative text, including Mantine's rem sizes, follows the account preference.
// Percentages retain the user's browser default font size rather than fixing pixels.
export function applyInterfaceFont(value, root = globalThis.document?.documentElement) {
  const size = Object.hasOwn(INTERFACE_FONT_SIZES, value) ? value : 'md';
  if (root) {
    root.setAttribute('data-a11y-ui-font', size);
    root.style.fontSize = INTERFACE_FONT_SIZES[size];
  }
  return size;
}
