// heic-decode ships no types. This is the one call the import makes.
declare module 'heic-decode' {
  export default function decode(input: { buffer: Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>
}
