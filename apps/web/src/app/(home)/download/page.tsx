import { ExternalLinkIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { ContentCard, PageHeader, PageShell } from '@/components/page-kit'
import { Button } from '@/components/ui/button'
import { createMetadata } from '@/lib/metadata'
import { OSDownloadButton } from '../../_components/os-download-button'

export const metadata = createMetadata({
  title: 'Download',
  description: 'Install the Balatro Multiplayer mods.',
  path: '/download',
})

const R2MODMAN_URL = 'https://thunderstore.io/c/balatro/p/ebkr/r2modman/'
const GITHUB = 'https://github.com/Balatro-Multiplayer'

// Spreads the rest so Button asChild can pass its class and handlers through.
function ExternalLink(props: ComponentProps<'a'>) {
  return (
    <a
      className='underline'
      target='_blank'
      rel='noopener noreferrer'
      {...props}
    />
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className='break-all rounded bg-muted px-1 py-0.5 text-xs'>
      {children}
    </code>
  )
}

// A numbered list: the number is a pixel-font badge, the text is Inter.
function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className='space-y-3'>
      {children.map((step, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: steps are static
        <li key={i} className='flex gap-3'>
          <span className='flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 font-pixel text-base text-primary'>
            {i + 1}
          </span>
          <div className='min-w-0 flex-1 pt-0.5 text-sm'>{step}</div>
        </li>
      ))}
    </ol>
  )
}

function Option({
  name,
  text,
  product,
}: {
  name: string
  text: string
  product: 'launcher' | 'r2modman'
}) {
  return (
    <div className='flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4'>
      <h3 className='font-pixel text-lg uppercase tracking-wide'>{name}</h3>
      <p className='text-muted-foreground text-sm'>{text}</p>
      <div className='mt-auto'>
        <OSDownloadButton product={product} />
      </div>
    </div>
  )
}

export default function DownloadPage() {
  return (
    <PageShell>
      <PageHeader
        title='Download'
        meta='Get set up with Balatro Multiplayer.'
      />

      <ContentCard
        title='Recommended: install with r2modman'
        actions={
          <span className='rounded-full bg-primary/15 px-2.5 py-0.5 font-medium text-primary text-xs'>
            Easiest
          </span>
        }
      >
        <p className='text-muted-foreground text-sm'>
          r2modman is the Thunderstore mod manager. It installs the Multiplayer
          mods and everything they need, and keeps them up to date.
        </p>
        <Steps>
          {[
            <span key='1'>Install r2modman, open it and select Balatro.</span>,
            <span key='2'>Create a profile, or use the default one.</span>,
            <span key='3'>
              In <strong>Online</strong>, search for{' '}
              <strong>MultiplayerPvP</strong> and{' '}
              <strong>MultiplayerSpeedrun</strong>, and install the gamemodes
              you want. r2modman also installs Lovely, Steamodded and
              MultiplayerAPI for you.
            </span>,
            <span key='4'>
              Click <strong>Start modded</strong>. Keep Steam open: you log in
              with your Steam account.
            </span>,
          ]}
        </Steps>
        <div className='flex flex-wrap items-center gap-3 pt-1'>
          <Button asChild className='no-underline'>
            <ExternalLink href={R2MODMAN_URL}>
              <ExternalLinkIcon className='mr-2' />
              Get r2modman
            </ExternalLink>
          </Button>
          <p className='text-muted-foreground text-sm'>
            This is all you need for Casual games and lobbies. Ranked needs one
            of the apps below.
          </p>
        </div>
      </ContentCard>

      <ContentCard title='To play Ranked'>
        <p className='text-muted-foreground text-sm'>
          Ranked games need an app with our anti-cheat. Pick the one you like
          better. Both install the same mods.
        </p>
        <div className='grid gap-4 md:grid-cols-2'>
          <Option
            name='BET Launcher'
            product='launcher'
            text='A simple launcher made for Balatro, like Balatro Mod Manager. Pick this if you do not use r2modman. It installs Lovely, Steamodded and the Multiplayer mods, can install other Balatro mods, and lets you switch between mod profiles in one click.'
          />
          <Option
            name='BMP r2modman'
            product='r2modman'
            text='Our build of r2modman with the anti-cheat added. Pick this if you want to keep using r2modman. It works the same as r2modman, so you can use the steps above.'
          />
        </div>
      </ContentCard>

      <ContentCard title='Alternative: manual installation'>
        <p className='text-muted-foreground text-sm'>
          Install the mods yourself, with no mod manager. You can play Casual
          games and lobbies, but not Ranked.
        </p>
        <Steps>
          {[
            <span key='1'>
              Install{' '}
              <ExternalLink href='https://github.com/ethangreen-dev/lovely-injector'>
                Lovely
              </ExternalLink>{' '}
              0.10 or newer and{' '}
              <ExternalLink href='https://github.com/Steamodded/smods'>
                Steamodded
              </ExternalLink>{' '}
              1.0.0~BETA-1814a or newer.
            </span>,
            <span key='2'>
              Download the latest release of{' '}
              <ExternalLink
                href={`${GITHUB}/BalatroMultiplayerAPI/releases/latest`}
              >
                MultiplayerAPI
              </ExternalLink>{' '}
              and of the gamemodes you want:{' '}
              <ExternalLink
                href={`${GITHUB}/BalatroMultiplayerPvP/releases/latest`}
              >
                PvP
              </ExternalLink>{' '}
              and{' '}
              <ExternalLink
                href={`${GITHUB}/BalatroMultiplayerSpeedrunning/releases/latest`}
              >
                Speedrun
              </ExternalLink>
              .
            </span>,
            <div key='3'>
              Extract each one into its own folder in your Balatro{' '}
              <Code>Mods</Code> folder. Make sure a mod's folder is not inside a
              second folder of the same name.
              <dl className='mt-2 space-y-1.5 text-muted-foreground'>
                <div>
                  <dt className='inline'>Windows: </dt>
                  <dd className='inline'>
                    <Code>%AppData%\Balatro\Mods\</Code>
                  </dd>
                </div>
                <div>
                  <dt className='inline'>macOS: </dt>
                  <dd className='inline'>
                    <Code>~/Library/Application Support/Balatro/Mods/</Code>
                  </dd>
                </div>
                <div>
                  <dt className='inline'>Linux (Proton): </dt>
                  <dd className='inline'>
                    <Code>
                      ~/.steam/steam/steamapps/compatdata/2379780/pfx/drive_c/users/steamuser/AppData/Roaming/Balatro/Mods/
                    </Code>
                  </dd>
                </div>
              </dl>
            </div>,
            <span key='4'>
              Start Balatro <strong>through Steam</strong>, and pick PvP or
              Speedrun from the Multiplayer menu. You log in with your Steam
              account, so the menu stays offline without Steam.
            </span>,
          ]}
        </Steps>
        <p className='text-muted-foreground text-sm'>
          Keep only one copy of each mod in <Code>Mods</Code>. Remove the old{' '}
          <Code>Multiplayer</Code> mod first: it conflicts with these mods.
        </p>
      </ContentCard>
    </PageShell>
  )
}
