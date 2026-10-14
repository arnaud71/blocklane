/** Identité provisoire, à valider avec la HEG avant une communication officielle. */
export const brand = {
  name: 'BlockLane',
  institution: 'HEG',
  tagline: 'Observatoire blockchain',
  fairOnChainUrl: null as string | null,
};

export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
