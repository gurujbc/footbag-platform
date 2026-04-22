// Shared view-model builder for the "simulated email" card rendered on
// email-gated pages (currently /register/check-email). Three modes:
//
//  - dev:      SES_ADAPTER=stub. Returns the captured in-memory messages
//              from StubSesAdapter so the developer can finish email flows
//              without leaving the page.
//  - sandbox:  SES_ADAPTER=live AND SES_SANDBOX_MODE=1. Returns a static
//              warning view-model naming the SES mailbox-simulator
//              recipient addresses and the tester-allow-list contact.
//  - null:     SES_ADAPTER=live AND SES_SANDBOX_MODE=0. Real production:
//              no card is rendered.
//
// Scrub safety: DD §5.4 requires outbox_emails.body_text to be NULLed
// after send. That scrub runs on the DB row, not on the stub adapter's
// in-memory array, so the dev-mode card remains authoritative for the
// original message content.

import { config } from '../config/env';
import { getSesAdapter, getStubSesAdapterForTests } from '../adapters/sesAdapter';
import { operationsPlatformService } from './operationsPlatformService';

export interface SimulatedEmailMessage {
  to:          string;
  from:        string;
  subject:     string;
  bodyText:    string;
  messageId:   string;
  deliveredAt: string;
  firstUrl:    string | null;
}

export interface SimulatedEmailSimulatorAddress {
  address:     string;
  description: string;
}

export type SimulatedEmailPreview =
  | { mode: 'dev'; messages: SimulatedEmailMessage[] }
  | {
      mode:                'sandbox';
      contactEmail:        string;
      simulatorAddresses:  SimulatedEmailSimulatorAddress[];
      docsUrl:             string;
    };

const URL_PATTERN = /https?:\/\/\S+/;

const SANDBOX_CONTACT_EMAIL = 'trainedape@gmail.com';
const SANDBOX_DOCS_URL =
  'https://docs.aws.amazon.com/ses/latest/DeveloperGuide/send-email-simulator.html';
const SANDBOX_SIMULATOR_ADDRESSES: SimulatedEmailSimulatorAddress[] = [
  { address: 'success@simulator.amazonses.com',         description: 'delivered normally' },
  { address: 'bounce@simulator.amazonses.com',          description: 'hard bounce' },
  { address: 'complaint@simulator.amazonses.com',       description: 'complaint feedback loop' },
  { address: 'suppressionlist@simulator.amazonses.com', description: 'rejected (on suppression list)' },
];

export const simulatedEmailService = {
  async getEmailPreview(): Promise<SimulatedEmailPreview | null> {
    if (config.sesAdapter === 'stub') {
      // Force adapter init so stubSingleton is populated on a fresh server
      // that has not yet dispatched any email. Idempotent when already live.
      getSesAdapter();
      const stub = getStubSesAdapterForTests();
      if (!stub) return { mode: 'dev', messages: [] };

      // Drain any outbox_emails rows through the stub so the just-enqueued
      // verification email appears without waiting for the scheduled worker.
      // Safe because SES_ADAPTER=stub means no network calls.
      await operationsPlatformService.runEmailWorker();

      const messages: SimulatedEmailMessage[] = [...stub.sentMessages]
        .reverse()
        .map((m) => {
          const match = m.bodyText.match(URL_PATTERN);
          return {
            to:          m.to,
            from:        m.from ?? '(default)',
            subject:     m.subject,
            bodyText:    m.bodyText,
            messageId:   m.messageId,
            deliveredAt: m.deliveredAt,
            firstUrl:    match ? match[0] : null,
          };
        });

      return { mode: 'dev', messages };
    }

    if (config.sesSandboxMode) {
      return {
        mode:               'sandbox',
        contactEmail:       SANDBOX_CONTACT_EMAIL,
        simulatorAddresses: SANDBOX_SIMULATOR_ADDRESSES,
        docsUrl:            SANDBOX_DOCS_URL,
      };
    }

    return null;
  },
};
