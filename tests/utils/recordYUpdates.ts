import { MessageType } from "@tiptap-pro/provider";
import type { TiptapCollabProvider } from "@tiptap-pro/provider";
import * as Y from "yjs";
import {
  markAttributeValues,
  type YTextSegment,
  yTextSegments,
} from "~/fixtures/editor/yMarkSnapshots";

type UpdateDirection = "local" | "remote";
type UpdateSource = "ydoc" | "outgoing" | "incoming";

export interface YUpdateSummary {
  direction: UpdateDirection;
  source: UpdateSource;
  bytes: number;
  origin?: string;
  messageType?: string;
  textStyleChanged: boolean;
  textStyleBefore: Array<{ text: string; value: unknown }>;
  textStyleAfter: Array<{ text: string; value: unknown }>;
  inlineThreadKeysAfter: string[];
}

interface YUpdateRecord extends YUpdateSummary {
  segmentsBefore: YTextSegment[];
  segmentsAfter: YTextSegment[];
}

interface RecordYUpdatesOptions {
  ydoc: Y.Doc;
  provider: TiptapCollabProvider;
  field?: string;
}

function originLabel(origin: unknown, provider: TiptapCollabProvider): string {
  if (origin === provider) {
    return "provider";
  }
  if (typeof origin === "string") {
    return origin;
  }
  if (origin && typeof origin === "object") {
    const name = (origin as { constructor?: { name?: string } }).constructor
      ?.name;
    if (name) {
      return name;
    }
  }
  return String(origin);
}

function messageTypeLabel(type: number | undefined): string | undefined {
  if (type === undefined) {
    return undefined;
  }
  return MessageType[type] ?? String(type);
}

function inlineThreadKeys(segments: YTextSegment[]): string[] {
  const keys = new Set<string>();

  for (const segment of segments) {
    for (const key of Object.keys(segment.attributes)) {
      if (key.startsWith("inlineThread") || key.startsWith("blockThread")) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
}

function textStyleChanged(
  before: YTextSegment[],
  after: YTextSegment[]
): boolean {
  return (
    JSON.stringify(markAttributeValues(before, "textStyle")) !==
    JSON.stringify(markAttributeValues(after, "textStyle"))
  );
}

function toSummary(record: YUpdateRecord): YUpdateSummary {
  return {
    direction: record.direction,
    source: record.source,
    bytes: record.bytes,
    origin: record.origin,
    messageType: record.messageType,
    textStyleChanged: record.textStyleChanged,
    textStyleBefore: record.textStyleBefore,
    textStyleAfter: record.textStyleAfter,
    inlineThreadKeysAfter: record.inlineThreadKeysAfter,
  };
}

/**
 * Record Yjs doc mutations and provider wire traffic for collab debugging.
 * Y `afterTransaction` entries include textStyle before/after snapshots.
 */
function recordYUpdates(options: RecordYUpdatesOptions) {
  const { ydoc, provider } = options;
  const field = options.field ?? "default";
  const records: YUpdateRecord[] = [];

  const snapshot = () => yTextSegments(ydoc, field);
  let lastSegments = snapshot();

  const onAfterTransaction = (transaction: Y.Transaction) => {
    const segmentsAfter = snapshot();
    const segmentsBefore = lastSegments;
    lastSegments = segmentsAfter;

    records.push({
      direction: transaction.local ? "local" : "remote",
      source: "ydoc",
      bytes: 0,
      origin: originLabel(transaction.origin, provider),
      textStyleChanged: textStyleChanged(segmentsBefore, segmentsAfter),
      textStyleBefore: markAttributeValues(segmentsBefore, "textStyle"),
      textStyleAfter: markAttributeValues(segmentsAfter, "textStyle"),
      inlineThreadKeysAfter: inlineThreadKeys(segmentsAfter),
      segmentsBefore,
      segmentsAfter,
    });
  };

  const onOutgoingMessage = ({
    message,
  }: {
    message: { type?: number; toUint8Array: () => Uint8Array };
  }) => {
    records.push({
      direction: "local",
      source: "outgoing",
      bytes: message.toUint8Array().byteLength,
      messageType: messageTypeLabel(message.type),
      textStyleChanged: false,
      textStyleBefore: markAttributeValues(lastSegments, "textStyle"),
      textStyleAfter: markAttributeValues(lastSegments, "textStyle"),
      inlineThreadKeysAfter: inlineThreadKeys(lastSegments),
      segmentsBefore: lastSegments,
      segmentsAfter: lastSegments,
    });
  };

  const onIncomingMessage = ({
    message,
  }: {
    message: { length: () => number };
  }) => {
    records.push({
      direction: "remote",
      source: "incoming",
      bytes: message.length(),
      textStyleChanged: false,
      textStyleBefore: markAttributeValues(lastSegments, "textStyle"),
      textStyleAfter: markAttributeValues(lastSegments, "textStyle"),
      inlineThreadKeysAfter: inlineThreadKeys(lastSegments),
      segmentsBefore: lastSegments,
      segmentsAfter: lastSegments,
    });
  };

  ydoc.on("afterTransaction", onAfterTransaction);
  provider.on("outgoingMessage", onOutgoingMessage);
  provider.on("message", onIncomingMessage);

  return {
    getRecords(): readonly YUpdateRecord[] {
      return records;
    },
    getSummary(): YUpdateSummary[] {
      return records.map(toSummary);
    },
    unsubscribe() {
      ydoc.off("afterTransaction", onAfterTransaction);
      provider.off("outgoingMessage", onOutgoingMessage);
      provider.off("message", onIncomingMessage);
    },
  };
}

export default recordYUpdates;
