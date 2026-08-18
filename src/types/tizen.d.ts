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

  interface Tizen {
    tvinputdevice: TizenTVInputDeviceManager;
    application: TizenApplicationManager;
  }

  interface Window {
    tizen?: Tizen;
  }
}
