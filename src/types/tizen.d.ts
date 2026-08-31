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

  // ---- Samsung Product API (`window.webapis`) ----
  //
  // Injected by the Samsung TV web runtime only. NOT part of Tizen's own
  // `tizen` namespace, and absent in every browser and every unit test —
  // hence optional everywhere, and only ever reached through the
  // feature-detecting accessors in core/platform/samsungProductApi.ts.
  //
  // Using webapis.network requires the Samsung Product Network privilege
  // (http://developer.samsung.com/privilege/network.public) in config.xml;
  // without it the calls throw at runtime rather than returning an error.
  interface SamsungWebapisNetwork {
    NetworkState?: Record<string, number>;
    isConnectedToGateway?(): boolean;
    addNetworkStateChangeListener?(callback: (state: number) => void): number;
    removeNetworkStateChangeListener?(listenerId: number): void;
  }

  interface SamsungWebapisAppCommon {
    AppCommonScreenSaverState?: Record<string, number>;
    setScreenSaver?(state: number, callback?: (result: unknown) => void): void;
  }

  interface SamsungWebapis {
    network?: SamsungWebapisNetwork;
    appcommon?: SamsungWebapisAppCommon;
  }

  interface Window {
    webapis?: SamsungWebapis;
  }
}
