import { describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../src/shared/i18n'
import { createUpdateBannerController } from '../../../src/renderer/app/update-banner-controller'

class FakeElement extends EventTarget {
  textContent = ''
  hidden = true
  disabled = false
}

describe('update download recovery', () => {
  it('re-enables retry with a localized error after download rejects', async () => {
    setLocale('en')
    const banner = new FakeElement()
    const text = new FakeElement()
    const action = new FakeElement()
    const dismiss = new FakeElement()
    const controller = createUpdateBannerController({
      banner: banner as unknown as HTMLElement,
      text: text as unknown as HTMLElement,
      action: action as unknown as HTMLButtonElement,
      dismiss: dismiss as unknown as HTMLButtonElement,
      download: vi.fn().mockRejectedValue(new Error('network secret')),
      install: vi.fn(),
    })
    controller.showAvailable('1.2.3')

    action.dispatchEvent(new Event('click'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(action.disabled).toBe(false)
    expect(action.textContent).toBe('Try Again')
    expect(text.textContent).toBe('Unable to download the update. Check your connection and try again.')
  })
})

it('recovers truthfully when updater capability returns false without rejecting', async () => {
  setLocale('en')
  const banner = new FakeElement()
  const text = new FakeElement()
  const action = new FakeElement()
  const dismiss = new FakeElement()
  const controller = createUpdateBannerController({
    banner: banner as unknown as HTMLElement,
    text: text as unknown as HTMLElement,
    action: action as unknown as HTMLButtonElement,
    dismiss: dismiss as unknown as HTMLButtonElement,
    download: vi.fn().mockResolvedValue(false),
    install: vi.fn().mockResolvedValue(false),
  })
  controller.showAvailable('1.2.3')

  action.dispatchEvent(new Event('click'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(action.disabled).toBe(false)
  expect(action.textContent).toBe('Try Again')
  expect(text.textContent).toBe('Unable to download the update. Check your connection and try again.')
})
