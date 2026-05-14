/// <reference types="vite/client" />

declare module 'tz-lookup' {
  /** Returns the IANA timezone name for the given coordinates. */
  const tzlookup: (lat: number, lng: number) => string;
  export default tzlookup;
}
