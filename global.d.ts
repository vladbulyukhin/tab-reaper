// Vite asset imports (SVG, CSS, ?url) and import.meta.env are checked in TSX too.
/// <reference types="vite/client" />

export declare global {
  declare module '*.png?url';

  var __DEBUG__: boolean;
}
