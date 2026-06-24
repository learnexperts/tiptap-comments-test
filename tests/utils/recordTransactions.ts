import { Editor, EditorEvents } from "@tiptap/core"
import type { Transaction } from "@tiptap/pm/state"

type TransactionEvent = EditorEvents["transaction"]
type TransactionFilter = (transaction: Transaction) => boolean

const defaultFilter: TransactionFilter = (transaction) => transaction.docChanged

/**
 * Subscribe to editor transactions and log each ProseMirror step.
 * Returns an unsubscribe function.
 */
function recordTransactions(
  editor: Editor,
  filter: (transaction: Transaction) => boolean
) {
  const transactions: Transaction[] = []

  function handler({ transaction }: TransactionEvent) {
    if (!filter(transaction)) return
    transactions.push(transaction)
  }

  editor.on("transaction", handler)

  return {
    getTransactionSteps(): Transaction["steps"] {
      return transactions.flatMap((transaction) => transaction.steps)
    },
    getTransactions(): readonly Transaction[] {
      return transactions
    },
    unsubscribe() {
      editor.off("transaction", handler)
    },
  }
}

export default recordTransactions
