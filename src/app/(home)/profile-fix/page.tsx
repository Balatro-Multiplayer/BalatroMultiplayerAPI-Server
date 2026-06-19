import { CopyCode } from '@/components/copy-code'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { createMetadata } from '../../../../lib/metadata'
import { FileUploader } from './file-uploader'

export const metadata = createMetadata({
  title: 'Fix Corrupted Profile',
  description:
    'Repair a broken Balatro `profile.jkr` file and recover a playable save.',
  path: '/profile-fix',
})

export default async function Home() {
  return (
    <div
      className={
        'mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col items-end gap-4 pt-16'
      }
    >
      <Dialog>
        <DialogTrigger asChild>
          <Button variant='outline'>Where is my profile.jkr?</Button>
        </DialogTrigger>
        <DialogContent className='overflow-auto sm:max-w-[1025px]'>
          <DialogHeader>
            <DialogTitle>Where to find your profile.jkr</DialogTitle>
          </DialogHeader>
          <div className='prose'>
            <div>
              <h3>Windows</h3>
              <ol>
                <li>Open File Explorer and click the address bar</li>
                <li>
                  Type: <CopyCode>%AppData%/Balatro</CopyCode>
                </li>
                <li>
                  Press <kbd>Enter</kbd>
                </li>
                <li>Choose from folder 1, 2, or 3</li>
              </ol>
            </div>

            <div>
              <h3>MacOS</h3>
              <ol>
                <li>Open Finder</li>
                <li>
                  Press <kbd>Shift</kbd> + <kbd>Command</kbd> + <kbd>G</kbd>
                </li>
                <li>
                  Type:{' '}
                  <CopyCode>~/Library/Application Support/Balatro</CopyCode>
                </li>
                <li>
                  Press <kbd>Enter</kbd>
                </li>
                <li>Choose from folder 1, 2, or 3</li>
              </ol>
            </div>

            <div>
              <h3>Steam Deck</h3>
              <ol>
                <li>
                  Navigate to:{' '}
                  <CopyCode>
                    ~/.local/share/Steam/steamapps/compatdata/2379780/pfx/drive_c/users/steamuser/AppData/Roaming/Balatro
                  </CopyCode>
                </li>
                <li>Choose from folder 1, 2, or 3</li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type='button'>Got it</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FileUploader />
    </div>
  )
}
