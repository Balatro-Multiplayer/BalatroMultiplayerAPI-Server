'use client'

import {
  Dropzone,
  DropzoneDescription,
  DropzoneGroup,
  DropzoneInput,
  DropzoneTitle,
  DropzoneUploadIcon,
  DropzoneZone,
} from '@/components/ui/dropzone'

async function fixFile(file: File) {
  try {
    const response = await fetch('https://profile-fix.balatromp.com/fix', {
      method: 'POST',
      body: (() => {
        const formData = new FormData()
        formData.append('file', file)
        return formData
      })(),
    })

    if (!response.ok) {
      throw new Error(
        `server returned ${response.status}: ${await response.text()}`
      )
    }

    // get the blob from response
    const blob = await response.blob()

    // create download link
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name // or whatever name you want
    document.body.appendChild(a)
    a.click()

    // cleanup
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  } catch (err) {
    console.error('failed to fix file:', err)
    throw err
  }
}

export function FileUploader() {
  return (
    <Dropzone
      onDropAccepted={(files) => {
        const file = files[0]
        if (!(file instanceof File)) {
          return
        }
        return fixFile(file)
      }}
    >
      <DropzoneZone className={'w-full'}>
        <DropzoneInput />
        <DropzoneGroup className='gap-4'>
          <DropzoneUploadIcon />
          <DropzoneGroup>
            <DropzoneTitle>Drop files here or click to upload</DropzoneTitle>
            <DropzoneDescription>
              Upload your corrupted <strong>profile.jkr</strong> and get a fixed
              version.
            </DropzoneDescription>
          </DropzoneGroup>
        </DropzoneGroup>
      </DropzoneZone>
    </Dropzone>
  )
}
