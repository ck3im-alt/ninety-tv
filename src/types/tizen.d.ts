// Minimal ambient declarations for the Tizen Web Device API.
// Extend as we start consuming more of the API surface in core/platform.
export {};

declare global {
  interface TizenInputDeviceKey {
    name: string;
    code: number;
  }

  interface TizenTVInputDeviceManager {
    getSupportedKeys(): TizenInputDeviceKey[];
    registerKey(keyName: string): void;
    unregisterKey(keyName: string): void;
  }

  interface TizenApplication {
    exit(): void;
    hide(): void;
  }

  interface TizenApplicationManager {
    getCurrentApplication(): TizenApplication;
  }

  // tizen.systeminfo's LOCALE property (see core/platform/deviceRegion.ts).
  // Both fields use Tizen's '(LANGUAGE)_(REGION)' shape, e.g. 'eng_US'.
  interface TizenSystemInfoLocale {
    language?: string;
    country?: string;
  }

  // Callback-based by design — Tizen exposes no synchronous or Promise
  // form. Typed loosely (the property name is a string, the success value
  // is per-property) because deviceRegion.ts only ever reads LOCALE and
  // guards/try-catches the whole call anyway.
  interface TizenSystemInfoManager {
    getPropertyValue(
      property: string,
      onSuccess: (value: TizenSystemInfoLocale) => void,
      onError?: (error: unknown) => void,
    ): void;
  }

  interface Tizen {
    tvinputdevice: TizenTVInputDeviceManager;
    application: TizenApplicationManager;
    // Optional: present on Tizen TV firmware, but never assumed — every
    // read is feature-detected (see core/platform/deviceRegion.ts).
    systeminfo?: TizenSystemInfoManager;
  }

  interface Window {
    tizen?: Tizen;
  }
}
