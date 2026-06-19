'use client'

import { DownloadIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

type OS = 'Windows' | 'Mac' | 'Linux' | 'Unknown'

const DOWNLOAD_LINKS = {
  Windows:
    'https://github.com/Balatro-Multiplayer/Balatro-Multiplayer-Launcher/releases/latest/download/balatro-multiplayer-launcher.exe',
  Mac: 'https://github.com/Balatro-Multiplayer/Balatro-Multiplayer-Launcher/releases/latest/download/balatro-multiplayer-launcher.dmg',
  Linux:
    'https://github.com/Balatro-Multiplayer/Balatro-Multiplayer-Launcher/releases/latest/download/balatro-multiplayer-launcher.AppImage',
}

export function OSDownloadButton() {
  const [detectedOS, setDetectedOS] = useState<OS>('Unknown')
  const [selectedOS, setSelectedOS] = useState<OS>('Unknown')
  const [showOptions, setShowOptions] = useState(false)

  useEffect(() => {
    // Detect OS on client side
    const userAgent = window.navigator.userAgent.toLowerCase()

    if (userAgent.indexOf('win') !== -1) {
      setDetectedOS('Windows')
      setSelectedOS('Windows')
    } else if (userAgent.indexOf('mac') !== -1) {
      setDetectedOS('Mac')
      setSelectedOS('Mac')
    } else if (
      userAgent.indexOf('linux') !== -1 ||
      userAgent.indexOf('x11') !== -1
    ) {
      setDetectedOS('Linux')
      setSelectedOS('Linux')
    }
  }, [])

  const downloadLink =
    DOWNLOAD_LINKS[selectedOS as keyof typeof DOWNLOAD_LINKS] || ''
  const downloadText = `Download for ${selectedOS}`

  return (
    <div className='flex flex-col items-center gap-2'>
      {detectedOS !== 'Unknown' && (
        <>
          <Button asChild className='no-underline'>
            <a href={downloadLink} rel='noopener noreferrer'>
              <DownloadIcon className='mr-2' />
              {downloadText}
            </a>
          </Button>

          <div className='mt-1 text-sm'>
            <button
              type='button'
              onClick={() => setShowOptions(!showOptions)}
              className='text-blue-500 hover:underline'
            >
              {showOptions ? 'Hide other options' : `Not using ${detectedOS}?`}
            </button>
          </div>

          {showOptions && (
            <div className='mt-2 flex gap-2'>
              {Object.keys(DOWNLOAD_LINKS).map(
                (os) =>
                  os !== selectedOS && (
                    <Button
                      key={os}
                      variant='outline'
                      size='sm'
                      onClick={() => setSelectedOS(os as OS)}
                      className='no-underline'
                    >
                      {os}
                    </Button>
                  )
              )}
            </div>
          )}
        </>
      )}

      {detectedOS === 'Unknown' && (
        <div className='flex flex-col gap-2'>
          <p className='text-center'>Select your operating system:</p>
          <div className='flex justify-center gap-2'>
            {Object.keys(DOWNLOAD_LINKS).map((os) => (
              <Button
                key={os}
                variant={selectedOS === os ? 'default' : 'outline'}
                onClick={() => setSelectedOS(os as OS)}
                className='no-underline'
              >
                {os}
              </Button>
            ))}
          </div>

          {selectedOS !== 'Unknown' && (
            <Button asChild className='mt-2 no-underline'>
              <a href={downloadLink} rel='noopener noreferrer'>
                <DownloadIcon className='mr-2' />
                {downloadText}
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
