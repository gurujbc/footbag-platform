// ---- Dev-only ----
// Dev outbox viewer: surfaces in-memory messages from StubSesAdapter so that
// a developer on localhost can complete email-gated flows (activation, password
// reset) without bypassing the adapter seam. Throws NotFoundError when SES_ADAPTER
// is not 'stub' — the controller maps that to 404.

import { getStubSesAdapterForTests } from '../../adapters/sesAdapter';
import { NotFoundError } from '../../services/serviceErrors';
import { PageViewModel } from '../../types/page';

interface DevOutboxMessageViewModel {
  to:          string;
  from:        string;
  subject:     string;
  bodyText:    string;
  messageId:   string;
  deliveredAt: string;
  firstUrl:    string | null;
}

interface DevOutboxContent {
  messages: DevOutboxMessageViewModel[];
}

const URL_PATTERN = /https?:\/\/\S+/;

export const devOutboxService = {
  getDevOutboxPage(): PageViewModel<DevOutboxContent> {
    const stub = getStubSesAdapterForTests();
    if (!stub) {
      throw new NotFoundError('dev outbox is disabled when SES_ADAPTER is not stub');
    }

    const messages: DevOutboxMessageViewModel[] = [...stub.sentMessages]
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

    return {
      seo:  { title: 'Dev Outbox' },
      page: { sectionKey: '', pageKey: 'dev_outbox', title: 'Dev Outbox' },
      content: { messages },
    };
  },
};
