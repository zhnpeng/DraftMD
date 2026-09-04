export async function streamSaveChunks(input: {
  content: string
  chunkLength: number
  yieldEvery: number
  sendChunk(index: number, chunk: string): Promise<boolean>
  yieldControl(): Promise<void>
}): Promise<boolean> {
  let index = 0
  for (let offset = 0; offset < input.content.length; offset += input.chunkLength) {
    if (!await input.sendChunk(index, input.content.slice(offset, offset + input.chunkLength))) return false
    index += 1
    if (index % input.yieldEvery === 0 && offset + input.chunkLength < input.content.length) {
      await input.yieldControl()
    }
  }
  return true
}
