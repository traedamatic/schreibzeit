/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /**
   * Basis-URL der Familien-Server-API (z. B. `/api` bei Same-Origin-Hosting
   * bzw. Vite-Dev-Proxy). Nicht gesetzt = rein lokaler Betrieb ohne Sync.
   */
  readonly VITE_API_URL?: string;
}

interface Window {
  schreibzeit?: {
    istDesktop: boolean;
    plattform: string;
    print?: () => Promise<boolean>;
    printToPDF?: () => Promise<boolean>;
  };
  /** Local Font Access API (Chromium/Electron) – installierte Schriften lesen. */
  queryLocalFonts?: () => Promise<{ family: string; fullName: string; postscriptName: string }[]>;
}

declare module 'hyphen/de' {
  export function hyphenateSync(text: string, options?: { hyphenChar?: string }): string;
  export function hyphenate(text: string, options?: { hyphenChar?: string }): Promise<string>;
}
