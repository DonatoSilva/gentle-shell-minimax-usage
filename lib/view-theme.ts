// Semantic paint slots shared by the Pi views.
//
// The views never import a theme library: they ask for semantic slots and the
// caller (the extension) maps them onto the active Pi theme. That keeps the
// renderers pure and testable, and it keeps the published package free of
// runtime dependencies.

export interface ViewTheme {
  title(text: string): string;
  provider(text: string): string;
  label(text: string): string;
  value(text: string): string;
  muted(text: string): string;
  separator(text: string): string;
  accent(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  border(text: string): string;
}

/** Identity theme: every slot returns the text unchanged. */
export function plainTheme(): ViewTheme {
  const identity = (text: string): string => text;
  return {
    title: identity,
    provider: identity,
    label: identity,
    value: identity,
    muted: identity,
    separator: identity,
    accent: identity,
    warning: identity,
    error: identity,
    border: identity,
  };
}
