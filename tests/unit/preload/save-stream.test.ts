import { expect, it, vi } from 'vitest'
import { streamSaveChunks } from '../../../src/preload/save-stream'

it('yields between bounded groups of save chunks without changing their order', async () => {
  const sent: Array<{ index: number; chunk: string }> = []
  const yieldControl = vi.fn(async () => {})

  const accepted = await streamSaveChunks({
    content: 'abcdefghijklmnopqrst',
    chunkLength: 2,
    yieldEvery: 3,
    sendChunk: async (index, chunk) => { sent.push({ index, chunk }); return true },
    yieldControl,
  })

  expect(accepted).toBe(true)
  expect(sent).toEqual([
    { index: 0, chunk: 'ab' }, { index: 1, chunk: 'cd' }, { index: 2, chunk: 'ef' },
    { index: 3, chunk: 'gh' }, { index: 4, chunk: 'ij' }, { index: 5, chunk: 'kl' },
    { index: 6, chunk: 'mn' }, { index: 7, chunk: 'op' }, { index: 8, chunk: 'qr' },
    { index: 9, chunk: 'st' },
  ])
  expect(yieldControl).toHaveBeenCalledTimes(3)
})

it('stops streaming as soon as a chunk is rejected', async () => {
  const sendChunk = vi.fn(async (index: number) => index < 2)
  const yieldControl = vi.fn(async () => {})

  await expect(streamSaveChunks({
    content: 'abcdefgh', chunkLength: 2, yieldEvery: 2, sendChunk, yieldControl,
  })).resolves.toBe(false)

  expect(sendChunk).toHaveBeenCalledTimes(3)
  expect(yieldControl).toHaveBeenCalledTimes(1)
})
