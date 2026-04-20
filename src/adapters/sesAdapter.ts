/**
 * SesAdapter: interface + implementations + singleton getter for the
 * adapters layer. `LiveSesAdapter` sends via AWS
 * SES in production; `StubSesAdapter` records messages in memory for
 * dev/test. Services call the interface; the getter returns the
 * configured implementation based on `config.sesAdapter`.
 */
import { randomUUID } from 'node:crypto';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from '../config/env';

export interface SesMessage {
  to: string;
  subject: string;
  bodyText: string;
  from?: string;
}

export interface SesSendResult {
  messageId: string;
  deliveredAt: string;
}

export interface SesAdapter {
  sendEmail(msg: SesMessage): Promise<SesSendResult>;
}

interface StubSentMessage extends SesMessage {
  messageId: string;
  deliveredAt: string;
}

export interface StubSesAdapter extends SesAdapter {
  readonly sentMessages: readonly StubSentMessage[];
  clear(): void;
  failNext(error: Error): void;
}

export function createLiveSesAdapter(opts: {
  region?: string;
  fromIdentity: string;
  sesClient?: SESClient;
}): SesAdapter {
  const client =
    opts.sesClient ?? new SESClient(opts.region ? { region: opts.region } : {});
  const defaultFrom = opts.fromIdentity;
  return {
    async sendEmail(msg) {
      const res = await client.send(
        new SendEmailCommand({
          Source: msg.from ?? defaultFrom,
          Destination: { ToAddresses: [msg.to] },
          Message: {
            Subject: { Data: msg.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: msg.bodyText, Charset: 'UTF-8' } },
          },
        }),
      );
      if (!res.MessageId) {
        throw new Error('SES SendEmail returned no MessageId');
      }
      return {
        messageId: res.MessageId,
        deliveredAt: new Date().toISOString(),
      };
    },
  };
}

export function createStubSesAdapter(): StubSesAdapter {
  const sent: StubSentMessage[] = [];
  let pendingError: Error | null = null;
  return {
    get sentMessages() {
      return sent;
    },
    clear() {
      sent.length = 0;
      pendingError = null;
    },
    failNext(error: Error) {
      pendingError = error;
    },
    async sendEmail(msg) {
      if (pendingError) {
        const err = pendingError;
        pendingError = null;
        throw err;
      }
      const record: StubSentMessage = {
        ...msg,
        messageId: `stub-${randomUUID()}`,
        deliveredAt: new Date().toISOString(),
      };
      sent.push(record);
      return { messageId: record.messageId, deliveredAt: record.deliveredAt };
    },
  };
}

let singleton: SesAdapter | null = null;
let stubSingleton: StubSesAdapter | null = null;

export function getSesAdapter(): SesAdapter {
  if (singleton) return singleton;
  if (config.sesAdapter === 'live') {
    if (!config.sesFromIdentity) {
      throw new Error('SES_FROM_IDENTITY is required when SES_ADAPTER=live');
    }
    singleton = createLiveSesAdapter({
      region: config.awsRegion,
      fromIdentity: config.sesFromIdentity,
    });
  } else {
    stubSingleton = createStubSesAdapter();
    singleton = stubSingleton;
  }
  return singleton;
}

/** Exposes the in-memory stub adapter for test inspection. Null unless SES_ADAPTER=stub. */
export function getStubSesAdapterForTests(): StubSesAdapter | null {
  return stubSingleton;
}

export function resetSesAdapterForTests(): void {
  singleton = null;
  stubSingleton = null;
}
