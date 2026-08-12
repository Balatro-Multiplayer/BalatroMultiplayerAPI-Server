import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createMetadata } from '@/lib/metadata'
import { OSDownloadButton } from '../../_components/os-download-button'

export const metadata = createMetadata({
  title: 'Download',
  description: 'Download the Balatro Multiplayer launcher and mod.',
  path: '/download',
})

export default function DownloadPage() {
  return (
    <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-1 flex-col py-8'>
      <div className='mb-10 text-center'>
        <h1 className='font-bold text-4xl tracking-tight'>Download</h1>
        <p className='mt-4 text-lg text-muted-foreground'>
          Get set up with Balatro Multiplayer
        </p>
      </div>

      <div className='space-y-8'>
        <Card>
          <CardHeader>
            <CardTitle>
              Recommended: Using the Balatro Multiplayer Launcher
            </CardTitle>
            <CardDescription>
              The easiest way to install and manage the Balatro Multiplayer mod
              is by using our official launcher.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-6'>
            <div className='flex flex-col items-center gap-4'>
              <OSDownloadButton />
            </div>
            <div className='rounded-lg border bg-card p-4'>
              <p className='mb-2 text-muted-foreground text-sm'>
                Once downloaded, open the launcher and follow the on-screen
                instructions. It will automatically:
              </p>
              <ul className='list-inside list-disc space-y-1 text-muted-foreground text-sm'>
                <li>
                  Install all required dependencies (Lovely and Steamodded)
                </li>
                <li>
                  Download and install the selected version of the Multiplayer
                  mod
                </li>
                <li>Download and install any other Balatro mod.</li>
              </ul>
              <p className='mt-2 text-muted-foreground text-sm'>
                It also lets you create modded profiles, letting you switch
                between different sets of mods in one click.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alternative: Manual installation</CardTitle>
            <CardDescription>
              Instructions for installing the mod without the launcher.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className='text-muted-foreground text-sm'>Coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
