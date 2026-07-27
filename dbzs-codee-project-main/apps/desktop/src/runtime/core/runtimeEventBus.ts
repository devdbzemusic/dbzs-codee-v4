export interface RuntimeEventEnvelope<TPayload = unknown> {
  type: string;
  timestamp: string;
  source: string;
  payload: TPayload;
}

export type RuntimeEventHandler<TPayload = unknown> = (
  event: RuntimeEventEnvelope<TPayload>
) => void | Promise<void>;

export class RuntimeEventBus {
  private readonly handlers = new Map<string, Set<RuntimeEventHandler>>();

  on<TPayload = unknown>(
    eventType: string,
    handler: RuntimeEventHandler<TPayload>
  ): () => void {
    const current = this.handlers.get(eventType) ?? new Set<RuntimeEventHandler>();
    current.add(handler as RuntimeEventHandler);
    this.handlers.set(eventType, current);

    return () => {
      const set = this.handlers.get(eventType);
      if (!set) {
        return;
      }
      set.delete(handler as RuntimeEventHandler);
      if (set.size === 0) {
        this.handlers.delete(eventType);
      }
    };
  }

  async emit<TPayload = unknown>(
    source: string,
    eventType: string,
    payload: TPayload
  ): Promise<void> {
    const event: RuntimeEventEnvelope<TPayload> = {
      type: eventType,
      timestamp: new Date().toISOString(),
      source,
      payload
    };

    const handlers = this.handlers.get(eventType);
    if (!handlers || handlers.size === 0) {
      return;
    }

    await Promise.all([...handlers].map((handler) => Promise.resolve(handler(event))));
  }
}
