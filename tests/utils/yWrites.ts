import * as Y from "yjs";

/** Records local writes under `field` as readable lines: what the server judges. */
export function recordYWrites(ydoc: Y.Doc, field = "default") {
  const lines: string[] = [];

  const onAfterTransaction = (transaction: Y.Transaction) => {
    if (!transaction.local) {
      return;
    }
    for (const [type, events] of transaction.changedParentTypes) {
      for (const event of events) {
        if (event.target !== type) {
          continue;
        }
        const where = pathOf(event.target as Y.AbstractType<unknown>);
        if (!where.startsWith(field)) {
          continue;
        }
        if (event instanceof Y.YTextEvent) {
          for (const op of event.delta) {
            lines.push(`${where} text ${JSON.stringify(op)}`);
          }
          continue;
        }
        for (const op of event.changes.delta) {
          if (op.insert) {
            for (const value of op.insert as unknown[]) {
              lines.push(`${where} insert ${describe(value)}`);
            }
          } else if (op.delete) {
            lines.push(`${where} delete ${op.delete}`);
          }
        }
        for (const [key, change] of event.changes.keys) {
          const value = (event.target as Y.XmlElement).getAttribute?.(key);
          lines.push(
            `${where} attribute ${key} ${change.action} ${JSON.stringify(value)}`,
          );
        }
      }
    }
  };

  ydoc.on("afterTransaction", onAfterTransaction);

  return {
    lines,
    stop: () => ydoc.off("afterTransaction", onAfterTransaction),
  };
}

/** `default>blockThread>paragraph`, from the root field down. */
function pathOf(type: Y.AbstractType<unknown>): string {
  const parts: string[] = [];
  let current: Y.AbstractType<unknown> | null = type;
  while (current) {
    if (current instanceof Y.XmlElement) {
      parts.unshift(current.nodeName);
    } else if (current instanceof Y.XmlText) {
      parts.unshift("#text");
    } else if (current._item === null) {
      parts.unshift(Y.findRootTypeKey(current));
      break;
    }
    current = (current._item?.parent as Y.AbstractType<unknown>) ?? null;
  }
  return parts.join(">");
}

function describe(value: unknown): string {
  if (value instanceof Y.XmlElement) {
    const children = value.toArray().map(describe).join(", ");
    return `<${value.nodeName} ${JSON.stringify(value.getAttributes())}>[${children}]`;
  }
  if (value instanceof Y.XmlText) {
    return `#text${JSON.stringify(value.toDelta())}`;
  }
  return JSON.stringify(value);
}
