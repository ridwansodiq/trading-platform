import type { ServerResponse } from "node:http";

/**
 * Generic Server-Sent Events fan-out.
 *
 * Transport infrastructure, not trade behaviour, so it lives outside the
 * modules and knows nothing about what it is carrying.
 */

export type SseBrokerOptions = {
  /** Refuse further subscribers past this many; each holds an open socket. */
  maxClients: number;
  /**
   * Disconnect a client whose kernel buffer is backed up beyond this many
   * bytes. A consumer that has stopped reading would otherwise make the server
   * buffer every future frame for it, in memory, without limit.
   */
  maxBufferedBytes?: number;
};

const DEFAULT_MAX_BUFFERED_BYTES = 1_000_000;

/**
 * A named event, with `data` on its own line, per the SSE wire format.
 *
 * Exported because a frame is not only ever broadcast: a reconnecting client is
 * replayed what it missed on its own socket, and both paths have to put an `id`
 * on the wire the same way or a resumed stream would be resumed from a
 * different cursor than it was sent.
 */
export function sseFrame(event: string, payload: unknown, id?: string): string {
  return (id ? `id: ${id}\n` : "") + `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export class SseBroker {
  private readonly clients = new Set<ServerResponse>();
  private readonly maxClients: number;
  private readonly maxBufferedBytes: number;

  constructor({ maxClients, maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES }: SseBrokerOptions) {
    this.maxClients = maxClients;
    this.maxBufferedBytes = maxBufferedBytes;
  }

  /** Returns null when the broker is full, so the caller can reject the request. */
  subscribe(response: ServerResponse): (() => void) | null {
    if (this.clients.size >= this.maxClients) return null;
    this.clients.add(response);
    return () => this.clients.delete(response);
  }

  broadcast(event: string, payload: unknown, id?: string): void {
    const frame = sseFrame(event, payload, id);

    for (const client of this.clients) {
      this.send(client, frame);
    }
  }

  /**
   * Writes a frame, dropping a client that cannot keep up.
   *
   * `write()` returning false only means "buffer is above the high-water mark",
   * which is normal and recoverable. A backlog past `maxBufferedBytes` is not:
   * the peer has stopped reading, and every later frame would accumulate in
   * this process. Closing the socket makes the client reconnect and refetch,
   * which is exactly the recovery path SSE already has.
   */
  private send(client: ServerResponse, frame: string): void {
    if (client.writableEnded || client.destroyed) {
      this.clients.delete(client);
      return;
    }

    if (client.writableLength > this.maxBufferedBytes) {
      this.clients.delete(client);
      client.destroy();
      return;
    }

    client.write(frame);
  }

  /**
   * Ends every stream. Called on shutdown: these responses are hijacked from
   * Fastify, so nothing else would close them and `app.close()` would wait on
   * sockets that never finish.
   */
  closeAll(): void {
    for (const client of this.clients) {
      if (!client.writableEnded) client.end();
    }
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }
}
