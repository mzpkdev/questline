// Raw DEFLATE over the platform's native CompressionStream, used to shrink the sync payload before it
// is encrypted. Order matters: ciphertext is high-entropy and won't compress, so compression must come
// first (compress -> encrypt on push; decrypt -> decompress on pull). `deflate-raw` drops gzip's ~18
// bytes of header/trailer. Async, matching the WebCrypto path it sits beside; no dependency.

export async function deflate(text: string): Promise<Uint8Array<ArrayBuffer>> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
    return new Response(stream).text()
}
