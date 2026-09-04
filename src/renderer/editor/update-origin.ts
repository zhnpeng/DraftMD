export type EditorUpdateOrigin = 'programmatic' | 'user'
export type ImmediateEditorUpdateOrigin = EditorUpdateOrigin | 'internal'

export const EDITOR_UPDATE_ORIGIN_META = 'draftmd:update-origin'

export interface EditorTransactionOrigin {
  explicitOrigin: EditorUpdateOrigin | null
  addToHistory: boolean
}

export interface EditorUpdateOriginTracker {
  recordTransaction(transaction: EditorTransactionOrigin): ImmediateEditorUpdateOrigin
  consumeSerializedOrigin(): EditorUpdateOrigin
}

export function createEditorUpdateOriginTracker(): EditorUpdateOriginTracker {
  let batchOrigin: EditorUpdateOrigin | null = null
  return {
    recordTransaction(transaction) {
      let immediateOrigin: ImmediateEditorUpdateOrigin
      if (transaction.explicitOrigin) immediateOrigin = transaction.explicitOrigin
      else immediateOrigin = transaction.addToHistory ? 'user' : 'internal'

      if (immediateOrigin === 'user') {
        // A real edit wins the delayed aggregate in either transaction order.
        batchOrigin = 'user'
      } else if (immediateOrigin === 'programmatic' && batchOrigin !== 'user') {
        batchOrigin = 'programmatic'
      } else if (immediateOrigin === 'internal' && batchOrigin === null) {
        // No tagged ancestor means this internal change cannot be assumed safe.
        batchOrigin = 'user'
      }
      return immediateOrigin
    },
    consumeSerializedOrigin() {
      const origin = batchOrigin ?? 'user'
      batchOrigin = null
      return origin
    },
  }
}
