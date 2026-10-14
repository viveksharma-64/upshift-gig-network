/**
 * UpShift Event & Notification Dispatcher
 *
 * Implements FRD v1.0 Section 22:
 * - NOT-01: Publish Notification (identifies published opportunity)
 * - NOT-02: Failure Notification (surfaces publication or worker failures)
 * - NOT-03: No False Notification (strictly blocks notifications for rejected/stopped/unpublished records)
 */

let nodeFs = null;
let nodePath = null;
let NOTIFICATIONS_FILE = '';

async function ensureNodeStorage() {
  if (typeof window !== 'undefined' || nodeFs) return;
  try {
    nodeFs = await import('node:fs');
    nodePath = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = nodePath.dirname(__filename);
    NOTIFICATIONS_FILE = nodePath.resolve(__dirname, '../../data/notifications.json');
  } catch {}
}

export const NOTIFICATION_EVENTS = {
  OPPORTUNITY_PUBLISHED: 'opportunity.published',
  PUBLICATION_FAILED: 'opportunity.publish_failed',
  HEALTH_STATUS_CHANGED: 'opportunity.health_status_changed',
  SOURCE_FAILURE: 'source.failure'
};

class NotificationService {
  constructor() {
    this.listeners = new Map();
    this.eventLog = [];
    this._loadLog();
  }

  async _loadLog() {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('upshift_notifications');
        if (raw) this.eventLog = JSON.parse(raw);
      } catch {}
      return;
    }

    try {
      await ensureNodeStorage();
      if (nodeFs && NOTIFICATIONS_FILE && nodeFs.existsSync(NOTIFICATIONS_FILE)) {
        const raw = nodeFs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.eventLog = parsed;
        }
      }
    } catch {
      this.eventLog = [];
    }
  }

  async _persistLog() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('upshift_notifications', JSON.stringify(this.eventLog.slice(-100)));
      } catch {}
      return;
    }

    try {
      await ensureNodeStorage();
      if (nodeFs && nodePath && NOTIFICATIONS_FILE) {
        const dir = nodePath.dirname(NOTIFICATIONS_FILE);
        if (!nodeFs.existsSync(dir)) nodeFs.mkdirSync(dir, { recursive: true });
        nodeFs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(this.eventLog.slice(-500), null, 2), 'utf8');
      }
    } catch {
      // safe fallback if storage is read-only
    }
  }

  /**
   * Subscribes a listener to an event type
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  /**
   * Dispatches a notification event with strict NOT-03 validation
   * @param {string} eventType
   * @param {object} payload
   * @returns {object|null} recorded notification event
   */
  notify(eventType, payload = {}) {
    // NOT-03: Strict guard - Never notify learners or trigger publish events for rejected, stopped or unpublished records
    if (eventType === NOTIFICATION_EVENTS.OPPORTUNITY_PUBLISHED) {
      const status = (payload.status || payload.publishedGig?.status || '').toLowerCase();
      if (status && status !== 'active' && status !== 'published' && status !== 'approved') {
        console.warn(`[Notification Guard] Blocked notification for unapproved/stopped record: ${payload.id || payload.title}`);
        return null;
      }
    }

    const eventRecord = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: eventType,
      timestamp: new Date().toISOString(),
      payload
    };

    this.eventLog.push(eventRecord);
    this._persistLog();

    const handlers = this.listeners.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(eventRecord);
        } catch (err) {
          console.error(`[Notification Handler Error]:`, err);
        }
      }
    }

    return eventRecord;
  }

  /**
   * Dispatches a successful publication notification (NOT-01)
   * @param {object} publishedGig
   * @param {object} [candidate]
   * @returns {object|null}
   */
  notifyPublished(publishedGig, candidate = null) {
    if (!publishedGig) return null;
    return this.notify(NOTIFICATION_EVENTS.OPPORTUNITY_PUBLISHED, {
      gigId: publishedGig.id || publishedGig.external_gig_id,
      title: publishedGig.title,
      track_id: publishedGig.track_id,
      payment_amount: publishedGig.payment_amount,
      origin_url: publishedGig.origin_url,
      candidateId: candidate?.id || null,
      message: `🎉 New Opportunity Published: "${publishedGig.title}" (${publishedGig.track_id})`
    });
  }

  /**
   * Dispatches a publication failure notification (NOT-02)
   * @param {object} candidate
   * @param {string} reason
   * @returns {object}
   */
  notifyPublishFailure(candidate, reason) {
    return this.notify(NOTIFICATION_EVENTS.PUBLICATION_FAILED, {
      candidateId: candidate?.id || 'unknown',
      title: candidate?.title || 'Untitled',
      reason,
      message: `⚠️ Publication Failed for "${candidate?.title}": ${reason}`
    });
  }

  /**
   * Dispatches a source failure notification (NOT-02, T14)
   * @param {string} sourceName
   * @param {string} error
   * @returns {object}
   */
  notifySourceFailure(sourceName, error) {
    return this.notify(NOTIFICATION_EVENTS.SOURCE_FAILURE, {
      sourceName,
      error,
      message: `🚨 Ingestion Source Error in "${sourceName}": ${error}`
    });
  }

  /**
   * Retrieves recorded events
   * @param {object} [filter]
   * @returns {Array<object>}
   */
  getEvents(filter = {}) {
    let result = [...this.eventLog];
    if (filter.type) {
      result = result.filter(e => e.type === filter.type);
    }
    if (filter.limit) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  clear() {
    this.eventLog = [];
    this._persistLog();
  }
}

export const defaultNotificationService = new NotificationService();
