import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Dispatch } from 'react'
import { useTranslation } from 'react-i18next'
import AccountManager from '../AccountManager'

export default function LoginDialog({
  open,
  setOpen
}: {
  open: boolean
  setOpen: Dispatch<boolean>
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[90dvh]" title={t('Login')}>
          <div className="flex flex-col gap-4 overflow-auto p-4">
            <AccountManager close={() => setOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] w-[520px] overflow-auto py-8">
        {/* AccountManager renders its own visible heading; this is only for
            screen readers, which require a DialogTitle descendant. */}
        <DialogTitle className="sr-only">{t('Login')}</DialogTitle>
        <AccountManager close={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
