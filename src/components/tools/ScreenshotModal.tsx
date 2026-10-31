import ScreenshotEditor from './screenshot/ScreenshotEditor'
import type { PinnedItem } from './PinnedScreenshot'

export interface ScreenshotModalProps {
  imageSrc: string
  onClose: () => void
  onPin: (pinned: PinnedItem) => void
  onToast: (msg: string) => void
}

export default function ScreenshotModal(props: ScreenshotModalProps) {
  return <ScreenshotEditor {...props} />
}
